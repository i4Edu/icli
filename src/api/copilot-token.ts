// GitHub Copilot API authentication.
//
// The Copilot endpoint (https://api.business.githubcopilot.com) does NOT accept
// a GitHub PAT/OAuth token directly. Like the official Copilot CLI/IDE clients,
// you must exchange your GitHub token (gho_/ghp_/gh CLI token) for a short-lived
// Copilot bearer token via the copilot_internal token endpoint, then send that
// as `Authorization: Bearer <copilot-token>` to the Copilot API.

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

// Editor identity headers the Copilot API expects on every request.
const EDITOR_VERSION = 'icopilot/2.3.6';
const INTEGRATION_ID = 'vscode-chat';

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

interface CachedCopilotToken {
  token: string;
  // Epoch milliseconds at which the token expires.
  expiresAt: number;
  // The GitHub token this Copilot token was minted from.
  sourceToken: string;
}

let cached: CachedCopilotToken | null = null;

/** Headers required by the Copilot API on chat/completions requests. */
export function copilotApiHeaders(): Record<string, string> {
  return {
    'Editor-Version': EDITOR_VERSION,
    'Editor-Plugin-Version': EDITOR_VERSION,
    'Copilot-Integration-Id': INTEGRATION_ID,
    'User-Agent': EDITOR_VERSION,
  };
}

/** Clear the cached Copilot token (used in tests and on auth changes). */
export function resetCopilotTokenCache(): void {
  cached = null;
}

/**
 * Exchange a GitHub token for a short-lived Copilot bearer token, caching the
 * result until shortly before it expires.
 */
export async function getCopilotToken(
  githubToken: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string> {
  const now = Date.now();
  if (
    cached &&
    cached.sourceToken === githubToken &&
    cached.expiresAt - 60_000 > now // refresh 60s before expiry
  ) {
    return cached.token;
  }

  const res = await fetchImpl(COPILOT_TOKEN_URL, {
    method: 'GET',
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
      'Editor-Version': EDITOR_VERSION,
      'User-Agent': EDITOR_VERSION,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(copilotTokenError(res.status, body));
  }

  const data = (await res.json()) as { token?: string; expires_at?: number };
  if (!data?.token) {
    throw new Error(
      'Copilot token exchange returned no token; is Copilot enabled for this account?',
    );
  }

  cached = {
    token: data.token,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at * 1000 : now + 25 * 60_000,
    sourceToken: githubToken,
  };
  return cached.token;
}

function copilotTokenError(status: number, body: string): string {
  const detail = body.trim() ? ` ${body.trim().slice(0, 200)}` : '';
  if (status === 401 || status === 403) {
    return (
      `Copilot token exchange failed (${status}).${detail}\n` +
      `  • Your GitHub token is invalid or lacks Copilot access.\n` +
      `  • Sign in with a Copilot-enabled account (e.g. \`gh auth login\`) and ensure your\n` +
      `    GitHub Copilot subscription is active.`
    );
  }
  return `Copilot token exchange failed (${status}).${detail}`;
}
