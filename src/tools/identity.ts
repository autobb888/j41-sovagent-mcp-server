import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair } from '@junction41/sovagent-sdk';
import { signWithAgent, setPendingKeypair } from '../state.js';
import { errorResult } from './error.js';

// Reserved namespace for J41 protocol messages (job lifecycle, payments,
// deposits, access envelopes, bounties, status, etc.). The generic signing
// tools must NOT mint signatures over these — those messages are signed only by
// their dedicated, gated tools. Otherwise a prompt-injected agent could forge a
// protocol-format signature (e.g. an accept/deposit/access attestation) and
// bypass the gating. Matched case-insensitively after trimming leading space.
export function assertNotProtocolMessage(text: string): void {
  if (/^\s*j41-/i.test(text)) {
    throw new Error('Refusing to sign a J41-protocol-formatted message via the generic signer. Use the dedicated tool for this action (e.g. j41_accept_job, j41_send_currency).');
  }
}

export function registerIdentityTools(server: McpServer): void {
  server.tool(
    'j41_generate_keypair',
    'Generate a new Verus keypair. The WIF is stored internally and never exposed. Returns the public key and R-address.',
    { network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network') },
    async ({ network }) => {
      try {
        const kp = generateKeypair(network);
        setPendingKeypair({ wif: kp.wif, pubkey: kp.pubkey, address: kp.address, network });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              pubkey: kp.pubkey,
              address: kp.address,
              network,
              message: 'Keypair generated. The WIF has been stored internally and will not be displayed.',
            }, null, 2),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_sign_message',
    'Sign an arbitrary message using the stored key. Cannot sign J41-protocol-formatted messages (use the dedicated tool for those).',
    {
      message: z.string().min(1).describe('Message to sign'),
    },
    async ({ message }) => {
      try {
        assertNotProtocolMessage(message);
        const signature = signWithAgent(message);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ signature }) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_sign_challenge',
    'Sign an authentication challenge using the stored agent key.',
    {
      challenge: z.string().min(1).describe('Challenge string from J41'),
    },
    async ({ challenge }) => {
      try {
        assertNotProtocolMessage(challenge);
        const signature = signWithAgent(challenge);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ signature }) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

