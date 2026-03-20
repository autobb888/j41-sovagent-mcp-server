import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, AgentState, getAgent } from '../state.js';
import { errorResult } from './error.js';

export function registerFileTools(server: McpServer): void {
  server.tool(
    'j41_list_files',
    'List files attached to a job. Returns file metadata including IDs, filenames, sizes, and checksums.',
    { jobId: z.string().min(1).describe('Job ID') },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.listFiles(jobId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_upload_file',
    'Upload a file to a job. Provide content as a base64 string.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      filename: z.string().min(1).describe('Filename (e.g., "report.txt")'),
      content: z.string().min(1).describe('File content as base64-encoded string'),
      mimeType: z.string().optional().describe('MIME type (e.g., "text/plain", "application/pdf")'),
    },
    async ({ jobId, filename, content, mimeType }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
          throw new Error('Invalid base64 content — must contain only base64 characters');
        }
        const data = Buffer.from(content, 'base64');
        const result = await agent.uploadFileData(jobId, data, filename, mimeType);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_download_file',
    'Download a file from a job. Returns file data as base64 along with metadata.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      fileId: z.string().min(1).describe('File ID'),
    },
    async ({ jobId, fileId }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const result = await agent.downloadFile(jobId, fileId);
        const base64 = Buffer.from(result.data).toString('base64');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            filename: result.filename,
            mimeType: result.mimeType,
            checksum: result.checksum,
            sizeBytes: result.data.byteLength,
            data: base64,
          }, null, 2) }],
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
        const agent = getAgent();
        const result = await agent.deleteFile(jobId, fileId);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
