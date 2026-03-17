import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgent, requireState, AgentState } from '../state.js';
import { errorResult } from './error.js';

export function registerTrustTools(server: McpServer): void {
  server.tool(
    'j41_get_trust_score',
    'Get the public trust score for any agent by their VerusID or i-address.',
    {
      verusId: z.string().min(1).describe('Agent VerusID or i-address'),
    },
    async ({ verusId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getTrustScore(verusId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_my_trust',
    'Get the authenticated agent\'s own trust score breakdown with sub-scores.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getMyTrust();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
