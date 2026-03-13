import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  LLM_COSTS,
  IMAGE_COSTS,
  API_COSTS,
  SELF_HOSTED_COSTS,
  CATEGORY_MARKUPS,
  PLATFORM_FEE,
  PRIVACY_TIERS,
  POLICY_LABELS,
  VDXF_KEYS,
  PARENT_KEYS,
  DATA_DESCRIPTOR_KEY,
  AGENT_NAME_REGEX,
  RESERVED_NAMES,
  VALID_PROTOCOLS,
  VALID_TYPES,
} from '@j41/sovagent-sdk';

export function registerResources(server: McpServer): void {
  server.resource(
    'llm-costs',
    'j41://pricing/llm-costs',
    { description: 'LLM model cost table (input/output per 1K tokens, typical job cost)' },
    async () => ({
      contents: [{
        uri: 'j41://pricing/llm-costs',
        mimeType: 'application/json',
        text: JSON.stringify(LLM_COSTS, null, 2),
      }],
    }),
  );

  server.resource(
    'image-costs',
    'j41://pricing/image-costs',
    { description: 'Image generation model cost table' },
    async () => ({
      contents: [{
        uri: 'j41://pricing/image-costs',
        mimeType: 'application/json',
        text: JSON.stringify(IMAGE_COSTS, null, 2),
      }],
    }),
  );

  server.resource(
    'api-costs',
    'j41://pricing/api-costs',
    { description: 'External API cost table (per-request pricing)' },
    async () => ({
      contents: [{
        uri: 'j41://pricing/api-costs',
        mimeType: 'application/json',
        text: JSON.stringify(API_COSTS, null, 2),
      }],
    }),
  );

  server.resource(
    'self-hosted-costs',
    'j41://pricing/self-hosted-costs',
    { description: 'Self-hosted model cost table (GPU type, hourly cost, effective token cost)' },
    async () => ({
      contents: [{
        uri: 'j41://pricing/self-hosted-costs',
        mimeType: 'application/json',
        text: JSON.stringify(SELF_HOSTED_COSTS, null, 2),
      }],
    }),
  );

  server.resource(
    'category-markups',
    'j41://pricing/category-markups',
    { description: 'Job category markup ranges (min/max multipliers for trivial → premium)' },
    async () => ({
      contents: [{
        uri: 'j41://pricing/category-markups',
        mimeType: 'application/json',
        text: JSON.stringify(CATEGORY_MARKUPS, null, 2),
      }],
    }),
  );

  server.resource(
    'platform-fee',
    'j41://pricing/platform-fee',
    { description: 'J41 platform fee rate' },
    async () => ({
      contents: [{
        uri: 'j41://pricing/platform-fee',
        mimeType: 'application/json',
        text: JSON.stringify({ platformFee: PLATFORM_FEE, description: '5% platform fee' }),
      }],
    }),
  );

  server.resource(
    'privacy-tiers',
    'j41://privacy/tiers',
    { description: 'Privacy tier definitions (standard, private, sovereign) with requirements and premium ranges' },
    async () => ({
      contents: [{
        uri: 'j41://privacy/tiers',
        mimeType: 'application/json',
        text: JSON.stringify(PRIVACY_TIERS, null, 2),
      }],
    }),
  );

  server.resource(
    'policy-labels',
    'j41://safety/policy-labels',
    { description: 'Communication policy labels and descriptions (safechat_only, safechat_preferred, external)' },
    async () => ({
      contents: [{
        uri: 'j41://safety/policy-labels',
        mimeType: 'application/json',
        text: JSON.stringify(POLICY_LABELS, null, 2),
      }],
    }),
  );

  server.resource(
    'vdxf-keys',
    'j41://onboarding/vdxf-keys',
    { description: 'All 36 VDXF field key i-addresses across 5 groups: agent (14), session (6), platform (3), service (7), review (6). On-chain data uses nested DataDescriptor format under parent keys.' },
    async () => ({
      contents: [{
        uri: 'j41://onboarding/vdxf-keys',
        mimeType: 'application/json',
        text: JSON.stringify({ ...VDXF_KEYS, parentKeys: PARENT_KEYS, DATA_DESCRIPTOR_KEY }, null, 2),
      }],
    }),
  );

  server.resource(
    'validation-rules',
    'j41://onboarding/validation-rules',
    { description: 'Agent name validation regex, reserved names, valid protocols, and valid agent types' },
    async () => ({
      contents: [{
        uri: 'j41://onboarding/validation-rules',
        mimeType: 'application/json',
        text: JSON.stringify({
          agentNameRegex: AGENT_NAME_REGEX.source,
          reservedNames: RESERVED_NAMES,
          validProtocols: VALID_PROTOCOLS,
          validTypes: VALID_TYPES,
        }, null, 2),
      }],
    }),
  );
}
