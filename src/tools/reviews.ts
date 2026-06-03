import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, signWithAgentBuilt, AgentState, getIdentityInfo } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

// Audit 2026-06-02 H-MCP-funds-2 confused-deputy: `j41_submit_review` used to
// blind-sign the message returned by GET /v1/reviews/message, letting a
// compromised/MITM'd platform substitute an arbitrary protocol message and
// harvest a signature usable elsewhere (J41-COMPLETE, J41-DEPOSIT-REPORT...).
// The full fix is in the SDK (build the canonical message locally — see SDK
// audit chunk-2 H1/H10). Until then, we enforce that the platform-supplied
// message starts with `J41-REVIEW|` and embeds the jobHash + rating we asked
// to sign — so the attacker can at best mint a review-shaped signature over
// our own review payload, not a fund-loss-shaped one.
function assertReviewMessageShape(
  msg: string,
  expected: { jobHash: string; rating: number },
): void {
  if (typeof msg !== 'string' || !msg.startsWith('J41-REVIEW|')) {
    throw new Error(
      'Platform-supplied review-signing message is not J41-REVIEW-shaped — refusing to sign',
    );
  }
  if (!msg.includes(`Job:${expected.jobHash}`)) {
    throw new Error(
      'Platform-supplied review-signing message does not bind our jobHash — refusing to sign',
    );
  }
  if (!msg.includes(`Rating:${expected.rating}`)) {
    throw new Error(
      'Platform-supplied review-signing message does not bind our rating — refusing to sign',
    );
  }
}

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

        // Step 2: Verify the platform-supplied message shape, then sign
        assertReviewMessageShape(msgResult.data.message, { jobHash, rating });
        const signature = signWithAgentBuilt(msgResult.data.message);

        // Step 3: Submit the review
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          '/v1/reviews',
          {
            agentVerusId,
            buyerVerusId: (() => {
              const name = identity?.identityName;
              return name ? (name.endsWith('@') ? name : name + '@') : identity?.address || '';
            })(),
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

  server.tool(
    'j41_get_reputation',
    'Get an agent\'s reputation score.',
    {
      verusId: z.string().min(1).describe('Agent VerusID (e.g. "agentname@")'),
    },
    async ({ verusId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/reputation/${encodeURIComponent(verusId)}`,
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
    'j41_get_top_agents',
    'Get top agents leaderboard by reputation.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/reputation/top',
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
    'j41_get_trust_history',
    'Get the authenticated agent\'s trust score history over time.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/me/trust/history',
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
    'j41_get_buyer_reviews',
    'Get reviews left by a specific buyer (by VerusID) with pagination.',
    {
      verusId: z.string().min(1).describe('Buyer VerusID (e.g. "buyername@")'),
      limit: z.number().int().min(1).max(100).optional().default(20).describe('Max results to return (default 20)'),
      offset: z.number().int().min(0).optional().default(0).describe('Offset for pagination (default 0)'),
    },
    async ({ verusId, limit, offset }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/reviews/buyer/${encodeURIComponent(verusId)}?limit=${limit}&offset=${offset}`,
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
    'j41_get_job_review',
    'Get the review associated with a specific job by its hash.',
    {
      jobHash: z.string().min(1).describe('Job hash to look up the review for'),
    },
    async ({ jobHash }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/reviews/job/${encodeURIComponent(jobHash)}`,
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
