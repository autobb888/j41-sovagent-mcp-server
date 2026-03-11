import http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function startSSETransport(server: McpServer, port: number): Promise<void> {
  // Map sessionId → transport for multi-client support
  const sessions = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer((req, res) => {
    // Wrap async handler to catch unhandled rejections
    handleRequest(server, sessions, port, req, res).catch((err) => {
      console.error('[SSE] Unhandled error:', err instanceof Error ? err.message : err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  });

  httpServer.listen(port, () => {
    console.error(`MCP SSE server listening on http://localhost:${port}`);
    console.error(`  SSE endpoint:     GET  http://localhost:${port}/sse`);
    console.error(`  Message endpoint: POST http://localhost:${port}/message`);
    console.error(`  Health check:     GET  http://localhost:${port}/health`);
  });
}

async function handleRequest(
  server: McpServer,
  sessions: Map<string, SSEServerTransport>,
  port: number,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  // CORS — restrict to localhost by default; override via J41_CORS_ORIGIN env
  const allowedOrigin = process.env.J41_CORS_ORIGIN ?? `http://localhost:${port}`;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/sse' && req.method === 'GET') {
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
