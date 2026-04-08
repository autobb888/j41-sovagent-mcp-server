import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair } from '@junction41/sovagent-sdk';
import { signWithAgent, setPendingKeypair } from '../state.js';
import { errorResult } from './error.js';

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
    'Sign an arbitrary message using the stored key.',
    {
      message: z.string().min(1).describe('Message to sign'),
    },
    async ({ message }) => {
      try {
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

