import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { AGENT_NAME_REGEX } from '@j41/sovagent-sdk';
import { initAgent, getAgent, getState, setState, getIdentityInfo, requireState, signWithAgent, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
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
    'Register the agent profile on the J41 platform with full VDXF coverage (20 keys across 8 groups). Requires authentication.',
    {
      name: z.string().min(1).max(100).describe('Agent display name'),
      type: z.enum(['autonomous', 'assisted', 'hybrid', 'tool']).describe('Agent type'),
      description: z.string().min(1).max(5000).describe('Agent description'),
      owner: z.string().min(1).max(200).optional().describe('Owner VerusID (e.g. myid@)'),
      network: z.object({
        capabilities: z.array(z.string()).optional().describe('Agent capabilities'),
        endpoints: z.array(z.string()).optional().describe('Service endpoint URLs'),
        protocols: z.array(z.string()).optional().describe('Supported protocols (MCP, REST, A2A, WebSocket)'),
      }).optional().describe('Network configuration (published as agent.network JSON blob)'),
      profile: z.object({
        tags: z.array(z.string().min(1).max(50)).max(20).optional().describe('Tags'),
        website: z.string().url().optional().describe('Website URL'),
        avatar: z.string().url().optional().describe('Avatar image URL'),
        category: z.string().min(1).max(100).optional().describe('Category'),
      }).optional().describe('Profile metadata (published as agent.profile JSON blob)'),
      session: z.object({
        duration: z.number().positive().optional().describe('Max session length in seconds'),
        tokenLimit: z.number().int().positive().optional().describe('Max LLM tokens per session'),
        imageLimit: z.number().int().positive().optional().describe('Max images per session'),
        messageLimit: z.number().int().positive().optional().describe('Max messages per session'),
        maxFileSize: z.number().int().positive().optional().describe('Max file size in bytes'),
        allowedFileTypes: z.array(z.string().min(1)).optional().describe('Allowed MIME types'),
      }).optional().describe('Session resource limits (published as session.params)'),
      platformConfig: z.object({
        datapolicy: z.string().optional().describe('Data retention policy (ephemeral, session, persistent)'),
        trustlevel: z.string().optional().describe('Trust level (verified, unverified, premium)'),
        disputeresolution: z.string().optional().describe('Dispute resolution policy (platform, arbitration, mutual)'),
      }).optional().describe('Platform configuration (published as platform.config)'),
      workspaceCapability: z.object({
        workspace: z.boolean(),
        modes: z.array(z.enum(['supervised', 'standard'])),
        tools: z.array(z.string()),
      }).optional().describe('Workspace capability declaration (published as workspace.capability)'),
      models: z.array(z.string().min(1).max(100)).max(20).optional().describe('LLM models used by this agent (e.g. ["kimi-k2.5", "claude-sonnet-4.6"])'),
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
      acceptedCurrencies: z.array(z.object({
        currency: z.string().min(1),
        price: z.number().min(0),
      })).optional().describe('Accepted currencies with prices (JSON array of {currency, price} objects)'),
      paymentTerms: z.enum(['prepay', 'postpay', 'split']).optional().describe('Payment terms'),
      privateMode: z.boolean().optional().describe('Whether the service is private'),
      sovguard: z.boolean().optional().describe('Whether SovGuard escrow protection is enabled'),
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

  server.tool(
    'j41_set_agent_status',
    'Toggle agent status between active and inactive. Signing is handled internally.',
    {
      agentId: z.string().min(1).describe('Agent ID'),
      status: z.enum(['active', 'inactive']).describe('New status'),
    },
    async ({ agentId, status: newStatus }) => {
      try {
        requireState(AgentState.Authenticated);
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = randomBytes(16).toString('hex');
        const message = `J41-STATUS|Agent:${agentId}|Status:${newStatus}|Ts:${timestamp}|Nonce:${nonce}`;
        const signature = signWithAgent(message);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          `/v1/agents/${agentId}/status`,
          { status: newStatus, timestamp, nonce, signature },
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? { status: newStatus }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_verification_status',
    'Get the verification status of an agent. No authentication required.',
    {
      agentId: z.string().min(1).describe('Agent ID to check verification status'),
    },
    async ({ agentId }) => {
      try {
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/agents/${encodeURIComponent(agentId)}/verification`,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_transparency_profile',
    'Get an agent\'s transparency profile including trust signals and public history. No authentication required.',
    {
      verusId: z.string().min(1).describe('Agent VerusID (e.g. "agentname@")'),
    },
    async ({ verusId }) => {
      try {
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/agents/${encodeURIComponent(verusId)}/transparency`,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_resolve_names',
    'Resolve an array of i-addresses to their VerusID names. Requires authentication.',
    {
      addresses: z.array(z.string().min(1)).min(1).describe('Array of i-addresses to resolve'),
    },
    async ({ addresses }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'POST',
          '/v1/resolve-names',
          { addresses },
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_my_identity',
    'Get the authenticated agent\'s on-chain identity data.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.client.getMyIdentity();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

