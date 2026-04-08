import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildDisputeRespondMessage, buildReworkAcceptMessage } from '@j41/sovagent-sdk';
import { getAgent, requireState, signWithAgent, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerDisputeTools(server: McpServer): void {
  server.tool(
    'j41_respond_to_dispute',
    'Respond to a buyer dispute. Agent can offer refund, rework, or reject the dispute. Signing is handled internally.',
    {
      jobId: z.string().min(1).describe('Job ID of the disputed job'),
      action: z.enum(['refund', 'rework', 'rejected']).describe('Response action: refund (return funds), rework (redo the job), or rejected (dispute the claim)'),
      refundPercent: z.number().min(1).max(100).optional().describe('Refund percentage (1-100, required if action is refund)'),
      reworkCost: z.number().min(0).optional().describe('Additional VRSC cost for rework (0 = free rework)'),
      message: z.string().min(1).max(5000).describe('Agent statement explaining the response'),
    },
    async ({ jobId, action, refundPercent, reworkCost, message }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();

        // Validate refundPercent required for refund action
        if (action === 'refund' && refundPercent == null) {
          return errorResult(new Error('refundPercent is required when action is refund'));
        }

        // Fetch job to get hash for signing — use SDK builder for format consistency
        const job = await agent.client.getJob(jobId);
        const jobHash = job.signatures?.request || job.jobHash || job.id;
        const timestamp = Math.floor(Date.now() / 1000);
        const signMsg = buildDisputeRespondMessage({ jobHash, action, timestamp });
        const signature = signWithAgent(signMsg);

        const result = await agent.client.respondToDispute(jobId, {
          action,
          refundPercent,
          reworkCost,
          message,
          timestamp,
          signature,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_accept_rework',
    'Accept an agent\'s rework offer for a disputed job (buyer side). Signing is handled internally.',
    {
      jobId: z.string().min(1).describe('Job ID of the disputed job'),
    },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();

        const job = await agent.client.getJob(jobId);
        const jobHash = job.signatures?.request || job.jobHash || job.id;
        const timestamp = Math.floor(Date.now() / 1000);
        const signMsg = buildReworkAcceptMessage({ jobHash, timestamp });
        const signature = signWithAgent(signMsg);

        const result = await agent.client.acceptRework(jobId, { timestamp, signature });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_dispute',
    'Get dispute details for a job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
    },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/jobs/${encodeURIComponent(jobId)}/dispute`,
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
    'j41_submit_refund_txid',
    'Submit a refund transaction ID for a disputed job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      txid: z.string().min(1).describe('Refund transaction ID'),
    },
    async ({ jobId, txid }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/jobs/${encodeURIComponent(jobId)}/dispute/refund-txid`,
          { txid },
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
    'j41_get_dispute_metrics',
    'Get an agent\'s public dispute track record.',
    {
      verusId: z.string().min(1).describe('Agent VerusID (e.g. "agentname@")'),
    },
    async ({ verusId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/agents/${encodeURIComponent(verusId)}/dispute-metrics`,
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
