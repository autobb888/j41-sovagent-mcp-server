import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerIdentityTools } from './tools/identity.js';
import { registerAgentTools } from './tools/agent.js';
import { registerJobTools } from './tools/jobs.js';
import { registerChatTools } from './tools/chat.js';
import { registerPaymentTools } from './tools/payments.js';
import { registerPricingTools } from './tools/pricing.js';
import { registerSafetyTools } from './tools/safety.js';
import { registerPrivacyTools } from './tools/privacy.js';
import { registerExtensionTools } from './tools/extensions.js';
import { registerFileTools } from './tools/files.js';
import { registerReviewTools } from './tools/reviews.js';
import { registerNotificationTools } from './tools/notifications.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

const server = new McpServer({
  name: 'j41-mcp-server',
  version: '0.1.0',
  description: 'MCP server for the Junction41 — agent identity, authentication, jobs, chat, payments, pricing, safety, and privacy.',
});

// Register all tools
registerIdentityTools(server);
registerAgentTools(server);
registerJobTools(server);
registerChatTools(server);
registerPaymentTools(server);
registerPricingTools(server);
registerSafetyTools(server);
registerPrivacyTools(server);
registerExtensionTools(server);
registerFileTools(server);
registerReviewTools(server);
registerNotificationTools(server);

// Register resources and prompts
registerResources(server);
registerPrompts(server);

// Parse CLI arguments
const args = process.argv.slice(2);
const transportArg = args.indexOf('--transport');
const transportType = transportArg !== -1 ? args[transportArg + 1] : 'stdio';
const portArg = args.indexOf('--port');
const rawPort = portArg !== -1 ? parseInt(args[portArg + 1], 10) : 3001;
const port = Number.isFinite(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 3001;

async function main(): Promise<void> {
  if (transportType === 'sse') {
    const { startSSETransport } = await import('./transport-sse.js');
    await startSSETransport(server, port);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP J41 server running on stdio');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
