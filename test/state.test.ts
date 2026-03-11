import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// We test the state module's logic by importing from the built output
// Since state is module-level singleton, each test file gets its own instance

describe('AgentState', () => {
  it('should define three states', async () => {
    const { AgentState } = await import('../build/state.js');
    assert.equal(AgentState.Uninitialized, 'uninitialized');
    assert.equal(AgentState.Initialized, 'initialized');
    assert.equal(AgentState.Authenticated, 'authenticated');
  });

  it('should start in uninitialized state', async () => {
    const { getState, AgentState } = await import('../build/state.js');
    assert.equal(getState(), AgentState.Uninitialized);
  });

  it('getAgent should throw when not initialized', async () => {
    const { getAgent } = await import('../build/state.js');
    assert.throws(() => getAgent(), { message: /not initialized/i });
  });

  it('requireState should throw for insufficient state', async () => {
    const { requireState, AgentState } = await import('../build/state.js');
    assert.throws(
      () => requireState(AgentState.Initialized),
      { message: /not initialized/i },
    );
    assert.throws(
      () => requireState(AgentState.Authenticated),
      { message: /not authenticated/i },
    );
  });

  it('requireState should not throw for uninitialized', async () => {
    const { requireState, AgentState } = await import('../build/state.js');
    assert.doesNotThrow(() => requireState(AgentState.Uninitialized));
  });

  it('getIdentityInfo should return null before init', async () => {
    const { getIdentityInfo } = await import('../build/state.js');
    assert.equal(getIdentityInfo(), null);
  });
});
