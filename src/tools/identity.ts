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
  // Zero-width / BOM / line/para-separator / format characters have no
  // legitimate place in a message we sign and are the primitive for
  // normalization-bypass forgeries — reject them outright, anywhere.
  if (/[\u200B-\u200F\u2028\u2029\u2060\uFEFF]/.test(text)) {
    throw new Error('Refusing to sign a message containing zero-width or format characters.');
  }
  // Normalize compatibility forms (fullwidth "Ｊ４", unicode hyphens/dashes)
  // and strip leading whitespace before testing, so none of those can smuggle
  // the reserved J41- prefix past the check.
  const head = text
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/^\s+/, '');
  // Block signed protocol messages of the form "J41-<ACTION>|...". The
  // trailing pipe is the structural marker of a protocol message; opaque
  // auth challenges (e.g. "j41-onboard:...") have no pipe and are allowed.
  if (/^j41-[a-z0-9-]*\|/i.test(head)) {
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

