import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgent, requireState, getIdentityInfo, AgentState, getAllowlist, getRateLimiter } from '../state.js';
import { errorResult } from './error.js';
import { checkFinancialOp, logBlockedOperation } from '../allowlist.js';

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
    'Get unspent transaction outputs for the agent\'s R-address and i-address.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const info = getIdentityInfo();

        // Query R-address UTXOs
        const rResult = await agent.client.getUtxos(info?.address);

        // Query i-address UTXOs if available
        let iResult = null;
        if (info?.iAddress) {
          try {
            iResult = await agent.client.getUtxos(info.iAddress);
          } catch {
            // i-address query may not be supported by server
          }
        }

        const combined = {
          rAddress: {
            address: rResult.address,
            utxos: rResult.utxos,
            count: rResult.count,
          },
          ...(iResult ? {
            iAddress: {
              address: iResult.address,
              utxos: iResult.utxos,
              count: iResult.count,
            },
          } : {}),
          totalUtxos: rResult.count + (iResult?.count ?? 0),
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(combined, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Audit 2026-06-02 M-MCP-funds-1 / M-MCP-ddos-3: cap raw tx hex size at a
  // sane default. A 1 MB hex blob = 500 KB binary tx — well above any sensible
  // Verus tx. The 4 MB hard cap is loose enough for multi-output batched txs
  // (which the operator can override via env if they actually need it).
  const MAX_RAW_TX_HEX_CHARS = Number(process.env.J41_MCP_MAX_RAW_TX_HEX_CHARS ?? 4 * 1024 * 1024);

  server.tool(
    'j41_broadcast_tx',
    'Broadcast a raw signed transaction to the Verus network. Per audit, the rawhex string is bounded; full destination/value introspection is delegated to the upstream RPC.',
    { rawhex: z.string().min(1).max(MAX_RAW_TX_HEX_CHARS).describe('Raw hex-encoded signed transaction') },
    async ({ rawhex }) => {
      try {
        requireState(AgentState.Authenticated);
        if (!/^[0-9a-fA-F]+$/.test(rawhex)) {
          throw new Error('Invalid rawhex — must contain only hexadecimal characters');
        }
        if (rawhex.length % 2 !== 0) {
          throw new Error('Invalid rawhex — odd-length string is not a valid byte sequence');
        }

        // ── Global suspension check for broadcast ──
        // We cannot reliably parse destination from raw hex without a full tx
        // deserializer. But we CAN block broadcasts when globally suspended.
        const limiter = getRateLimiter();
        if (limiter.isSuspended()) {
          const reason = 'Financial operations suspended — broadcast_tx blocked';
          logBlockedOperation('j41_broadcast_tx', 'unknown(rawhex)', 0, '_broadcast', reason);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: reason,
              code: 'FINANCIAL_OP_BLOCKED',
            }) }],
            isError: true,
          };
        }

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

  server.tool(
    'j41_get_balance',
    'Get the authenticated agent\'s on-chain balance.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getBalance();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_verify_payment',
    'Verify a payment transaction on-chain.',
    {
      txid: z.string().min(1).describe('Transaction ID to verify'),
      expectedAddress: z.string().min(1).describe('Expected recipient address'),
      expectedAmount: z.number().positive().describe('Expected payment amount'),
      currency: z.string().min(1).describe('Currency (e.g. VRSC, VRSCTEST)'),
    },
    async ({ txid, expectedAddress, expectedAmount, currency }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.verifyPayment({ txid, expectedAddress, expectedAmount, currency });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_tx_status',
    'Get the status and confirmation count of a transaction.',
    {
      txid: z.string().min(1).describe('Transaction ID'),
    },
    async ({ txid }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getTxStatus(txid);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_send_currency',
    'Send VRSC/VRSCTEST to an R-address, i-address, or VerusID. Builds, signs, and broadcasts the transaction. ' +
    'Per audit 2026-06-02 C2, the `changeAddress` and `sourceAddress` parameters were removed — they bypassed ' +
    'the financial allowlist (sending dust to an allowlisted addr while routing the entire UTXO change to an attacker). ' +
    'The SDK defaults change to the agent\'s own R-address.',
    {
      to: z.string().min(1).describe('Destination: R-address, i-address, or VerusID (e.g. "alice@")'),
      amount: z.coerce.number().positive().describe('Amount in VRSC (not satoshis)'),
      // sourceAddress + changeAddress intentionally removed (Audit 2026-06-02 C2).
      // If a future use case requires them, they MUST be allowlist-validated below.
    },
    async ({ to, amount }) => {
      try {
        requireState(AgentState.Authenticated);

        // ── Allowlist + rate limit gate ──
        // Audit 2026-06-02 H-MCP-funds-1: jobPrice=Infinity silently disabled the
        // total-value cap (`1.1 * Infinity = Infinity`). Use a finite per-call cap.
        const jobId = '_standalone';
        const STANDALONE_MAX_VALUE_VRSC = Number(process.env.J41_MCP_STANDALONE_MAX_VRSC ?? '10');
        if (!Number.isFinite(STANDALONE_MAX_VALUE_VRSC) || STANDALONE_MAX_VALUE_VRSC <= 0) {
          throw new Error('J41_MCP_STANDALONE_MAX_VRSC must be a positive finite number');
        }
        if (amount > STANDALONE_MAX_VALUE_VRSC) {
          const reason = `BLOCKED: standalone send amount ${amount} exceeds cap ${STANDALONE_MAX_VALUE_VRSC} VRSC (set J41_MCP_STANDALONE_MAX_VRSC to raise)`;
          logBlockedOperation('j41_send_currency', to, amount, jobId, reason);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: reason,
              code: 'FINANCIAL_OP_BLOCKED',
            }) }],
            isError: true,
          };
        }
        const gate = checkFinancialOp(to, amount, jobId, STANDALONE_MAX_VALUE_VRSC, getAllowlist(), getRateLimiter());
        if (!gate.allowed) {
          logBlockedOperation('j41_send_currency', to, amount, jobId, gate.reason!);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: gate.reason,
              code: 'FINANCIAL_OP_BLOCKED',
            }) }],
            isError: true,
          };
        }

        const agent = getAgent();
        // SDK uses agent's own R-address as default change destination — no
        // operator/LLM override here. If the caller needs custom source/change
        // addresses, they should drive the SDK directly with explicit auditing.
        const txid = await agent.sendCurrency(to, amount);

        // Record successful send for rate limiting
        getRateLimiter().recordSend(jobId, amount);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ txid, to, amount }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_transfer_funds',
    'Transfer funds between the agent\'s R-address and i-address. Use "to-identity" to move R→i or "to-r-address" to move i→R.',
    {
      direction: z.enum(['to-identity', 'to-r-address']).describe('"to-identity" = R→i, "to-r-address" = i→R'),
      amount: z.coerce.number().positive().describe('Amount in VRSC to transfer'),
    },
    async ({ direction, amount }) => {
      try {
        requireState(AgentState.Authenticated);

        // ── Global suspension check ──
        // Transfer between own addresses is exempt from allowlist/rate-limit,
        // but NOT exempt from global suspension (API outage freeze).
        const limiter = getRateLimiter();
        if (limiter.isSuspended()) {
          const reason = 'Financial operations suspended — transfer_funds blocked';
          logBlockedOperation('j41_transfer_funds', `self(${direction})`, amount, '_transfer', reason);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: reason,
              code: 'FINANCIAL_OP_BLOCKED',
            }) }],
            isError: true,
          };
        }

        const agent = getAgent();
        const txid = await agent.transferFunds(direction, amount);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ txid, direction, amount }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

