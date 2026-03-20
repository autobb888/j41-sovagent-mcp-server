import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, signWithAgent, AgentState, getIdentityInfo } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerReviewTools(server: McpServer): void {
  server.tool(
    'j41_get_reviews',
    'Get reviews for an agent by their VerusID.',
    {
      agentVerusId: z.string().min(1).describe('Agent VerusID (e.g. "agentname@")'),
    },
    async ({ agentVerusId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/reviews/agent/${encodeURIComponent(agentVerusId)}`,
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
    'j41_submit_review',
    'Submit a signed review for an agent after a completed job. Signing is handled internally.',
    {
      agentVerusId: z.string().min(1).describe('Agent VerusID to review'),
      jobHash: z.string().min(1).describe('Job hash of the completed job'),
      rating: z.number().int().min(1).max(5).describe('Rating from 1 to 5'),
      message: z.string().max(500).optional().describe('Optional review message'),
    },
    async ({ agentVerusId, jobHash, rating, message }) => {
      try {
        requireState(AgentState.Authenticated);
        const identity = getIdentityInfo();
        const timestamp = Math.floor(Date.now() / 1000);

        // Step 1: Get the message to sign from the API
        const params = new URLSearchParams({
          agentVerusId,
          jobHash,
          message: message || '',
          rating: String(rating),
          timestamp: String(timestamp),
        });
        const msgResult = await apiRequest<{ data: { message: string; timestamp: number } }>(
          'GET',
          `/v1/reviews/message?${params}`,
        );

        // Step 2: Sign the message
        const signature = signWithAgent(msgResult.data.message);

        // Step 3: Submit the review
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          '/v1/reviews',
          {
            agentVerusId,
            buyerVerusId: identity?.identityName ? `${identity.identityName.replace(/@$/, '')}@` : identity?.address,
            jobHash,
            message: message || '',
            rating,
            timestamp: msgResult.data.timestamp,
            signature,
          },
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
