import http from 'node:http';
import crypto from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// SSE transport — defense-in-depth combining the parallel hardening branches:
//
// From audit 2026-06-02 C4 (this branch):
//   1. Bind 127.0.0.1 by default (was: Node default `::` — all interfaces)
//   2. Token check applies to BOTH /sse and /message (was: /sse only)
//   3. Constant-time token comparison (was: `!==`, a timing oracle)
//   4. Cap inbound POST /message body size (was: unbounded)
//   5. Per-host concurrent-session cap
//   6. Refuse J41_CORS_ORIGIN=* when the token gate is on
//
// From the parallel 3243a8f / fcc68db branch:
//   7. ALWAYS require a bearer token — auto-generate an ephemeral one and
//      print to stderr if J41_MCP_SSE_TOKEN is unset, so the endpoint is
//      never exposed unauthenticated (UX win over fail-fast).
//   8. DNS-rebinding guard: only accept requests whose Host/Origin is in
//      `<host>:<port>` + localhost forms + J41_MCP_SSE_ALLOWED_HOSTS.
//
// Reconciliation: we keep BOTH. Token is always required (auto-generated on
// loopback if not set). On non-loopback we still refuse to start without
// an explicit J41_MCP_SSE_TOKEN — printing an ephemeral token on a public
// interface would defeat the gate.

const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_MESSAGE_BYTES = Number(process.env.J41_MCP_SSE_MAX_MESSAGE_BYTES ?? 1024 * 1024); // 1 MB
const MAX_SESSIONS = Number(process.env.J41_MCP_SSE_MAX_SESSIONS ?? 64);

function constantTimeEquals(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string' || a.length === 0) return false;
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function extractToken(req: http.IncomingMessage): string | undefined {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  const x = req.headers['x-mcp-token'];
  return typeof x === 'string' ? x : Array.isArray(x) ? x[0] : undefined;
}

/** Reject requests whose Host/Origin isn't allowlisted (DNS-rebinding guard). */
function originAllowed(req: http.IncomingMessage, allowedHosts: Set<string>): boolean {
  const hostHeader = (req.headers.host ?? '').toLowerCase();
  if (hostHeader && !allowedHosts.has(hostHeader)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!allowedHosts.has(new URL(origin).host.toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function startSSETransport(server: McpServer, port: number): Promise<void> {
  const host = process.env.J41_MCP_SSE_HOST ?? DEFAULT_HOST;
  let sseToken = process.env.J41_MCP_SSE_TOKEN;

  // Non-loopback + no token → fail-fast (don't print an ephemeral on a public
  // interface; the operator must opt in explicitly).
  if (!LOOPBACK_HOSTS.has(host) && !sseToken) {
    throw new Error(
      `SSE refusing to start: J41_MCP_SSE_HOST=${host} (non-loopback) but J41_MCP_SSE_TOKEN is unset. ` +
      `Set J41_MCP_SSE_TOKEN to a high-entropy secret before exposing SSE off-loopback.`,
    );
  }
  // Loopback + no token → auto-generate an ephemeral and print it.
  if (!sseToken) {
    sseToken = crypto.randomBytes(24).toString('hex');
    console.error('[SSE] J41_MCP_SSE_TOKEN not set — generated an ephemeral token for this run:');
    console.error(`[SSE]   ${sseToken}`);
    console.error('[SSE] Pass it as "Authorization: Bearer <token>" (or x-mcp-token). Set J41_MCP_SSE_TOKEN to persist.');
  }

  // DNS-rebinding host allowlist. Includes loopback aliases + the listening
  // host:port + any additional hosts the operator allowlists.
  const allowedHosts = new Set([
    `${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`,
    ...(process.env.J41_MCP_SSE_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? []),
  ]);

  const sessions = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer((req, res) => {
    handleRequest(server, sessions, sseToken!, allowedHosts, port, req, res).catch((err) => {
      console.error('[SSE] Unhandled error:', err instanceof Error ? err.message : err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  });

  httpServer.listen(port, host, () => {
    console.error(`MCP SSE server listening on http://${host}:${port}  (bearer-token required)`);
    console.error(`  SSE endpoint:     GET  http://${host}:${port}/sse`);
    console.error(`  Message endpoint: POST http://${host}:${port}/message`);
    console.error(`  Health check:     GET  http://${host}:${port}/health`);
  });
}

async function handleRequest(
  server: McpServer,
  sessions: Map<string, SSEServerTransport>,
  sseToken: string,
  allowedHosts: Set<string>,
  port: number,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  // DNS-rebinding guard — reject any request whose Host/Origin isn't
  // allowlisted, before any further processing.
  if (!originAllowed(req, allowedHosts)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden origin/host' }));
    return;
  }

  // CORS — restrict to localhost by default. Audit 2026-06-02 L-MCP-bridge-7:
  // refuse a configured wildcard origin (cross-origin readable session =
  // token meaningless). Operator can still override to a specific origin via
  // J41_CORS_ORIGIN.
  const corsConfigured = process.env.J41_CORS_ORIGIN;
  if (corsConfigured === '*') {
    console.error(
      `[SSE] WARN: J41_CORS_ORIGIN=* defeats the SSE token gate. ` +
      `Falling back to http://localhost:${port}. Set a specific origin to override.`,
    );
  }
  const allowedOrigin = (corsConfigured && corsConfigured !== '*')
    ? corsConfigured
    : `http://localhost:${port}`;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-mcp-token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Token gate applies to BOTH /sse and /message. Constant-time compare so
  // the token can't leak via timing analysis.
  if (url.pathname === '/sse' || url.pathname === '/message') {
    const providedToken = extractToken(req);
    if (!constantTimeEquals(providedToken, sseToken)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
  }

  if (url.pathname === '/sse' && req.method === 'GET') {
    if (sessions.size >= MAX_SESSIONS) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many active SSE sessions', activeSessions: sessions.size, max: MAX_SESSIONS }));
      return;
    }

    const transport = new SSEServerTransport('/message', res);
    sessions.set(transport.sessionId, transport);

    res.on('close', () => {
      sessions.delete(transport.sessionId);
    });

    await server.connect(transport);
    return;
  }

  if (url.pathname === '/message' && req.method === 'POST') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing sessionId query parameter' }));
      return;
    }
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown session — connect to /sse first' }));
      return;
    }

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_MESSAGE_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large', limit: MAX_MESSAGE_BYTES }));
      return;
    }
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_MESSAGE_BYTES) {
        req.destroy(new Error('Payload too large'));
      }
    });

    await transport.handlePostMessage(req, res);
    return;
  }

  // Health check
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', transport: 'sse', activeSessions: sessions.size, maxSessions: MAX_SESSIONS }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}
