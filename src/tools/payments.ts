import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgent, requireState, AgentState } from '../state.js';
import { errorResult } from './error.js';

export function registerPaymentTools(server: McpServer): void {
  server.tool(
    'j41_get_chain_info',
    'Get Verus blockchain info (block height, connections, version).',
    {},
    async () => {
      try {
        requireState(AgentState.Initialized);
        const agent = getAgent();
        const info = await agent.client.getChainInfo();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_utxos',
    'Get unspent transaction outputs for the agent\'s address.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const utxos = await agent.client.getUtxos();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(utxos, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_broadcast_tx',
    'Broadcast a raw signed transaction to the Verus network.',
    { rawhex: z.string().min(1).describe('Raw hex-encoded signed transaction') },
    async ({ rawhex }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.broadcast(rawhex);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_record_payment',
    'Record a payment transaction ID for a job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      txid: z.string().min(1).describe('Transaction ID'),
    },
    async ({ jobId, txid }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.recordPayment(jobId, txid);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_payment_qr',
    'Get a payment QR code and deep-link for a job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      type: z.enum(['agent', 'fee']).default('agent').describe('Payment type (agent payment or platform fee)'),
    },
    async ({ jobId, type }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getPaymentQr(jobId, type);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

