import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireState, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerServiceTools(server: McpServer): void {
  server.tool(
    'j41_browse_services',
    'Browse marketplace services with optional filters.',
    {
      category: z.string().min(1).optional().describe('Filter by category'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results to return'),
      offset: z.number().int().min(0).optional().describe('Offset for pagination'),
    },
    async ({ category, limit, offset }) => {
      try {
        // Public endpoint
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        if (limit != null) params.set('limit', String(limit));
        if (offset != null) params.set('offset', String(offset));
        const qs = params.toString();
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/services${qs ? `?${qs}` : ''}`,
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
    'j41_get_service',
    'Get detail of a specific service.',
    {
      serviceId: z.string().min(1).describe('Service ID'),
    },
    async ({ serviceId }) => {
      try {
        // Public endpoint
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/services/${encodeURIComponent(serviceId)}`,
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
    'j41_get_agent_services',
    'List services offered by a specific agent.',
    {
      verusId: z.string().min(1).describe('Agent VerusID (e.g. "agentname@")'),
    },
    async ({ verusId }) => {
      try {
        // Public endpoint
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/services/agent/${encodeURIComponent(verusId)}`,
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
    'j41_get_service_categories',
    'List available service categories.',
    {},
    async () => {
      try {
        // Public endpoint
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/services/categories',
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
    'j41_get_my_services',
    'List the authenticated agent\'s own services.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          '/v1/me/services',
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
    'j41_update_service',
    'Update an existing service listing.',
    {
      serviceId: z.string().min(1).describe('Service ID to update'),
      name: z.string().min(1).max(100).optional().describe('Updated service name'),
      description: z.string().max(5000).optional().describe('Updated description'),
      category: z.string().min(1).max(100).optional().describe('Updated category'),
      price: z.number().min(0).optional().describe('Updated price'),
      currency: z.string().min(1).max(10).optional().describe('Updated currency'),
      turnaround: z.string().min(1).max(100).optional().describe('Updated turnaround time'),
      acceptedCurrencies: z.array(z.object({
        currency: z.string().min(1),
        price: z.number().min(0),
      })).optional().describe('Updated accepted currencies'),
      paymentTerms: z.enum(['prepay', 'postpay', 'split']).optional().describe('Updated payment terms'),
      privateMode: z.boolean().optional().describe('Updated private mode flag'),
      sovguard: z.boolean().optional().describe('Updated SovGuard flag'),
    },
    async ({ serviceId, ...updates }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'PUT',
          `/v1/me/services/${encodeURIComponent(serviceId)}`,
          updates,
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
    'j41_delete_service',
    'Delete a service listing.',
    {
      serviceId: z.string().min(1).describe('Service ID to delete'),
    },
    async ({ serviceId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'DELETE',
          `/v1/me/services/${encodeURIComponent(serviceId)}`,
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
