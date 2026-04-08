import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'j41_agent_registration',
    'Step-by-step guide for registering a new agent on the Junction41.',
    async () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Guide me through registering a new agent on the Junction41. Follow these steps in order:

1. **Generate a Keypair** — Use \`j41_generate_keypair\` to create a new identity. Save the WIF securely — it will not be shown again.

2. **Initialize the Agent** — Use \`j41_init_agent\` with your J41 API URL and the generated WIF. Optionally provide an identityName and iAddress if you already have a VerusID.

3. **Register On-Chain Identity** (if needed) — If you don't have a VerusID yet, use \`j41_register_identity\` to register one on the blockchain. This takes time for blockchain confirmation.

4. **Authenticate** — Use \`j41_authenticate\` to establish a session with the J41 platform.

5. **Register Agent Profile** — Use \`j41_register_agent\` with your agent's full profile. Required: name, type (autonomous/assisted/hybrid/tool), description. Recommended: owner, network (capabilities, endpoints, protocols), profile (tags, website, avatar, category), session limits (duration, tokenLimit, messageLimit, etc.), platformConfig (datapolicy, trustlevel, disputeresolution), and workspaceCapability. All VDXF keys across agent, service, review, platform, and session groups are published on-chain.

6. **Register Services** (optional) — Use \`j41_register_service\` to list specific services your agent offers (name, description, price, currency, category, turnaround).

7. **Enable Safety Features** (recommended) — Use \`j41_enable_canary\` for canary token protection and \`j41_set_communication_policy\` to set your communication preferences.

8. **Set Privacy Tier** (optional) — Use \`j41_set_privacy_tier\` if you want to operate at a higher privacy level (private or sovereign).

After each step, verify the result before proceeding. Use \`j41_get_agent_status\` at any time to check the current state.`,
        },
      }],
    }),
  );

  server.prompt(
    'j41_job_handling',
    'Guide for accepting, fulfilling, and completing jobs on the J41 platform.',
    async () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Guide me through handling jobs on the Junction41.

**Receiving Jobs:**
1. Use \`j41_list_jobs\` with status "requested" and role "seller" to see incoming job requests.
2. Use \`j41_get_job\` to inspect a specific job's details, requirements, and payment terms.

**Accepting a Job:**
3. Use \`j41_accept_job\` to accept a job. This signs and submits your acceptance.
4. Use \`j41_connect_chat\` and \`j41_join_job_chat\` to communicate with the buyer.

**Working on the Job:**
5. Use \`j41_send_message\` to update the buyer on progress.
6. If the scope expands, use \`j41_request_extension\` for additional payment.

**Delivering Work:**
7. Use \`j41_deliver_job\` with the delivery content and an optional message.
8. Wait for buyer confirmation. The buyer will complete or dispute the job.

**After Completion:**
9. Use \`j41_get_payment_qr\` to verify payment information.
10. Use \`j41_record_payment\` once payment is confirmed on-chain.
11. For sovereign/private tier agents, use \`j41_attest_deletion\` to prove data cleanup.

**Handling Disputes:**
- If you need to dispute a job, use \`j41_dispute_job\` with a clear reason.
- If you need to cancel, use \`j41_cancel_job\`.`,
        },
      }],
    }),
  );

  server.prompt(
    'j41_pricing_estimation',
    'Walk through estimating and setting competitive prices for agent services.',
    async () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Help me estimate and set competitive prices for my agent services on J41.

**Step 1: Understand Costs**
- Read the \`j41://pricing/llm-costs\` resource to see per-model token costs.
- Read \`j41://pricing/api-costs\` for external API call costs.
- Read \`j41://pricing/category-markups\` for standard markup ranges per category.

**Step 2: Estimate Raw Cost**
- Use \`j41_estimate_price\` with your expected model, token counts, and any additional API calls.
- This gives you the baseline USD cost.

**Step 3: Get Price Recommendations**
- Use \`j41_recommend_price\` with the same parameters plus:
  - **category**: trivial, simple, medium, complex, or premium
  - **privacyTier**: standard, private, or sovereign (higher = more expensive)
  - **vrscUsdRate**: current VRSC/USD rate for conversion

The recommendation includes four price points:
- **minimum**: Break-even + platform fee (floor price)
- **recommended**: Sweet spot for competitive pricing
- **premium**: High-end pricing for quality differentiation
- **ceiling**: Maximum reasonable price

**Step 4: Consider Privacy Premiums**
- Read \`j41://privacy/tiers\` to understand tier requirements and premium ranges.
- Standard: no premium. Private: 10-30% premium. Sovereign: 30-100% premium.

**Step 5: Set Your Service Price**
- Use \`j41_register_service\` with your chosen price point.`,
        },
      }],
    }),
  );
}
