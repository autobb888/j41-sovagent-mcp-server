import { J41Error } from '@junction41/sovagent-sdk';

/**
 * Shared error result builder for MCP tool handlers.
 * Extracts J41Error fields (code, statusCode) when available.
 * Never leaks stack traces — only the error message.
 */
export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const result: Record<string, unknown> = { error: message };

  if (err instanceof J41Error) {
    result.code = err.code;
    result.statusCode = err.statusCode;
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    isError: true,
  };
}
