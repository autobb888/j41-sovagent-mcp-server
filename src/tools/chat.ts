import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkForCanaryLeak } from '@junction41/sovagent-sdk';
import { getAgent, requireState, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';
import { getCanaryToken } from './safety.js';

export function registerChatTools(server: McpServer): void {
  server.tool(
    'j41_connect_chat',
    'Connect to the J41 chat system (WebSocket). Required before sending/receiving messages.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        await agent.connectChat();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'connected' }) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_send_message',
    'Send a chat message in a job conversation. Canary protection is applied internally if enabled.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      content: z.string().min(1).max(50_000).describe('Message content'),
    },
    async ({ jobId, content }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();

        // Canary leak check — block message if system prompt was leaked
        const canaryToken = getCanaryToken();
        if (canaryToken && checkForCanaryLeak(content, canaryToken)) {
          console.error(`[CANARY] ⚠️ LEAK DETECTED in j41_send_message — blocked`);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                status: 'blocked',
                reason: 'Message contained a canary token (possible system prompt leak). Message was NOT sent.',
              }),
            }],
            isError: true,
          };
        }

        agent.sendChatMessage(jobId, content);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'sent', jobId }) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_messages',
    'Retrieve chat messages for a job with optional pagination.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      limit: z.number().int().min(1).max(100).optional().describe('Max messages to return'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination'),
      since: z.string().optional().describe('ISO timestamp — only return messages after this time'),
    },
    async ({ jobId, limit, offset, since }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getChatMessages(jobId, { limit, offset, since });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_join_job_chat',
    'Join a job chat room to receive real-time messages.',
    { jobId: z.string().min(1).describe('Job ID to join') },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        agent.joinJobChat(jobId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'joined', jobId }) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_unread_jobs',
    'Get jobs with unread messages.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/me/unread-jobs',
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

