import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerFileTools(server: McpServer): void {
  server.tool(
    'j41_list_files',
    'List files attached to a job.',
    { jobId: z.string().min(1).describe('Job ID') },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown[] }>(
          'GET',
          `/v1/jobs/${encodeURIComponent(jobId)}/files`,
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
    'j41_download_file',
    'Get download URL and metadata for a specific file on a job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      fileId: z.string().min(1).describe('File ID'),
    },
    async ({ jobId, fileId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}`,
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
    'j41_delete_file',
    'Delete a file from a job (uploader only).',
    {
      jobId: z.string().min(1).describe('Job ID'),
      fileId: z.string().min(1).describe('File ID to delete'),
    },
    async ({ jobId, fileId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'DELETE',
          `/v1/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}`,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? { status: 'deleted' }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
