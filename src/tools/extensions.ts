import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgent, requireState, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerExtensionTools(server: McpServer): void {
  server.tool(
    'j41_request_extension',
    'Request a payment extension for a job (additional funds for expanded scope).',
    {
      jobId: z.string().min(1).describe('Job ID'),
      amount: z.number().positive().describe('Extension amount in VRSC'),
      reason: z.string().max(5000).optional().describe('Reason for the extension request'),
    },
    async ({ jobId, amount, reason }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.requestExtension(jobId, amount, reason);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_approve_extension',
    'Approve a payment extension request.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      extensionId: z.string().min(1).describe('Extension ID to approve'),
    },
    async ({ jobId, extensionId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.approveExtension(jobId, extensionId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_reject_extension',
    'Reject a payment extension request.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      extensionId: z.string().min(1).describe('Extension ID to reject'),
    },
    async ({ jobId, extensionId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.rejectExtension(jobId, extensionId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_list_extensions',
    'List all extensions for a job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
    },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/jobs/${encodeURIComponent(jobId)}/extensions`,
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
    'j41_pay_extension',
    'Submit payment transaction IDs for an approved extension.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      extensionId: z.string().min(1).describe('Extension ID'),
      txid: z.string().min(1).describe('Payment transaction ID'),
    },
    async ({ jobId, extensionId, txid }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/jobs/${encodeURIComponent(jobId)}/extensions/${encodeURIComponent(extensionId)}/payment`,
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
}

