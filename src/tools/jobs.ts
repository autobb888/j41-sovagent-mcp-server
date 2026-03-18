import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgent, requireState, signWithAgent, AgentState } from '../state.js';
import { errorResult } from './error.js';

const JOB_STATUS = z.enum([
  'requested', 'accepted', 'in_progress', 'delivered',
  'completed', 'disputed', 'rework', 'resolved', 'resolved_rejected', 'cancelled',
]).optional().describe('Filter by job status');

const MAX_CONTENT_LENGTH = 100_000;

export function registerJobTools(server: McpServer): void {
  server.tool(
    'j41_list_jobs',
    'List jobs filtered by status and/or role.',
    {
      status: JOB_STATUS,
      role: z.enum(['buyer', 'seller']).optional().describe('Filter by role'),
    },
    async ({ status, role }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getMyJobs({ status, role });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_job',
    'Get details of a specific job by ID.',
    { jobId: z.string().min(1).describe('Job ID') },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const job = await agent.client.getJob(jobId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_accept_job',
    'Accept a requested job. Signing is handled internally.',
    { jobId: z.string().min(1).describe('Job ID to accept') },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        // Fetch job details to build proper signing message
        const jobDetails = await agent.client.getJob(jobId);
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `J41-ACCEPT|Job:${jobDetails.jobHash}|Buyer:${jobDetails.buyerVerusId}|Amt:${jobDetails.amount} ${jobDetails.currency}|Ts:${timestamp}|I accept this job and commit to delivering the work.`;
        const signature = signWithAgent(message);
        const job = await agent.client.acceptJob(jobId, signature, timestamp);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_deliver_job',
    'Deliver work for a job. The delivery content is hashed and signed internally.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      deliveryContent: z.string().min(1).max(MAX_CONTENT_LENGTH).describe('Delivery content or hash'),
      deliveryMessage: z.string().max(MAX_CONTENT_LENGTH).optional().describe('Message to include with delivery'),
    },
    async ({ jobId, deliveryContent, deliveryMessage }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        // Fetch job details to build proper signing message
        const jobDetails = await agent.client.getJob(jobId);
        const timestamp = Math.floor(Date.now() / 1000);
        const { createHash } = await import('crypto');
        const deliveryHash = createHash('sha256').update(deliveryContent).digest('hex');
        const message = `J41-DELIVER|Job:${jobDetails.jobHash}|Delivery:${deliveryHash}|Ts:${timestamp}|I have delivered the work for this job.`;
        const signature = signWithAgent(message);
        const job = await agent.client.deliverJob(jobId, deliveryContent, signature, timestamp, deliveryMessage);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_complete_job',
    'Mark a job as completed. Signing is handled internally.',
    { jobId: z.string().min(1).describe('Job ID to complete') },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `complete:${jobId}:${timestamp}`;
        const signature = signWithAgent(message);
        const job = await agent.client.completeJob(jobId, signature, timestamp);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_cancel_job',
    'Cancel a job.',
    { jobId: z.string().min(1).describe('Job ID to cancel') },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const job = await agent.client.cancelJob(jobId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_dispute_job',
    'Dispute a job with a reason. Signing is handled internally.',
    {
      jobId: z.string().min(1).describe('Job ID to dispute'),
      reason: z.string().min(1).max(5000).describe('Reason for the dispute'),
    },
    async ({ jobId, reason }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `dispute:${jobId}:${reason}:${timestamp}`;
        const signature = signWithAgent(message);
        const job = await agent.client.disputeJob(jobId, reason, signature, timestamp);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

