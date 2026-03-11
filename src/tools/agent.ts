import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AGENT_NAME_REGEX } from '@j41/sovagent-sdk';
import { initAgent, getAgent, getState, setState, getIdentityInfo, requireState, AgentState } from '../state.js';
import { errorResult } from './error.js';

export function registerAgentTools(server: McpServer): void {
  server.tool(
    'j41_init_agent',
    'Initialize the J41 agent with connection details and credentials. Must be called before authentication.',
    {
      apiUrl: z.string().url().describe('J41 API base URL'),
      wif: z.string().min(1).describe('WIF-encoded private key (never echoed back)'),
      identityName: z.string().min(1).optional().describe('VerusID name (e.g. myagent.agentplatform@)'),
      iAddress: z.string().min(1).optional().describe('i-address'),
      network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network'),
    },
    async ({ apiUrl, wif, identityName, iAddress, network }) => {
      try {
        const info = initAgent({ apiUrl, wif, identityName, iAddress, network });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'initialized',
              pubkey: info.pubkey,
              address: info.address,
              identityName: info.identityName,
              iAddress: info.iAddress,
              network: info.network,
            }, null, 2),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_authenticate',
    'Authenticate the agent with the J41 platform. Requires prior initialization.',
    {},
    async () => {
      try {
        requireState(AgentState.Initialized);
        const agent = getAgent();
        await agent.authenticate();
        setState(AgentState.Authenticated);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ status: 'authenticated', identity: agent.identity }),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_register_identity',
    'Register a new VerusID on the blockchain. This is a long-running operation that waits for blockchain confirmation.',
    {
      name: z.string().min(1).regex(AGENT_NAME_REGEX, 'Invalid identity name — only alphanumeric, dots, hyphens, underscores allowed').describe('Identity name to register'),
      network: z.enum(['verus', 'verustest']).default('verustest').describe('Verus network'),
    },
    async ({ name, network }) => {
      try {
        requireState(AgentState.Initialized);
        const agent = getAgent();
        const result = await agent.register(name, network);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'registered',
              identity: result.identity,
              iAddress: result.iAddress,
            }, null, 2),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_register_agent',
    'Register the agent profile on the J41 platform with full VDXF coverage (28 settable keys). Requires authentication.',
    {
      name: z.string().min(1).max(100).describe('Agent display name'),
      type: z.enum(['autonomous', 'assisted', 'hybrid', 'tool']).describe('Agent type'),
      description: z.string().min(1).max(5000).describe('Agent description'),
      category: z.string().min(1).max(100).optional().describe('Agent category (e.g. ai-assistant, automation)'),
      owner: z.string().min(1).max(200).optional().describe('Owner VerusID (e.g. myid@)'),
      tags: z.array(z.string().min(1).max(50)).max(20).optional().describe('Tags (max 20)'),
      website: z.string().url().optional().describe('Website URL'),
      avatar: z.string().url().optional().describe('Avatar image URL'),
      protocols: z.array(z.enum(['MCP', 'REST', 'A2A', 'WebSocket'])).optional().describe('Supported protocols'),
      endpoints: z.array(z.object({
        url: z.string().url(),
        protocol: z.enum(['MCP', 'REST', 'A2A', 'WebSocket']),
        public: z.boolean().optional(),
        description: z.string().max(1000).optional(),
      })).max(10).optional().describe('Service endpoints (max 10)'),
      capabilities: z.array(z.object({
        id: z.string().min(1).max(100),
        name: z.string().min(1).max(100),
        description: z.string().max(1000).optional(),
      })).max(50).optional().describe('Agent capabilities (max 50)'),
      session: z.object({
        duration: z.number().positive().optional().describe('Max session length in seconds'),
        tokenLimit: z.number().int().positive().optional().describe('Max LLM tokens per session'),
        imageLimit: z.number().int().positive().optional().describe('Max images per session'),
        messageLimit: z.number().int().positive().optional().describe('Max messages per session'),
        maxFileSize: z.number().int().positive().optional().describe('Max file size in bytes'),
        allowedFileTypes: z.array(z.string().min(1)).optional().describe('Allowed MIME types'),
      }).optional().describe('Session resource limits (published on-chain via VDXF)'),
      datapolicy: z.string().min(1).max(100).optional().describe('Data retention policy (ephemeral, session, persistent)'),
      trustlevel: z.string().min(1).max(100).optional().describe('Trust level (verified, unverified, premium)'),
      disputeresolution: z.string().min(1).max(100).optional().describe('Dispute resolution policy (platform, arbitration, mutual)'),
    },
    async (args) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.registerWithJ41(args);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ status: 'registered', agentId: result.agentId }, null, 2),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_register_service',
    'Register a service offering on the J41 platform. Requires authentication.',
    {
      name: z.string().min(1).max(100).describe('Service name'),
      description: z.string().max(5000).optional().describe('Service description'),
      category: z.string().min(1).max(100).optional().describe('Service category'),
      price: z.number().min(0).optional().describe('Price in VRSC'),
      currency: z.string().min(1).max(10).optional().describe('Currency (default: VRSC)'),
      turnaround: z.string().min(1).max(100).optional().describe('Expected turnaround time'),
    },
    async (args) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.registerService(args);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ status: 'registered', serviceId: result.serviceId }, null, 2),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_agent_status',
    'Get the current agent state, identity info, and connection flags.',
    {},
    async () => {
      try {
        const info = getIdentityInfo();
        const currentState = getState();

        const status: Record<string, unknown> = {
          state: currentState,
        };

        if (info) {
          status.pubkey = info.pubkey;
          status.address = info.address;
          status.identityName = info.identityName;
          status.iAddress = info.iAddress;
          status.network = info.network;
        }

        if (currentState !== AgentState.Uninitialized) {
          try {
            const agent = getAgent();
            status.identity = agent.identity;
            status.isRunning = agent.isRunning;
          } catch {
            // Agent not available
          }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

