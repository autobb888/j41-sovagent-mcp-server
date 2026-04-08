import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgent, requireState, signWithAgent, AgentState, getAllowlist, getRateLimiter, reloadAllowlist } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';
import { checkFinancialOp, logBlockedOperation, addActiveJobAddress, removeActiveJobAddress, getAllowlistPath } from '../allowlist.js';

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

        // ── Allowlist lifecycle: add buyer refund address ──
        const buyerAddress = jobDetails.buyerPayAddress || jobDetails.buyer?.payAddress;
        if (buyerAddress) {
          addActiveJobAddress(getAllowlistPath(), jobId, buyerAddress);
          reloadAllowlist();
          console.error(`[allowlist] Added buyer address ${buyerAddress} for job ${jobId}`);
        }

        // ── Mandatory canary: auto-enable on job accept ──
        import('./safety.js').then(m => m.ensureCanaryEnabled()).catch(() => {});

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
        const job = await agent.client.deliverJob(jobId, deliveryHash, signature, timestamp, deliveryMessage);
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
        // Fetch job details to get jobHash for correct signing format
        const jobData = await apiRequest<{ data: { jobHash: string } }>('GET', `/v1/jobs/${encodeURIComponent(jobId)}`);
        const jobHash = jobData.data.jobHash;
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `J41-COMPLETE|Job:${jobHash}|Ts:${timestamp}|I confirm the work has been delivered satisfactorily.`;
        const signature = signWithAgent(message);
        const job = await agent.client.completeJob(jobId, signature, timestamp);

        // ── Allowlist lifecycle: remove buyer address + clear rate limit state ──
        removeActiveJobAddress(getAllowlistPath(), jobId);
        getRateLimiter().clearJob(jobId);
        reloadAllowlist();
        console.error(`[allowlist] Removed buyer address for completed job ${jobId}`);

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

        // ── Allowlist lifecycle: remove buyer address + clear rate limit state ──
        removeActiveJobAddress(getAllowlistPath(), jobId);
        getRateLimiter().clearJob(jobId);
        reloadAllowlist();
        console.error(`[allowlist] Removed buyer address for cancelled job ${jobId}`);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_create_job',
    'Create a new job request to hire another agent. Signing is handled internally.',
    {
      sellerVerusId: z.string().min(1).describe('VerusID of the agent to hire'),
      serviceId: z.string().min(1).optional().describe('Service ID to request'),
      description: z.string().min(1).max(2000).describe('Job description'),
      amount: z.number().positive().describe('Payment amount'),
      currency: z.string().min(1).max(10).default('VRSCTEST').describe('Currency'),
      deadline: z.string().optional().describe('Deadline as ISO date string'),
      paymentTerms: z.enum(['prepay', 'postpay', 'split']).default('prepay').describe('Payment terms'),
      sovguardEnabled: z.boolean().default(true).describe('Enable SovGuard protection'),
    },
    async ({ sellerVerusId, serviceId, description, amount, currency, deadline, paymentTerms, sovguardEnabled }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.createJob({
          sellerVerusId,
          serviceId,
          description,
          amount,
          currency,
          deadline,
          paymentTerms,
          sovguardEnabled,
        });
        const jobResult = result as any;

        // ── Allowlist lifecycle: add seller payment address + platform fee ──
        const jobData = jobResult?.data || jobResult;
        const sellerPayAddr = jobData?.payment?.address;
        const platformFeeAddr = jobData?.payment?.platformFeeAddress;
        if (sellerPayAddr) {
          addActiveJobAddress(getAllowlistPath(), jobData.id || 'unknown', sellerPayAddr);
        }
        if (platformFeeAddr) {
          addActiveJobAddress(getAllowlistPath(), `fee-${jobData.id || 'unknown'}`, platformFeeAddr);
        }
        // Also add the sellerVerusId (i-address) in case payment routes there
        if (sellerVerusId) {
          addActiveJobAddress(getAllowlistPath(), `seller-${jobData.id || 'unknown'}`, sellerVerusId);
        }
        reloadAllowlist();
        console.error(`[allowlist] Added seller ${sellerPayAddr || sellerVerusId} for job ${jobData.id}`);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_end_session',
    'Request end of session for a job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
    },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/jobs/${encodeURIComponent(jobId)}/end-session`,
        );

        // ── Allowlist lifecycle: remove buyer address + clear rate limit state ──
        removeActiveJobAddress(getAllowlistPath(), jobId);
        getRateLimiter().clearJob(jobId);
        reloadAllowlist();
        console.error(`[allowlist] Removed buyer address for ended session ${jobId}`);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_reject_delivery',
    'Reject a job delivery with a reason.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      reason: z.string().min(1).max(5000).describe('Reason for rejecting the delivery'),
    },
    async ({ jobId, reason }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/jobs/${encodeURIComponent(jobId)}/reject-delivery`,
          { reason },
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
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
        // Fetch job details to get jobHash for correct signing format
        const jobData = await apiRequest<{ data: { jobHash: string } }>('GET', `/v1/jobs/${encodeURIComponent(jobId)}`);
        const jobHash = jobData.data.jobHash;
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `J41-DISPUTE|Job:${jobHash}|Reason:${reason}|Ts:${timestamp}|I am raising a dispute on this job.`;
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

  server.tool(
    'j41_get_earnings',
    'Get earnings summary for the authenticated agent.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getMyEarnings();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_record_payment_combined',
    'Record a single combined payment transaction ID (agent + platform fee in one tx) for a job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      txid: z.string().min(1).describe('Transaction ID of the combined payment'),
    },
    async ({ jobId, txid }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.recordPaymentCombined(jobId, txid);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_record_platform_fee',
    'Record a platform fee transaction ID for a job (separate from agent payment).',
    {
      jobId: z.string().min(1).describe('Job ID'),
      txid: z.string().min(1).describe('Transaction ID of the platform fee payment'),
    },
    async ({ jobId, txid }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.recordPlatformFee(jobId, txid);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_send_multi_payment',
    'Send VRSC/VRSCTEST to multiple addresses in a single transaction (e.g. agent payment + platform fee). Builds, signs, and broadcasts.',
    {
      outputs: z.array(z.object({
        address: z.string().min(1).describe('Destination R-address, i-address, or VerusID'),
        amount: z.number().positive().describe('Amount in VRSC'),
      })).min(1).max(10).describe('Array of {address, amount} outputs'),
    },
    async ({ outputs }) => {
      try {
        requireState(AgentState.Authenticated);

        // ── Allowlist gate: check EVERY output address ──
        const allowlist = getAllowlist();
        const limiter = getRateLimiter();
        const total = outputs.reduce((s: number, o: { amount: number }) => s + o.amount, 0);
        const jobId = '_standalone';
        const jobPrice = Infinity;

        for (const output of outputs) {
          const gate = checkFinancialOp(output.address, output.amount, jobId, jobPrice, allowlist, limiter);
          if (!gate.allowed) {
            logBlockedOperation('j41_send_multi_payment', output.address, output.amount, jobId, gate.reason!);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `Output to ${output.address} blocked: ${gate.reason}`,
                code: 'FINANCIAL_OP_BLOCKED',
              }) }],
              isError: true,
            };
          }
        }

        const agent = getAgent();
        const txid = await agent.sendMultiPayment(outputs);

        // Record the full send
        limiter.recordSend(jobId, total);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ txid, outputs, totalAmount: total }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
