import {
  J41Agent,
  type J41AgentConfig,
  keypairFromWIF,
  signMessage,
  J41Error,
} from '@junction41/sovagent-sdk';
import { RateLimiter, loadAllowlist, getAllowlistPath, type FinancialAllowlist } from './allowlist.js';
import { disconnectAllWorkspaces } from './tools/workspace.js';

export enum AgentState {
  Uninitialized = 'uninitialized',
  Initialized = 'initialized',
  Authenticated = 'authenticated',
}

export interface IdentityInfo {
  pubkey: string;
  address: string;
  identityName: string | null;
  iAddress: string | null;
  network: 'verus' | 'verustest';
}

const STATE_ORDER = [AgentState.Uninitialized, AgentState.Initialized, AgentState.Authenticated];

let agent: J41Agent | null = null;
let state: AgentState = AgentState.Uninitialized;
let identityInfo: IdentityInfo | null = null;

// WIF is stored here — never exposed via any public getter
let storedWif: string | null = null;
let storedNetwork: 'verus' | 'verustest' = 'verustest';

// Pending keypair from generate_keypair — used by register_identity
let pendingKeypair: { wif: string; pubkey: string; address: string; network: 'verus' | 'verustest' } | null = null;

// ── Financial allowlist state (singleton) ──
let cachedAllowlist: FinancialAllowlist | null = null;
const rateLimiter = new RateLimiter();

// ── Active job context ──
// Set when this agent accepts a job (as seller); cleared on
// complete/cancel/dispute/end_session. Payment tools fall back to this
// when the caller doesn't pass an explicit jobId — useful for multi-step
// LLM tool use where the model already accepted a job and now wants to
// record/send/refund without re-stating the jobId.
export interface ActiveJob {
  jobId: string;
  jobHash: string | null;
  amount: number;
  currency: string;
  buyerVerusId: string | null;
  acceptedAt: number; // unix ms
}
let activeJob: ActiveJob | null = null;

export function setActiveJob(job: ActiveJob): void {
  activeJob = job;
}

export function getActiveJob(): ActiveJob | null {
  return activeJob;
}

export function clearActiveJob(jobId: string): void {
  // Only clear if it matches — otherwise an out-of-order
  // complete_job for an old job could nuke the wrong context.
  if (activeJob && activeJob.jobId === jobId) {
    activeJob = null;
  }
}

export function setPendingKeypair(kp: { wif: string; pubkey: string; address: string; network: 'verus' | 'verustest' }): void {
  pendingKeypair = kp;
}

export function getPendingKeypair() {
  if (!pendingKeypair) return null;
  return { pubkey: pendingKeypair.pubkey, address: pendingKeypair.address, network: pendingKeypair.network };
}

export function clearPendingKeypair(): void {
  pendingKeypair = null;
}

/**
 * Reset agent state completely — allows switching to a different agent.
 */
export function resetAgent(): void {
  if (agent) {
    try { (agent as any).chatClient?.disconnect(); } catch {}
  }
  disconnectAllWorkspaces();
  agent = null;
  state = AgentState.Uninitialized;
  identityInfo = null;
  storedWif = null;
  pendingKeypair = null;
  cachedAllowlist = null;
  activeJob = null;
}

export function initAgent(config: {
  apiUrl: string;
  wif: string;
  identityName?: string;
  iAddress?: string;
  network?: 'verus' | 'verustest';
}): IdentityInfo {
  // Allow re-initialization — clean up old agent first
  if (agent) {
    resetAgent();
  }

  const network = config.network ?? 'verustest';
  const kp = keypairFromWIF(config.wif, network);

  const agentConfig: J41AgentConfig = {
    apiUrl: config.apiUrl,
    wif: config.wif,
    identityName: config.identityName,
    iAddress: config.iAddress,
    network,
  };

  agent = new J41Agent(agentConfig);
  state = AgentState.Initialized;
  storedWif = config.wif;
  storedNetwork = network;

  identityInfo = {
    pubkey: kp.pubkey,
    address: kp.address,
    identityName: config.identityName ?? null,
    iAddress: config.iAddress ?? null,
    network,
  };

  return identityInfo;
}

export function getAgent(): J41Agent {
  if (!agent) {
    throw new J41Error(
      'Agent not initialized — call j41_init_agent first',
      'NOT_INITIALIZED',
      400,
    );
  }
  return agent;
}

export function getState(): AgentState {
  return state;
}

/**
 * Transition state forward only. Prevents invalid backwards transitions
 * (e.g. Authenticated → Uninitialized).
 */
export function setState(newState: AgentState): void {
  const currentIdx = STATE_ORDER.indexOf(state);
  const newIdx = STATE_ORDER.indexOf(newState);
  if (newIdx < currentIdx) {
    throw new J41Error(
      `Invalid state transition: ${state} → ${newState}`,
      'INVALID_STATE_TRANSITION',
      400,
    );
  }
  state = newState;
}

export function getIdentityInfo(): IdentityInfo | null {
  return identityInfo;
}

/**
 * Sign a message using the stored WIF. This is the ONLY way to access
 * the WIF for signing — the raw key is never returned.
 */
export function signWithAgent(message: string): string {
  if (!storedWif) {
    throw new J41Error('No WIF available — call j41_init_agent first', 'NO_WIF', 400);
  }
  return signMessage(storedWif, message, storedNetwork);
}

export function getNetwork(): 'verus' | 'verustest' {
  return storedNetwork;
}

/**
 * Get the stored WIF for operations that need raw key access (e.g. buildIdentityUpdateTx).
 * INTERNAL USE ONLY — prefer signWithAgent() for simple signing.
 */
export function getWif(): string {
  if (!storedWif) {
    throw new J41Error('No WIF available — call j41_init_agent first', 'NO_WIF', 400);
  }
  return storedWif;
}

// ── Allowlist accessors ──

/**
 * Get the financial allowlist. Always reads from disk to pick up
 * external edits (operator adding addresses, dispatcher lifecycle).
 */
export function getAllowlist(): FinancialAllowlist {
  cachedAllowlist = loadAllowlist();
  return cachedAllowlist;
}

/**
 * Force reload the allowlist from disk (after add/remove operations).
 */
export function reloadAllowlist(): void {
  cachedAllowlist = loadAllowlist();
}

/**
 * Get the shared rate limiter instance.
 */
export function getRateLimiter(): RateLimiter {
  return rateLimiter;
}

export function requireState(minState: AgentState): void {
  const current = STATE_ORDER.indexOf(state);
  const required = STATE_ORDER.indexOf(minState);

  if (current < required) {
    if (minState === AgentState.Initialized) {
      throw new J41Error(
        'Agent not initialized — call j41_init_agent first',
        'NOT_INITIALIZED',
        400,
      );
    }
    if (minState === AgentState.Authenticated) {
      throw new J41Error(
        'Agent not authenticated — call j41_authenticate first',
        'NOT_AUTHENTICATED',
        401,
      );
    }
  }
}
