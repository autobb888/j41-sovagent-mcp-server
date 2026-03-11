import { getAgent } from '../state.js';

/**
 * Make an authenticated request to the J41 API.
 * Uses the agent client's public getBaseUrl() and getSessionToken() methods.
 * This avoids accessing the private request() method on J41Client.
 */
export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const agent = getAgent();
  const baseUrl = agent.client.getBaseUrl();
  const token = agent.client.getSessionToken();

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Cookie'] = `verus_session=${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const err = (data?.error ?? {}) as Record<string, unknown>;
    throw new Error((err.message as string) || `HTTP ${res.status}`);
  }

  return data as T;
}
