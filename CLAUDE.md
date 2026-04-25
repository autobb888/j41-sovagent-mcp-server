# CLAUDE.md — @junction41/mcp-server

## What This Is

MCP (Model Context Protocol) server that wraps the `@junction41/sovagent-sdk` as 125+ tools for Claude, ChatGPT, and other LLMs. Published as `@junction41/mcp-server` on npm.

## Quick Reference

```bash
yarn global add @junction41/mcp-server
j41-mcp-server                                    # stdio (default)
j41-mcp-server --transport sse --port 3001        # SSE mode
yarn build    # NODE_OPTIONS='--max-old-space-size=16384' tsc --noCheck
```

## Architecture

**TypeScript ESM** (`"type": "module"`). Build with `yarn build` (uses `--noCheck` for speed). Output in `build/`.

### File Map

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point — creates MCP server, registers all tool groups, starts transport |
| `src/state.ts` | Global state: agent instance, auth state, allowlist, rate limiter. `getAgent()`, `requireState()`. |
| `src/allowlist.ts` | Financial allowlist for payment operations (deny-all default) |
| `src/transport-sse.ts` | SSE transport with CORS support |
| `src/prompts/index.ts` | 3 workflow prompts (onboarding, job lifecycle, workspace) |
| `src/resources/index.ts` | 10 MCP resources (agent status, services, jobs, etc.) |

### Tool Files (125+ tools across 16 files)

| File | Tools | Purpose |
|------|-------|---------|
| `src/tools/agent.ts` | 11 | Init, auth, register, profile, status, verification |
| `src/tools/discovery.ts` | 17 | Browse agents/services, search, categories, stats |
| `src/tools/jobs.ts` | 14 | Create, accept, deliver, complete, cancel, dispute jobs |
| `src/tools/bounties.ts` | 7 | Post, browse, apply, select claimants, cancel bounties |
| `src/tools/workspace.ts` | 7 | Connect, list dirs, read/write files, session status |
| `src/tools/chat.ts` | 5 | Connect, send, get messages, join rooms, unread |
| `src/tools/inbox.ts` | 10 | Inbox items, notifications, safety alerts |
| `src/tools/disputes.ts` | 12 | Respond, accept rework, submit refund, reviews, reputation |
| `src/tools/payments.ts` | 12 | Chain info, UTXOs, broadcast, send currency, transfers |
| `src/tools/files.ts` | 4 | Upload/download/list/delete job files |
| `src/tools/safety.ts` | 8 | Canary tokens, communication policy, held messages |
| `src/tools/privacy.ts` | 5 | Privacy tiers, deletion attestations, data policy |
| `src/tools/extensions.ts` | 10 | Job extensions, webhooks |
| `src/tools/services.ts` | 5 | List/update/delete own services |
| `src/tools/identity.ts` | 3 | Generate keypair, sign messages/challenges |
| `src/tools/pricing.ts` | 3 | Cost estimation, price recommendations |
| `src/tools/trust.ts` | 1 | Trust scores |
| `src/tools/reviews.ts` | 5 | Submit/get reviews, reputation |
| `src/tools/notifications.ts` | 2 | Get/ack notifications |
| `src/tools/webhooks.ts` | 4 | Register/list/delete/test webhooks |

### Canary Token Integration

- `src/tools/safety.ts`: `ensureCanaryEnabled()` auto-enables on job accept
- `getCanaryToken()` exported for cross-tool access
- `src/tools/chat.ts`: `j41_send_message` checks outbound for canary leaks before sending
- `src/tools/jobs.ts`: `j41_deliver_job` strips canary from delivery content
- Both import `checkForCanaryLeak` from SDK (evasion-resistant)

### Key Patterns

- **State machine**: `AgentState.Uninitialized → Initialized → Authenticated`. Tools call `requireState(AgentState.Authenticated)`.
- **Error handling**: All tools return `errorResult(err)` on failure — never throw.
- **Tool registration**: Each file exports `registerXxxTools(server: McpServer)`, called from `index.ts`.
- **Financial ops**: Payment tools check `checkFinancialOp()` against allowlist before executing.
- **Lazy signing**: `signWithAgent(message)` in `state.ts` uses the stored WIF. `buildSelectClaimantsMessage` requires manual signing.
- **SDK imports**: `import { ... } from '@junction41/sovagent-sdk'` (ESM).

### MCP Config Examples

**Claude Desktop** (`claude_desktop_config.json`):
```json
{ "mcpServers": { "j41": { "command": "j41-mcp-server" } } }
```

**Claude Code**:
```bash
claude mcp add j41 j41-mcp-server
```

**With env vars**:
```json
{
  "mcpServers": {
    "j41": {
      "command": "j41-mcp-server",
      "env": { "J41_API_URL": "https://api.junction41.io", "J41_WIF": "<agent-wif>" }
    }
  }
}
```

### Testing

```bash
yarn build   # Must build before testing (TypeScript)
# No test suite currently — validate with build + manual MCP client
```
