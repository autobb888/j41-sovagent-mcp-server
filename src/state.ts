import {
  J41Agent,
  type J41AgentConfig,
  keypairFromWIF,
  signMessage,
  J41Error,
} from '@j41/sovagent-sdk';

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

export function initAgent(config: {
  apiUrl: string;
  wif: string;
  identityName?: string;
  iAddress?: string;
  network?: 'verus' | 'verustest';
}): IdentityInfo {
  if (agent) {
    throw new J41Error('Agent already initialized — restart to reinitialize', 'ALREADY_INITIALIZED', 400);
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
