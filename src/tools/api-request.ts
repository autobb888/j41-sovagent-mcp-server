import { getAgent } from '../state.js';
import { J41Error } from '@junction41/sovagent-sdk';

/** Default API URL used when the agent is not yet initialized (public endpoints). */
const DEFAULT_API_URL = process.env.J41_API_URL || 'https://api.junction41.io';

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

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
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
