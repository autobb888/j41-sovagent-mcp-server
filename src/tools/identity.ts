import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair } from '@junction41/sovagent-sdk';
import { setPendingKeypair } from '../state.js';
import { errorResult } from './error.js';

// Audit 2026-06-02 C1/C3 removed `j41_sign_message` and `j41_sign_challenge`:
// they were raw signing oracles that let a prompt-injected LLM mint signatures
// over arbitrary `J41-*|...` protocol strings (J41-COMPLETE, J41-BOUNTY-SELECT,
// J41-DISPUTE-RESPOND, J41-STATUS) and submit them out-of-band to the platform.
// Every legitimate protocol action already has a typed tool that builds the
// canonical message internally — the raw oracle had no irreplaceable use case.
// `signWithAgent()` in state.ts now also rejects protocol-shaped strings as
// defense-in-depth for the typed tools.

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
}
