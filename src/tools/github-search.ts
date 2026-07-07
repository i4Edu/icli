/**
 * GitHub search tool using the GitHub REST API.
 * Uses GH_TOKEN / GITHUB_TOKEN for authentication (higher rate limits + private repo access).
 *
 * Supported search types:
 *   - repositories: search repos by name/topic/language
 *   - code:         search code across GitHub
 *   - issues:       search issues and PRs
 *   - users:        search users/orgs
 *   - commits:      search commits
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

const GITHUB_API = 'https://api.github.com';

function githubHeaders(): Record<string, string> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'icopilot-cli/4.0.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubGet(path: string): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export interface GitHubSearchArgs {
  /** Search query (GitHub search syntax supported) */
  query: string;
  /** What to search: repositories | code | issues | users | commits */
  type?: 'repositories' | 'code' | 'issues' | 'users' | 'commits';
  /** Max results (default 10, max 30) */
  limit?: number;
  /** Sort field */
  sort?: string;
  /** asc or desc */
  order?: 'asc' | 'desc';
}

export async function githubSearch(args: GitHubSearchArgs): Promise<string> {
  const type = args.type ?? 'repositories';
  const limit = Math.min(args.limit ?? 10, 30);
  const params = new URLSearchParams({
    q: args.query,
    per_page: String(limit),
    ...(args.sort ? { sort: args.sort } : {}),
    ...(args.order ? { order: args.order } : {}),
  });

  try {
    const data = (await githubGet(`/search/${type}?${params}`)) as {
      total_count: number;
      items: unknown[];
    };

    const total = data.total_count;
    const items = data.items.slice(0, limit);

    // Format results by type
    let formatted: object[];
    switch (type) {
      case 'repositories':
        formatted = (items as Array<Record<string, unknown>>).map((r) => ({
          full_name: r['full_name'],
          description: r['description'],
          stars: r['stargazers_count'],
          forks: r['forks_count'],
          language: r['language'],
          url: r['html_url'],
          topics: r['topics'],
          updated: r['updated_at'],
        }));
        break;
      case 'code':
        formatted = (items as Array<Record<string, unknown>>).map((r) => ({
          path: (r['path'] as string),
          repository: (r['repository'] as Record<string, unknown>)?.['full_name'],
          url: r['html_url'],
          score: r['score'],
        }));
        break;
      case 'issues':
        formatted = (items as Array<Record<string, unknown>>).map((r) => ({
          title: r['title'],
          state: r['state'],
          number: r['number'],
          url: r['html_url'],
          user: (r['user'] as Record<string, unknown>)?.['login'],
          labels: (r['labels'] as Array<Record<string, unknown>>)?.map((l) => l['name']),
          created: r['created_at'],
        }));
        break;
      case 'users':
        formatted = (items as Array<Record<string, unknown>>).map((r) => ({
          login: r['login'],
          type: r['type'],
          url: r['html_url'],
          score: r['score'],
        }));
        break;
      case 'commits':
        formatted = (items as Array<Record<string, unknown>>).map((r) => ({
          message: (r['commit'] as Record<string, unknown>)?.['message'],
          author: ((r['commit'] as Record<string, unknown>)?.['author'] as Record<string, unknown>)?.['name'],
          repository: (r['repository'] as Record<string, unknown>)?.['full_name'],
          url: r['html_url'],
          sha: (r['sha'] as string)?.slice(0, 8),
        }));
        break;
      default:
        formatted = items as object[];
    }

    return JSON.stringify({ ok: true, type, total_count: total, results: formatted });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err) });
  }
}

export interface GitHubRepoArgs {
  /** owner/repo format */
  repo: string;
  /** Optional: path within the repo */
  path?: string;
  /** Optional: ref (branch/tag/sha) */
  ref?: string;
}

export async function githubGetRepo(args: GitHubRepoArgs): Promise<string> {
  try {
    if (args.path) {
      const ref = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : '';
      const data = await githubGet(`/repos/${args.repo}/contents/${args.path}${ref}`);
      // Decode base64 content if it's a file
      const file = data as Record<string, unknown>;
      if (file['encoding'] === 'base64' && typeof file['content'] === 'string') {
        const content = Buffer.from(file['content'].replace(/\n/g, ''), 'base64').toString('utf8');
        return JSON.stringify({
          ok: true,
          path: file['path'],
          size: file['size'],
          url: file['html_url'],
          content: content.slice(0, 50_000),
          truncated: (file['size'] as number) > 50_000,
        });
      }
      return JSON.stringify({ ok: true, data });
    }
    const data = await githubGet(`/repos/${args.repo}`);
    return JSON.stringify({ ok: true, data });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err) });
  }
}

export const GITHUB_SEARCH_SCHEMA: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'github_search',
    description:
      'Search GitHub for repositories, code, issues, users, or commits using the GitHub API. Supports full GitHub search syntax (language:typescript stars:>1000, etc.).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'GitHub search query. Supports qualifiers like language:, stars:, user:, repo:, etc.',
        },
        type: {
          type: 'string',
          enum: ['repositories', 'code', 'issues', 'users', 'commits'],
          description: 'What to search (default: repositories)',
        },
        limit: { type: 'number', description: 'Max results to return (default 10, max 30)' },
        sort: { type: 'string', description: 'Sort field (e.g. stars, updated, created)' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order' },
      },
      required: ['query'],
    },
  },
};

export const GITHUB_GET_REPO_SCHEMA: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'github_get_repo',
    description:
      'Get details about a GitHub repository, or read a specific file from it. Use repo="owner/name" and optionally path="src/index.ts".',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo (e.g. microsoft/typescript)' },
        path: { type: 'string', description: 'File or directory path within the repo' },
        ref: { type: 'string', description: 'Branch, tag, or commit SHA' },
      },
      required: ['repo'],
    },
  },
};
