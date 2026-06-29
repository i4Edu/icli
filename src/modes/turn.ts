import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { Session } from '../session/session.js';
import { streamChat } from '../api/github-models.js';
import { TOOL_SCHEMAS, dispatchTool } from '../tools/registry.js';
import { StreamSink } from '../ui/render.js';
import { theme } from '../ui/theme.js';
import { PLAN_SYSTEM, getAskSystemPrompt } from '../commands/prompts.js';
import { parseFileRefs, renderFileRefBlock } from '../context/file-refs.js';
import { renderGitContextBlock } from '../context/git-context.js';
import {
  buildImageContent,
  detectImagePaths,
  isVisionCapableModel,
  type MessageContentPart,
} from '../context/image-input.js';
import { loadMemoryBlock } from '../context/memory.js';
import { PinnedContext } from '../context/pinned.js';
import { getReadOnlyContext } from '../context/read-only.js';
import { learnAutoMemories, loadAutoMemoryPromptContext } from '../knowledge/auto-memory.js';
import { loadCorrectionPromptContext } from '../knowledge/corrections.js';
import { loadConventionPromptContext } from '../knowledge/conventions.js';
import { loadStylePromptContext } from '../knowledge/style-learner.js';
import type { MetricsCollector } from '../commands/metrics-cmd.js';
import { config } from '../config.js';
import { hookManager } from '../hooks/lifecycle.js';
import {
  AUTO_FIX_MAX_RETRIES,
  buildAutoFixPrompt,
  extractAutoLintResult,
  extractChangedFilesFromToolResult,
  formatAutoCheckResult,
  runAutoTest,
} from '../tools/auto-check.js';
import { loadProjectContentFilter, summarizeFilterResult } from '../security/content-filter.js';
import { countTokensSync } from '../util/tokens.js';
import path from 'node:path';
import os from 'node:os';
import { recordTurnSnapshot } from '../commands/changes-cmd.js';
import { pickModel } from '../routing/router.js';

const MAX_TOOL_HOPS = 6;
const ASK_ONLY_SYSTEM = `You are iCopilot in question-only mode.

Answer directly, explain tradeoffs when helpful, and stay concise.
Do NOT make tool calls, do NOT edit files, and do NOT claim that you changed anything.`;
const CODE_MODE_PROMPT = `Code Mode override:
- Skip planning and start implementing immediately.
- Use tools when they help you inspect or change code.
- Prefer direct execution over discussion.`;
const ARCHITECT_MODE_PROMPT = `Architect Mode override:
- Execute the supplied architecture plan.
- Keep implementation aligned to that plan unless a hard blocker appears.
- Use tools and code edits as needed to complete the task.`;
const ARCHITECT_PLANNER_PROMPT = `You are the planning half of Architect Mode.

Produce a concise implementation plan (3-6 bullets) for the user's request.
The plan should focus on concrete code changes and verification steps.
Do not call tools.`;

export interface TurnOpts {
  session: Session;
  userInput: string;
  metrics?: MetricsCollector;
  signal: AbortSignal;
  turnMode?: 'ask' | 'code' | 'architect';
}

/**
 * Run one user→assistant turn. Handles @file injection, tool-call loop,
 * streaming output, and persistent history.
 */
export async function runTurn(opts: TurnOpts): Promise<void> {
  const { session, userInput, metrics, signal, turnMode } = opts;
  const turnStartedAt = Date.now();
  let assistantTokens = 0;
  const hookResult = await hookManager.emit('userPromptSubmit', {
    sessionId: session.state.id,
    cwd: session.state.cwd,
    mode: session.state.mode,
    model: session.state.model,
    prompt: userInput,
  });
  if (hookResult.action === 'deny') {
    throw new Error(hookResult.reason || 'prompt blocked by lifecycle hook');
  }
  const submittedInput =
    hookResult.action === 'modify' && typeof (hookResult.modifications as any)?.prompt === 'string'
      ? String((hookResult.modifications as any).prompt)
      : userInput;
  const refs = parseFileRefs(submittedInput);
  const refBlock = renderFileRefBlock(refs);
  const promptInput = refBlock ? `${submittedInput}\n\n${refBlock}` : submittedInput;
  const filterResult = loadProjectContentFilter(session.state.cwd).filter(promptInput);

  if (refs.length && !config.quiet && !config.jsonOutput) {
    process.stdout.write(
      theme.dim(
        `  injected ${refs.length} file ref${refs.length === 1 ? '' : 's'}: ` +
          refs.map((r) => r.rel).join(', ') +
          '\n',
      ),
    );
  }

  if (filterResult.blocked) {
    const blockedRules = [
      ...new Set(
        filterResult.matches
          .filter((match) => match.action === 'block')
          .map((match) => match.name),
      ),
    ];
    throw new Error(
      `prompt blocked by content filter (${summarizeFilterResult(filterResult)}): ${blockedRules.join(', ')}`,
    );
  }

  if ((filterResult.changed || filterResult.warnings > 0) && !config.quiet && !config.jsonOutput) {
    process.stdout.write(theme.warn(`  content filter applied: ${summarizeFilterResult(filterResult)}\n`));
  }

  const turnProfile = resolveTurnProfile(session, turnMode);
  const sys: ChatCompletionMessageParam = {
    role: 'system',
    content: buildSystemPrompt(session, filterResult.filtered, turnProfile),
  };
  const imagePaths = detectImagePaths(userInput);
  const userContent = buildUserMessageContent(
    filterResult.filtered,
    imagePaths,
    session.state.cwd,
    session.state.model,
    (warning) => {
      if (!config.quiet && !config.jsonOutput) {
        process.stdout.write(theme.warn(`  ${warning}\n`));
      }
    },
  );

  const userMsg: ChatCompletionMessageParam = {
    role: 'user',
    content: userContent,
  };
  session.push(userMsg);

  let modelForTurn = session.state.model;
  if (turnMode === 'architect') {
    const plannerModel = pickModel(session.state.model, 'plan');
    const plannerResult = await streamChat({
      model: plannerModel,
      messages: [
        {
          role: 'system',
          content: `${buildSystemPrompt(session, filterResult.filtered, turnProfile)}\n\n${ARCHITECT_PLANNER_PROMPT}`,
        },
        ...session.state.messages,
      ],
      signal,
      onToken: () => undefined,
    });
    const plan = plannerResult.content?.trim() || '';
    if (plan) {
      if (!config.quiet && !config.jsonOutput) {
        process.stdout.write(`\n${theme.brand('Architect plan')} ${theme.dim(`(${plannerModel})`)}\n${plan}\n\n`);
      }
      sys.content = `${sys.content}\n\nArchitect plan:\n${plan}`;
    }
    modelForTurn = pickModel(session.state.model, 'edit');
  }

  const tools = turnProfile.tools;
  const changedFiles = new Set<string>();
  const failedLintFiles = new Set<string>();
  let lastFailedLint:
    | {
        passed: boolean;
        output: string;
        fixable: boolean;
        files: string[];
      }
    | null = null;
  let autoFixRetries = 0;

  try {
    await recordTurnSnapshot(session).catch(() => null);
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const sink = new StreamSink();
      if (!config.quiet && !config.jsonOutput) {
        process.stdout.write('\n' + theme.assistant('● ') + '');
      }
      const res = await streamChat({
        model: modelForTurn,
        messages: [sys, ...session.state.messages],
        tools,
        signal,
        onToken: (t) => {
          if (!config.jsonOutput) sink.write(t);
        },
      });
      if (!config.jsonOutput) {
        sink.finalize();
      }
      const content = res.content || '';
      const tokenCount = safeTokenCount(content);
      assistantTokens += tokenCount;

      // Persist assistant message
      const assistantMsg: ChatCompletionMessageParam = {
        role: 'assistant',
        content,
        ...(res.toolCalls.length
          ? {
              tool_calls: res.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments || '{}' },
              })),
            }
          : {}),
      };
      session.push(assistantMsg);

      if (config.jsonOutput) {
        process.stdout.write(
          JSON.stringify({
            role: 'assistant',
            content,
            model: session.state.model,
            tokens: tokenCount,
          }) + '\n',
        );
      }

      if (!res.toolCalls.length || res.finishReason === 'stop') {
        if (
          lastFailedLint &&
          config.autoFix &&
          autoFixRetries < AUTO_FIX_MAX_RETRIES &&
          lastFailedLint.fixable
        ) {
          autoFixRetries += 1;
          session.push({
            role: 'system',
            content: buildAutoFixPrompt('lint', lastFailedLint, autoFixRetries, lastFailedLint.files),
          });
          continue;
        }

        if (changedFiles.size > 0 && config.autoTest) {
          const testResult = await runAutoTest();
          if (!config.quiet && !config.jsonOutput) {
            process.stdout.write(
              `${theme.dim(formatAutoCheckResult('test', testResult, [...changedFiles]))}\n`,
            );
          }
          if (
            !testResult.passed &&
            config.autoFix &&
            autoFixRetries < AUTO_FIX_MAX_RETRIES &&
            testResult.fixable
          ) {
            autoFixRetries += 1;
            session.push({
              role: 'system',
              content: buildAutoFixPrompt('test', testResult, autoFixRetries, [...changedFiles]),
            });
            continue;
          }
        }

        learnAutoMemories(userInput, content);
        return;
      }

      // Execute tools and append tool results, then loop
      for (const tc of res.toolCalls) {
        let parsed: any = {};
        try {
          parsed = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch {
          parsed = { __raw: tc.arguments };
        }
        const toolStartedAt = Date.now();
        const out = await dispatchTool(tc.name, parsed);
        metrics?.recordToolCall(tc.name, Date.now() - toolStartedAt);
        session.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: out,
        } as ChatCompletionMessageParam);
        const toolChangedFiles = extractChangedFilesFromToolResult(tc.name, parsed, out);
        toolChangedFiles.forEach((file) => changedFiles.add(file));
        const autoLint = extractAutoLintResult(out);
        if (autoLint) {
          if (!config.quiet && !config.jsonOutput) {
            process.stdout.write(
              `${theme.dim(formatAutoCheckResult('lint', autoLint, toolChangedFiles))}\n`,
            );
          }
          if (autoLint.passed) {
            toolChangedFiles.forEach((file) => failedLintFiles.delete(file));
            if (failedLintFiles.size === 0) lastFailedLint = null;
          } else {
            toolChangedFiles.forEach((file) => failedLintFiles.add(file));
            lastFailedLint = { ...autoLint, files: toolChangedFiles };
          }
        }
      }
    }
  } finally {
    if (!signal.aborted && assistantTokens > 0) {
      const durationMs = Date.now() - turnStartedAt;
      metrics?.recordResponseTime(durationMs);
      if (durationMs > 0) {
        metrics?.recordTokenThroughput(assistantTokens / (durationMs / 1000));
      }
    }
  }

  if (!config.jsonOutput) {
    process.stdout.write(theme.warn(`\n⚠  tool-call hop limit (${MAX_TOOL_HOPS}) reached.\n`));
  }
}

export function buildSystemPrompt(
  session: Session,
  context = '',
  profile?: TurnProfile,
): string {
  const pinnedBlock = PinnedContext.fromJSON(session.state.pinned).render();
  const readOnlyBlock = getReadOnlyContext();
  const gitBlock = renderGitContextBlock(session.state.gitContext ?? []);
  const styleBlock = loadStylePromptContext(session.state.cwd) ?? '';
  const conventionBlock = loadConventionPromptContext(session.state.cwd) ?? '';
  const autoMemoryBlock = loadAutoMemoryPromptContext(context, 12) ?? '';
  const correctionsBlock = loadCorrectionPromptContext(context) ?? '';
  const basePrompt =
    profile?.systemPrompt ??
    session.state.systemPrompt ??
    ((profile?.baseMode ?? session.state.mode) === 'plan' ? PLAN_SYSTEM : getAskSystemPrompt());
  return [
    loadMemoryBlock(session.state.cwd) ?? '',
    autoMemoryBlock,
    basePrompt,
    correctionsBlock,
    styleBlock,
    conventionBlock,
    pinnedBlock,
    readOnlyBlock,
    gitBlock,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}

interface TurnProfile {
  baseMode: 'ask' | 'plan';
  systemPrompt?: string;
  tools?: ChatCompletionTool[];
}

function resolveTurnProfile(
  session: Session,
  turnMode?: 'ask' | 'code' | 'architect',
): TurnProfile {
  const askPrompt = session.state.systemPrompt ?? getAskSystemPrompt();
  switch (turnMode) {
    case 'ask':
      return {
        baseMode: 'ask',
        systemPrompt:
          session.state.systemPrompt && session.state.systemPrompt.trim()
            ? `${session.state.systemPrompt}\n\n${ASK_ONLY_SYSTEM}`
            : ASK_ONLY_SYSTEM,
        tools: undefined,
      };
    case 'code':
      return {
        baseMode: 'ask',
        systemPrompt: `${askPrompt}\n\n${CODE_MODE_PROMPT}`,
        tools: TOOL_SCHEMAS,
      };
    case 'architect':
      return {
        baseMode: 'ask',
        systemPrompt: `${askPrompt}\n\n${ARCHITECT_MODE_PROMPT}`,
        tools: TOOL_SCHEMAS,
      };
    default:
      return {
        baseMode: session.state.mode,
        tools: session.state.mode === 'ask' ? TOOL_SCHEMAS : undefined,
      };
  }
}

function safeTokenCount(text: string): number {
  try {
    return countTokensSync(text);
  } catch {
    return Math.ceil(text.length / 4);
  }
}

function buildUserMessageContent(
  text: string,
  imagePaths: string[],
  cwd: string,
  model: string,
  onWarning: (warning: string) => void,
): string | MessageContentPart[] {
  if (!imagePaths.length) return text;
  if (!isVisionCapableModel(model)) {
    onWarning(
      `model "${model}" does not support image input; ignoring ${imagePaths.length} image reference${imagePaths.length === 1 ? '' : 's'}.`,
    );
    return text;
  }

  const content: MessageContentPart[] = [{ type: 'text', text }];
  const resolvedImagePaths = imagePaths.map((imagePath) => resolveImagePath(imagePath, cwd));

  for (const imagePath of resolvedImagePaths) {
    try {
      content.push(...buildImageContent([imagePath]));
    } catch (error: any) {
      onWarning(`unable to attach image ${imagePath}: ${error?.message || error}`);
    }
  }

  return content.length > 1 ? content : text;
}

function resolveImagePath(filePath: string, cwd: string): string {
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}
