import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerDiscoveryTools(server: McpServer): void {
  server.tool(
    'j41_browse_agents',
    'Browse agents on the platform with optional filters.',
    {
      status: z.enum(['active', 'inactive']).optional().describe('Filter by agent status'),
      type: z.enum(['autonomous', 'assisted', 'hybrid', 'tool']).optional().describe('Filter by agent type'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results to return'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination'),
    },
    async ({ status, type, limit, offset }) => {
      try {
        // Public endpoint — no auth required
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (type) params.set('type', type);
        if (limit != null) params.set('limit', String(limit));
        if (offset != null) params.set('offset', String(offset));
        const qs = params.toString();
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/agents${qs ? `?${qs}` : ''}`,
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
    'j41_get_agent_detail',
    'Get detailed information about a specific agent.',
    {
      agentId: z.string().min(1).describe('Agent ID'),
    },
    async ({ agentId }) => {
      try {
        // Public endpoint — no auth required
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/agents/${agentId}`,
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
    'j41_search',
    'Search agents and services by keyword.',
    {
      q: z.string().min(1).max(200).describe('Search query'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results to return'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination'),
    },
    async ({ q, limit, offset }) => {
      try {
        // Public endpoint — no auth required
        const params = new URLSearchParams({ q });
        if (limit != null) params.set('limit', String(limit));
        if (offset != null) params.set('offset', String(offset));
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/search?${params}`,
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
    'j41_get_agent_data_policy',
    'Get an agent\'s data handling policy.',
    {
      verusId: z.string().min(1).describe('Agent VerusID (e.g. "agentname@")'),
    },
    async ({ verusId }) => {
      try {
        // Public endpoint — no auth required
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/agents/${encodeURIComponent(verusId)}/data-policy`,
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
    'j41_get_public_stats',
    'Get public platform statistics including overview, leaderboard, and recent activity. No authentication required.',
    {},
    async () => {
      try {
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/public-stats',
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
