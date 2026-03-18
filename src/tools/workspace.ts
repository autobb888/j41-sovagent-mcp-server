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
import { WorkspaceClient } from '@j41/sovagent-sdk';

// Active workspace connections — one per job for multi-job support.
// Each job gets its own WorkspaceClient instance (NOT agent.workspace singleton).
const workspaces = new Map<string, WorkspaceClient>();

function getWorkspace(jobId: string): WorkspaceClient {
  const ws = workspaces.get(jobId);
  if (!ws || !ws.isConnected) {
    throw new Error(`No active workspace for job ${jobId}. Use j41_workspace_connect first.`);
  }
  return ws;
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
    'j41_workspace_list_directory',
    'List files and directories in the buyer\'s project',
    {
      jobId: z.string().min(1).describe('Job ID'),
      path: z.string().optional().describe('Relative path (default: project root)'),
    },
    async ({ jobId, path }) => {
      try {
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
      content: z.string().describe('File content to write'),
    },
    async ({ jobId, path, content }) => {
      try {
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
        return {
          content: [{ type: 'text' as const, text: `Signaled done for job ${jobId}. Waiting for buyer to accept.` }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
