/**
 * Workspace Tools — connect to buyer's project and work on files
 *
 * These tools let Claude/Cursor users manage workspace sessions
 * and interact with the buyer's local files through the J41 relay.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { errorResult } from './error.js';
import { requireState, getAgent, AgentState } from '../state.js';
import { WorkspaceClient } from '@junction41/sovagent-sdk';

// Active workspace connections — one per job for multi-job support.
// Each job gets its own WorkspaceClient instance (NOT agent.workspace singleton).
const workspaces = new Map<string, WorkspaceClient>();

// Audit 2026-06-02 M-MCP-ddos-4: bound concurrent workspace count to prevent
// long-running session leakage / memory growth under load.
const MAX_WORKSPACES = Number(process.env.J41_MCP_MAX_WORKSPACES ?? 32);

function getWorkspace(jobId: string): WorkspaceClient {
  const ws = workspaces.get(jobId);
  if (!ws || !ws.isConnected) {
    throw new Error(`No active workspace for job ${jobId}. Use j41_workspace_connect first.`);
  }
  return ws;
}

// Audit 2026-06-02 L-MCP-funds-1: path traversal previously only checked for
// raw '..' and leading '/'. Catches mixed-case URL-encoded forms (%2e%2e,
// %2E%2E), backslash separators (Windows), and absolute Windows paths.
function validatePath(p: string): void {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error('Invalid path: empty');
  }
  if (p.length > 4096) {
    throw new Error('Invalid path: exceeds 4096 chars');
  }
  // Decode percent-escapes so encoded traversal is caught.
  let decoded: string;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    throw new Error('Invalid path: malformed percent-encoding');
  }
  if (decoded !== p && (decoded.includes('..') || decoded.startsWith('/') || /^[A-Za-z]:/.test(decoded))) {
    throw new Error('Invalid path: encoded traversal detected');
  }
  if (p.includes('..') || p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) {
    throw new Error('Invalid path: must be relative and cannot contain ".."');
  }
  if (p.includes('\0')) {
    throw new Error('Invalid path: NUL byte');
  }
}

/** Disconnect all active workspace connections. Used during process shutdown. */
export function disconnectAllWorkspaces(): void {
  for (const [jobId, ws] of workspaces) {
    try { ws.disconnect(); } catch { /* best-effort */ }
    workspaces.delete(jobId);
  }
}

export function registerWorkspaceTools(server: McpServer): void {

  server.tool(
    'j41_workspace_connect',
    'Connect to a buyer\'s workspace session to access their project files',
    {
      jobId: z.string().min(1).describe('Job ID to connect workspace for'),
    },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();

        // Disconnect existing workspace for this job if any
        if (workspaces.has(jobId)) {
          workspaces.get(jobId)!.disconnect();
          workspaces.delete(jobId);
        }

        // Enforce concurrent-workspace cap (M-MCP-ddos-4)
        if (workspaces.size >= MAX_WORKSPACES) {
          throw new Error(
            `Too many concurrent workspaces (${workspaces.size} >= ${MAX_WORKSPACES}). ` +
            `Disconnect an existing workspace first or raise J41_MCP_MAX_WORKSPACES.`,
          );
        }

        // Create a fresh WorkspaceClient per job (not agent.workspace singleton)
        const ws = new WorkspaceClient({
          apiUrl: agent.client.getBaseUrl(),
          sessionToken: agent.client.getSessionToken()!,
        });
        await ws.connect(jobId);
        workspaces.set(jobId, ws);

        return {
          content: [{ type: 'text' as const, text: `Connected to workspace for job ${jobId}. You can now read/write files in the buyer's project.` }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_workspace_disconnect',
    'Disconnect from a workspace session and release resources.',
    {
      jobId: z.string().min(1).describe('Job ID to disconnect workspace for'),
    },
    async ({ jobId }) => {
      try {
        const ws = workspaces.get(jobId);
        if (ws) {
          ws.disconnect();
          workspaces.delete(jobId);
        }
        return {
          content: [{ type: 'text' as const, text: `Disconnected workspace for job ${jobId}.` }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_workspace_list_directory',
    'List files and directories in the buyer\'s project',
    {
      jobId: z.string().min(1).describe('Job ID'),
      path: z.string().optional().describe('Relative path (default: project root)'),
    },
    async ({ jobId, path }) => {
      try {
        if (path) validatePath(path);
        const ws = getWorkspace(jobId);
        const entries = await ws.listDirectory(path || '.');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_workspace_read_file',
    'Read a file from the buyer\'s project',
    {
      jobId: z.string().min(1).describe('Job ID'),
      path: z.string().min(1).describe('Relative path to the file'),
    },
    async ({ jobId, path }) => {
      try {
        validatePath(path);
        const ws = getWorkspace(jobId);
        const content = await ws.readFile(path);
        return {
          content: [{ type: 'text' as const, text: content }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_workspace_write_file',
    'Write content to a file in the buyer\'s project (may require buyer approval in supervised mode)',
    {
      jobId: z.string().min(1).describe('Job ID'),
      path: z.string().min(1).describe('Relative path to the file'),
      content: z.string().max(500_000).describe('File content to write'),
    },
    async ({ jobId, path, content }) => {
      try {
        validatePath(path);
        const ws = getWorkspace(jobId);
        const result = await ws.writeFile(path, content);
        return {
          content: [{ type: 'text' as const, text: result }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_workspace_status',
    'Get the current workspace session status and operation counts',
    {
      jobId: z.string().min(1).describe('Job ID'),
    },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const status = await agent.client.getWorkspaceStatus(jobId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_workspace_done',
    'Signal to the buyer that your work is complete. They will review and accept/reject.',
    {
      jobId: z.string().min(1).describe('Job ID'),
    },
    async ({ jobId }) => {
      try {
        const ws = getWorkspace(jobId);
        ws.signalDone();
        ws.disconnect();
        workspaces.delete(jobId);
        return {
          content: [{ type: 'text' as const, text: `Signaled done for job ${jobId}. Workspace disconnected. Waiting for buyer to accept.` }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
