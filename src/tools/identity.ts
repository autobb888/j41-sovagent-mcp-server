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
//
// The previous parallel-hardening commit (3243a8f / fcc68db) had kept these
// tools and applied an `assertNotProtocolMessage` guard inline. That guard's
// unicode-normalization logic is preserved in src/security/protocol-guard.ts
// and applied at the choke-point inside `signWithAgent()` in state.ts, so the
// underlying defense survives without re-exposing the raw oracle.
//
// If a future caller legitimately needs to sign opaque text via MCP, add a
// typed tool that constructs the bytes from validated input — not a generic
// signing tool over caller-chosen strings.

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
