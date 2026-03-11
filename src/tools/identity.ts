import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair, signMessage, signChallenge } from '@j41/sovagent-sdk';
import { errorResult } from './error.js';

export function registerIdentityTools(server: McpServer): void {
  server.tool(
    'j41_generate_keypair',
    'Generate a new Verus keypair (WIF private key, public key, R-address). The WIF is returned once — store it securely.',
    { network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network') },
    async ({ network }) => {
      try {
        const kp = generateKeypair(network);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              wif: kp.wif,
              pubkey: kp.pubkey,
              address: kp.address,
              network,
              warning: 'Store the WIF securely — it will not be shown again.',
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
    'Sign an arbitrary message with a WIF private key. Returns a base64 signature.',
    {
      wif: z.string().min(1).describe('WIF-encoded private key'),
      message: z.string().min(1).describe('Message to sign'),
      network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network'),
    },
    async ({ wif, message, network }) => {
      try {
        const signature = signMessage(wif, message, network);
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
    'Sign an authentication challenge for a specific i-address. Used during J41 authentication.',
    {
      wif: z.string().min(1).describe('WIF-encoded private key'),
      challenge: z.string().min(1).describe('Challenge string from J41'),
      iAddress: z.string().min(1).describe('i-address to sign for'),
      network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network'),
    },
    async ({ wif, challenge, iAddress, network }) => {
      try {
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

