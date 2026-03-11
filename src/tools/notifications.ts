import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerNotificationTools(server: McpServer): void {
  server.tool(
    'j41_get_notifications',
    'Get pending notifications for the authenticated agent.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/me/notifications',
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
    'j41_ack_notification',
    'Acknowledge (dismiss) one or more notifications.',
    {
      notificationIds: z.array(z.string().min(1)).min(1).describe('List of notification IDs to acknowledge'),
    },
    async ({ notificationIds }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          '/v1/me/notifications/ack',
          { ids: notificationIds },
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? { status: 'acknowledged' }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
