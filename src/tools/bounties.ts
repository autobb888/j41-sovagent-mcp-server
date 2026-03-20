import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, signWithAgent, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerBountyTools(server: McpServer): void {
  server.tool(
    'j41_browse_bounties',
    'Browse open bounties with optional filters.',
    {
      category: z.string().min(1).optional().describe('Filter by category'),
      minAmount: z.number().min(0).optional().describe('Minimum bounty amount'),
      maxAmount: z.number().min(0).optional().describe('Maximum bounty amount'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results to return'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination'),
    },
    async ({ category, minAmount, maxAmount, limit, offset }) => {
      try {
        // Public endpoint — no auth required
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        if (minAmount != null) params.set('minAmount', String(minAmount));
        if (maxAmount != null) params.set('maxAmount', String(maxAmount));
        if (limit != null) params.set('limit', String(limit));
        if (offset != null) params.set('offset', String(offset));
        const qs = params.toString();
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/bounties${qs ? `?${qs}` : ''}`,
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
    'j41_get_bounty',
    'Get bounty detail including applicants.',
    {
      bountyId: z.string().min(1).describe('Bounty ID'),
    },
    async ({ bountyId }) => {
      try {
        // Public endpoint — no auth required
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/bounties/${bountyId}`,
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
    'j41_post_bounty',
    'Post a new bounty. Signing is handled internally.',
    {
      title: z.string().min(1).max(200).describe('Bounty title'),
      description: z.string().min(1).max(2000).describe('Bounty description'),
      amount: z.number().positive().describe('Bounty amount'),
      currency: z.string().min(1).max(10).default('VRSC').describe('Currency (default: VRSC)'),
      category: z.string().min(1).max(100).optional().describe('Bounty category'),
      deadline: z.string().optional().describe('Deadline as ISO date string'),
    },
    async ({ title, description, amount, currency, category, deadline }) => {
      try {
        requireState(AgentState.Authenticated);
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `J41-BOUNTY|Post:${title}|Amount:${amount}|Currency:${currency}|Ts:${timestamp}|I commit to funding this bounty.`;
        const signature = signWithAgent(message);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          '/v1/bounties',
          { title, description, amount, currency, category, deadline, timestamp, signature },
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
    'j41_apply_to_bounty',
    'Apply to an open bounty. Signing is handled internally.',
    {
      bountyId: z.string().min(1).describe('Bounty ID to apply to'),
      message: z.string().max(5000).optional().describe('Application message'),
    },
    async ({ bountyId, message }) => {
      try {
        requireState(AgentState.Authenticated);
        const timestamp = Math.floor(Date.now() / 1000);
        const signMsg = `J41-BOUNTY-APPLY|Bounty:${bountyId}|Ts:${timestamp}`;
        const signature = signWithAgent(signMsg);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/bounties/${bountyId}/apply`,
          { message, timestamp, signature },
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
    'j41_select_bounty_claimants',
    'Select winning applicants for a bounty (poster only). Signing is handled internally.',
    {
      bountyId: z.string().min(1).describe('Bounty ID'),
      applicantIds: z.array(z.string().min(1)).min(1).describe('List of selected applicant IDs'),
    },
    async ({ bountyId, applicantIds }) => {
      try {
        requireState(AgentState.Authenticated);
        const timestamp = Math.floor(Date.now() / 1000);
        const signMsg = `J41-BOUNTY-SELECT|Bounty:${bountyId}|Selected:${applicantIds.join(',')}|Ts:${timestamp}`;
        const signature = signWithAgent(signMsg);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/bounties/${bountyId}/select`,
          { applicantIds, timestamp, signature },
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
    'j41_cancel_bounty',
    'Cancel an open bounty.',
    {
      bountyId: z.string().min(1).describe('Bounty ID to cancel'),
    },
    async ({ bountyId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'DELETE',
          `/v1/bounties/${bountyId}`,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? { status: 'cancelled' }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_my_bounties',
    'Get bounties for the authenticated agent, filtered by role (poster or applicant).',
    {
      role: z.enum(['poster', 'applicant']).optional().describe('Filter by role: poster (bounties I created) or applicant (bounties I applied to)'),
    },
    async ({ role }) => {
      try {
        requireState(AgentState.Authenticated);
        const params = new URLSearchParams();
        if (role) params.set('role', role);
        const qs = params.toString();
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/me/bounties${qs ? `?${qs}` : ''}`,
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
