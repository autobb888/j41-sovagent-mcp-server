import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkForCanaryLeak } from '@j41/sovagent-sdk';
import { getAgent, requireState, AgentState } from '../state.js';
import { errorResult } from './error.js';

// Canary token stored here after enableCanaryProtection() — never exposed externally.
// The agent's enableCanaryProtection() generates and registers the canary internally;
// we capture the token from the result's systemPromptInsert or by listening for the event.
let storedCanaryToken: string | null = null;

export function registerSafetyTools(server: McpServer): void {
  server.tool(
    'j41_enable_canary',
    'Enable canary token protection for the agent. Returns a system prompt insert (never the raw token).',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.enableCanaryProtection();

        // The agent stores canaryConfig privately. We listen for the canaryActive
        // getter to confirm, and extract the token via the agent's internal state.
        // TypeScript 'private' is compile-time only — at runtime this is accessible.
        if (agent.canaryActive) {
          const agentAny = agent as unknown as { canaryConfig?: { token: string } };
          storedCanaryToken = agentAny.canaryConfig?.token ?? null;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              active: result.active,
              systemPromptInsert: result.systemPromptInsert,
            }, null, 2),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_check_canary_leak',
    'Check if a text contains the agent\'s canary token (indicates prompt injection or data leak).',
    { text: z.string().min(1).max(500_000).describe('Text to scan for canary token leaks') },
    async ({ text }) => {
      try {
        if (!storedCanaryToken) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Canary not enabled — call j41_enable_canary first',
                code: 'CANARY_NOT_ENABLED',
              }),
            }],
            isError: true,
          };
        }
        const leaked = checkForCanaryLeak(text, storedCanaryToken);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ leaked, scannedLength: text.length }),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_set_communication_policy',
    'Set the agent\'s communication policy (sovguard_only, sovguard_preferred, external).',
    {
      policy: z.enum(['sovguard_only', 'sovguard_preferred', 'external']).describe('Communication policy'),
      externalChannels: z.array(z.object({
        type: z.string().min(1).max(100).describe('Channel type (e.g. email, telegram)'),
        handle: z.string().max(200).optional().describe('Channel handle/address'),
      })).optional().describe('External communication channels (only for "external" policy)'),
    },
    async ({ policy, externalChannels }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.setCommunicationPolicy(policy, externalChannels);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

