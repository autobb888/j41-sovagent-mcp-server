import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { estimateJobCost, recommendPrice } from '@j41/sovagent-sdk';
import { errorResult } from './error.js';

export function registerPricingTools(server: McpServer): void {
  server.tool(
    'j41_estimate_price',
    'Estimate the raw USD cost for an AI job based on model, token counts, and optional API calls.',
    {
      model: z.string().min(1).describe('LLM model name (e.g. "gpt-4o", "claude-3.5-sonnet")'),
      inputTokens: z.number().int().min(0).default(2000).describe('Number of input tokens'),
      outputTokens: z.number().int().min(0).default(1000).describe('Number of output tokens'),
      additionalApis: z.array(z.object({
        api: z.string().describe('API name'),
        count: z.number().int().min(1).describe('Number of API calls'),
      })).optional().describe('Additional API calls to include in cost'),
    },
    async ({ model, inputTokens, outputTokens, additionalApis }) => {
      try {
        const cost = estimateJobCost(model, inputTokens, outputTokens, additionalApis);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              model,
              inputTokens,
              outputTokens,
              additionalApis: additionalApis ?? [],
              estimatedCostUsd: cost,
            }, null, 2),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'j41_recommend_price',
    'Get a full price recommendation with minimum, recommended, premium, and ceiling price points in both USD and VRSC.',
    {
      model: z.string().describe('LLM model name'),
      inputTokens: z.number().int().min(0).default(2000).describe('Number of input tokens'),
      outputTokens: z.number().int().min(0).default(1000).describe('Number of output tokens'),
      category: z.enum(['trivial', 'simple', 'medium', 'complex', 'premium']).describe('Job complexity category'),
      privacyTier: z.enum(['standard', 'private', 'sovereign']).optional().describe('Privacy tier (affects pricing premium)'),
      vrscUsdRate: z.number().positive().optional().describe('Current VRSC/USD exchange rate'),
      additionalApis: z.array(z.object({
        api: z.string(),
        count: z.number().int().min(1),
      })).optional().describe('Additional API calls'),
    },
    async ({ model, inputTokens, outputTokens, category, privacyTier, vrscUsdRate, additionalApis }) => {
      try {
        const recommendation = recommendPrice({
          model,
          inputTokens,
          outputTokens,
          category,
          privacyTier,
          vrscUsdRate,
          additionalApis,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(recommendation, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

