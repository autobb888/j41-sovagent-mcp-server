import http from 'node:http';
import crypto from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Audit 2026-06-02 C4 — SSE transport fail-closed:
//   1. Bind 127.0.0.1 by default (was: Node default `::` — all interfaces)
//   2. If binding non-loopback, require J41_MCP_SSE_TOKEN to be set or refuse to start
//   3. Token check applies to BOTH /sse and /message (was: /sse only — /message was open)
//   4. Constant-time token comparison (was: `providedToken !== sseToken`, a timing oracle)
//   5. Cap inbound POST /message body size (was: unbounded — H-MCP-ddos-2)

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

export async function startSSETransport(server: McpServer, port: number): Promise<void> {
  const host = process.env.J41_MCP_SSE_HOST ?? DEFAULT_HOST;
  const sseToken = process.env.J41_MCP_SSE_TOKEN;

  // Fail-fast if binding non-loopback without a token.
  if (!LOOPBACK_HOSTS.has(host) && !sseToken) {
    throw new Error(
      `SSE refusing to start: J41_MCP_SSE_HOST=${host} (non-loopback) but J41_MCP_SSE_TOKEN is unset. ` +
      `Set J41_MCP_SSE_TOKEN to a high-entropy secret before exposing SSE off-loopback.`,
    );
  }

  const sessions = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer((req, res) => {
    handleRequest(server, sessions, sseToken, port, req, res).catch((err) => {
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
    const authState = sseToken ? 'bearer-token required' : 'no auth (loopback only)';
    console.error(`MCP SSE server listening on http://${host}:${port}  (${authState})`);
    console.error(`  SSE endpoint:     GET  http://${host}:${port}/sse`);
    console.error(`  Message endpoint: POST http://${host}:${port}/message`);
    console.error(`  Health check:     GET  http://${host}:${port}/health`);
  });
}

async function handleRequest(
  server: McpServer,
  sessions: Map<string, SSEServerTransport>,
  sseToken: string | undefined,
  port: number,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  void server; // intentionally retained: SSE handshake binds it below via transport

  // CORS — restrict to localhost by default. Audit 2026-06-02 L-MCP-bridge-7:
  // refuse a configured wildcard origin combined with the SSE token gate
  // (cross-origin readable session = token meaningless). Operator can still
  // override to a specific origin via J41_CORS_ORIGIN.
  const corsConfigured = process.env.J41_CORS_ORIGIN;
  if (corsConfigured === '*' && sseToken) {
    console.error(
      `[SSE] WARN: J41_CORS_ORIGIN=* combined with J41_CORS_ORIGIN=* defeats the SSE token gate. ` +
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

  // Audit C4: token gate applies to BOTH /sse and /message when set.
  if (sseToken && (url.pathname === '/sse' || url.pathname === '/message')) {
    const providedToken = extractToken(req);
    if (!constantTimeEquals(providedToken, sseToken)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
  }

  if (url.pathname === '/sse' && req.method === 'GET') {
    // Per-host concurrent-session cap (audit M-MCP-ddos-4 + LOW-MCP-ddos-7).
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

    // Audit H-MCP-ddos-2: inbound message size cap (was: unbounded).
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
