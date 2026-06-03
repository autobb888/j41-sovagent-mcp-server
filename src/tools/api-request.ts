import { getAgent } from '../state.js';
import { J41Error } from '@junction41/sovagent-sdk';

/** Default API URL used when the agent is not yet initialized (public endpoints). */
const DEFAULT_API_URL = process.env.J41_API_URL || 'https://api.junction41.io';

// Audit 2026-06-02 H-MCP-ddos-3 / H-MCP-ddos-4: outbound apiRequest had no
// timeout (slow-loris from a malicious/compromised platform) and no size cap
// on the JSON response body (platform could serve multi-GB chunked response
// and OOM the MCP). Bounded read + AbortController close both.
const API_TIMEOUT_MS = Number(process.env.J41_MCP_API_TIMEOUT_MS ?? 30_000);
const MAX_RESPONSE_BYTES = Number(process.env.J41_MCP_API_MAX_RESPONSE_BYTES ?? 8 * 1024 * 1024); // 8 MB

async function readBoundedBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  let received = 0;
  const decoder = new TextDecoder('utf-8');
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error(
        `Response body exceeds ${MAX_RESPONSE_BYTES} bytes (so far ${received}); ` +
        `refusing to buffer further. Increase J41_MCP_API_MAX_RESPONSE_BYTES if this is a legitimate endpoint.`,
      );
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/**
 * Make an authenticated request to the J41 API.
 * Uses the agent client's public getBaseUrl() and getSessionToken() methods.
 * This avoids accessing the private request() method on J41Client.
 *
 * For public endpoints that don't require authentication, falls back to
 * DEFAULT_API_URL / J41_API_URL when the agent is not initialized.
 */
export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let baseUrl: string;
  let token: string | null = null;

  try {
    const agent = getAgent();
    baseUrl = agent.client.getBaseUrl();
    token = agent.client.getSessionToken();
  } catch (err) {
    if (err instanceof J41Error && err.code === 'NOT_INITIALIZED') {
      // Agent not initialized — fall back to default URL for public endpoints
      baseUrl = DEFAULT_API_URL;
    } else {
      throw err;
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Cookie'] = `verus_session=${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('API request timed out')), API_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  // Cap Content-Length pre-read; bounded streaming read covers chunked/no-CL.
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    res.body?.cancel().catch(() => {});
    throw new Error(
      `Response Content-Length ${declared} exceeds cap ${MAX_RESPONSE_BYTES}; aborting.`,
    );
  }

  const text = await readBoundedBody(res);

  let data: Record<string, unknown>;
  try {
    data = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  } catch {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return { message: res.statusText } as T;
  }

  if (!res.ok) {
    const err = (data?.error ?? {}) as Record<string, unknown>;
    throw new Error((err.message as string) || `HTTP ${res.status}`);
  }

  return data as T;
}
