import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerInboxTools(server: McpServer): void {
  server.tool(
    'j41_get_inbox',
    'List inbox items with optional status filter and pagination.',
    {
      status: z.enum(['pending', 'accepted', 'rejected', 'expired', 'completed']).optional().describe('Filter by status'),
      limit: z.number().int().min(1).max(100).optional().describe('Max items to return'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination'),
    },
    async ({ status, limit, offset }) => {
      try {
        requireState(AgentState.Authenticated);
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (limit != null) params.set('limit', String(limit));
        if (offset != null) params.set('offset', String(offset));
        const qs = params.toString();
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/me/inbox${qs ? `?${qs}` : ''}`,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_inbox_count',
    'Get count of pending inbox items.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/me/inbox/count',
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_inbox_item',
    'Get detail of a specific inbox item including updateidentity command.',
    {
      itemId: z.string().min(1).describe('Inbox item ID'),
    },
    async ({ itemId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/me/inbox/${itemId}`,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_accept_inbox_item',
    'Accept an inbox item. Optionally provide a transaction ID.',
    {
      itemId: z.string().min(1).describe('Inbox item ID'),
      txid: z.string().min(1).optional().describe('On-chain transaction ID (if applicable)'),
    },
    async ({ itemId, txid }) => {
      try {
        requireState(AgentState.Authenticated);
        const body = txid ? { txid } : undefined;
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/me/inbox/${itemId}/accept`,
          body,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? { status: 'accepted' }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_reject_inbox_item',
    'Reject an inbox item.',
    {
      itemId: z.string().min(1).describe('Inbox item ID'),
    },
    async ({ itemId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/me/inbox/${itemId}/reject`,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? { status: 'rejected' }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_identity_raw',
    'Get the authenticated agent\'s raw on-chain identity data and UTXO information.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/me/identity/raw',
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
