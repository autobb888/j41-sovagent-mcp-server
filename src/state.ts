import {
  J41Agent,
  type J41AgentConfig,
  keypairFromWIF,
  signMessage,
  J41Error,
} from '@j41/sovagent-sdk';
import { RateLimiter, loadAllowlist, getAllowlistPath, type FinancialAllowlist } from './allowlist.js';

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

export function setPendingKeypair(kp: { wif: string; pubkey: string; address: string; network: 'verus' | 'verustest' }): void {
  pendingKeypair = kp;
}

export function getPendingKeypair(): typeof pendingKeypair {
  return pendingKeypair;
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
  agent = null;
  state = AgentState.Uninitialized;
  identityInfo = null;
  storedWif = null;
  pendingKeypair = null;
  cachedAllowlist = null;
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
