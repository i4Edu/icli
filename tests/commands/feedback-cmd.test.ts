import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildGitHubIssuesUrl,
  loadFeedback,
  submitFeedback,
} from '../../src/commands/feedback-cmd.js';

describe('feedback command', () => {
  let tmpRoot: string;
  let feedbackFile: string;
  let originalFeedbackPath: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(process.cwd(), '.vitest-feedback-'));
    feedbackFile = path.join(tmpRoot, 'feedback.json');
    originalFeedbackPath = process.env.ICOPILOT_FEEDBACK_PATH;
    process.env.ICOPILOT_FEEDBACK_PATH = feedbackFile;
  });

  afterEach(() => {
    if (originalFeedbackPath === undefined) delete process.env.ICOPILOT_FEEDBACK_PATH;
    else process.env.ICOPILOT_FEEDBACK_PATH = originalFeedbackPath;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('stores feedback locally and returns a confirmation message', () => {
    const message = submitFeedback('bug', 'The CLI crashed after /context.', {
      cwd: 'E:\\AI\\icli',
      repo: 'owner/repo',
    });

    expect(message).toContain('Thank you for your feedback!');
    expect(message).toContain(buildGitHubIssuesUrl('owner/repo'));

    const entries = loadFeedback();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'bug',
      text: 'The CLI crashed after /context.',
      cwd: 'E:\\AI\\icli',
      repo: 'owner/repo',
    });
  });

  it('appends multiple feedback entries offline-first', () => {
    submitFeedback('feature', 'Please add a /feedback shortcut.');
    submitFeedback('praise', 'The context view is very helpful.');

    const entries = JSON.parse(fs.readFileSync(feedbackFile, 'utf8')) as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.type)).toEqual(['feature', 'praise']);
  });
});
