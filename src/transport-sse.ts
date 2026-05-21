import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function startSSETransport(server: McpServer, port: number): Promise<void> {
  // Map sessionId → transport for multi-client support
  const sessions = new Map<string, SSEServerTransport>();

  // ── Bind to loopback by default ──
  // The SSE server exposes every tool (incl. fund movement); it must not listen
  // on all interfaces unless the operator explicitly opts in.
  const host = process.env.J41_MCP_SSE_HOST || '127.0.0.1';

  // ── Always require a bearer token ──
  // If none is provided we generate one and print it, so the endpoint is never
  // exposed unauthenticated.
  let sseToken = process.env.J41_MCP_SSE_TOKEN;
  if (!sseToken) {
    sseToken = randomBytes(24).toString('hex');
    console.error('[SSE] J41_MCP_SSE_TOKEN not set — generated an ephemeral token for this run:');
    console.error(`[SSE]   ${sseToken}`);
    console.error('[SSE] Pass it as "Authorization: Bearer <token>" (or x-mcp-token). Set J41_MCP_SSE_TOKEN to persist.');
  }

  // Host/Origin allowlist for DNS-rebinding protection.
  const allowedHosts = new Set([
    `${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`,
    ...(process.env.J41_MCP_SSE_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? []),
  ]);

  const httpServer = http.createServer((req, res) => {
    // Wrap async handler to catch unhandled rejections
    handleRequest(server, sessions, port, sseToken!, allowedHosts, req, res).catch((err) => {
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
    console.error(`MCP SSE server listening on http://${host}:${port}`);
    console.error(`  SSE endpoint:     GET  http://${host}:${port}/sse`);
    console.error(`  Message endpoint: POST http://${host}:${port}/message`);
    console.error(`  Health check:     GET  http://${host}:${port}/health`);
  });
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

async function handleRequest(
  server: McpServer,
  sessions: Map<string, SSEServerTransport>,
  port: number,
  sseToken: string,
  allowedHosts: Set<string>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  // DNS-rebinding guard — reject any request whose Host/Origin isn't allowlisted.
  if (!originAllowed(req, allowedHosts)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden origin/host' }));
    return;
  }

  // CORS — restrict to localhost by default; override via J41_CORS_ORIGIN env
  const allowedOrigin = process.env.J41_CORS_ORIGIN ?? `http://localhost:${port}`;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-mcp-token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/sse' && req.method === 'GET') {
    // Token is always required (generated at startup if not configured).
    const authHeader = req.headers['authorization'];
    const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-mcp-token'];
    if (providedToken !== sseToken) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }

    const transport = new SSEServerTransport('/message', res);
    sessions.set(transport.sessionId, transport);

    // Clean up on disconnect
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
    await transport.handlePostMessage(req, res);
    return;
  }

  // Health check
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', transport: 'sse', activeSessions: sessions.size }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}
