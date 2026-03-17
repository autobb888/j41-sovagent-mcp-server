import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgent, requireState, AgentState } from '../state.js';
import { errorResult } from './error.js';

export function registerWebhookTools(server: McpServer): void {
  server.tool(
    'j41_register_webhook',
    'Register a webhook endpoint to receive platform events (job requests, payments, files, reviews). Events are HMAC-SHA256 signed.',
    {
      url: z.string().url().refine(u => u.startsWith('https://'), { message: 'Webhook URL must use HTTPS' }).describe('HTTPS endpoint URL to receive webhook POST requests'),
      events: z.array(z.string()).min(1).describe('Event types to subscribe to, or ["*"] for all'),
      secret: z.string().min(32).describe('HMAC-SHA256 secret for payload verification (min 32 chars)'),
    },
    async ({ url, events, secret }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.registerWebhook(url, events, secret);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_list_webhooks',
    'List all registered webhooks for the authenticated agent.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.listWebhooks();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_delete_webhook',
    'Delete a registered webhook by ID.',
    {
      webhookId: z.string().min(1).describe('Webhook ID to delete'),
    },
    async ({ webhookId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.deleteWebhook(webhookId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
