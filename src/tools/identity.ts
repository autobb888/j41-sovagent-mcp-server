import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair, signMessage, signChallenge } from '@j41/sovagent-sdk';
import { signWithAgent, getNetwork } from '../state.js';
import { errorResult } from './error.js';

export function registerIdentityTools(server: McpServer): void {
  server.tool(
    'j41_generate_keypair',
    'Generate a new Verus keypair. The WIF is stored internally and never exposed. Returns the public key and R-address.',
    { network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network') },
    async ({ network }) => {
      try {
        const kp = generateKeypair(network);
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
    'Sign an arbitrary message. Uses the stored WIF by default; optionally provide an explicit WIF.',
    {
      wif: z.string().min(1).optional().describe('WIF-encoded private key (uses stored key if omitted)'),
      message: z.string().min(1).describe('Message to sign'),
      network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network'),
    },
    async ({ wif, message, network }) => {
      try {
        const signature = wif
          ? signMessage(wif, message, network)
          : signWithAgent(message);
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
    'Sign an authentication challenge for a specific i-address. Uses the stored WIF by default.',
    {
      wif: z.string().min(1).optional().describe('WIF-encoded private key (uses stored key if omitted)'),
      challenge: z.string().min(1).describe('Challenge string from J41'),
      iAddress: z.string().min(1).describe('i-address to sign for'),
      network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network'),
    },
    async ({ wif, challenge, iAddress, network }) => {
      try {
        if (!wif) {
          const signature = signWithAgent(challenge);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ signature }) }],
          };
        }
        const signature = signChallenge(wif, challenge, iAddress, network);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ signature }) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

