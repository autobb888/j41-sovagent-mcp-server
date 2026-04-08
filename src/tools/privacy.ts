import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgent, requireState, AgentState } from '../state.js';
import { apiRequest } from './api-request.js';
import { errorResult } from './error.js';

export function registerPrivacyTools(server: McpServer): void {
  server.tool(
    'j41_set_privacy_tier',
    'Set the agent\'s privacy tier (standard, private, sovereign). Higher tiers command higher prices.',
    {
      tier: z.enum(['standard', 'private', 'sovereign']).describe('Privacy tier'),
    },
    async ({ tier }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        await agent.setPrivacyTier(tier);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ status: 'updated', tier }),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_get_privacy_tier',
    'Get the agent\'s current privacy tier.',
    {},
    async () => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const tier = agent.getPrivacyTier();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ tier }) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_attest_deletion',
    'Create and submit a signed deletion attestation for job data. Proves data was destroyed after job completion.',
    {
      jobId: z.string().min(1).describe('Job ID'),
      containerId: z.string().min(1).describe('Container/environment ID that was destroyed'),
      createdAt: z.string().optional().describe('ISO timestamp when container was created'),
      destroyedAt: z.string().optional().describe('ISO timestamp when container was destroyed'),
      dataVolumes: z.array(z.string()).optional().describe('List of data volume paths that were deleted'),
      deletionMethod: z.string().optional().describe('Deletion method (e.g. "shred", "container-destroy")'),
    },
    async ({ jobId, containerId, createdAt, destroyedAt, dataVolumes, deletionMethod }) => {
      try {
        requireState(AgentState.Authenticated);
        const agent = getAgent();
        const attestation = await agent.attestDeletion(jobId, containerId, {
          createdAt,
          destroyedAt,
          dataVolumes,
          deletionMethod,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(attestation, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_set_data_policy',
    'Set the agent\'s data handling policy.',
    {
      retention: z.enum(['ephemeral', 'session', 'persistent']).optional().describe('Data retention policy'),
      sharing: z.enum(['none', 'anonymized', 'full']).optional().describe('Data sharing policy'),
      encryption: z.boolean().optional().describe('Whether data at rest is encrypted'),
    },
    async (policy) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'PUT',
          '/v1/me/data-policy',
          policy,
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
    'j41_get_job_data_terms',
    'Get data handling terms for a specific job.',
    {
      jobId: z.string().min(1).describe('Job ID'),
    },
    async ({ jobId }) => {
      try {
        requireState(AgentState.Authenticated);
        const result = await apiRequest<{ data: unknown }>(
          'GET',
          `/v1/jobs/${encodeURIComponent(jobId)}/data-terms`,
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
