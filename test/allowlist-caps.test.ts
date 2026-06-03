// test/allowlist-caps.test.ts
// Tests for absolute send caps (HIGH-1) and VerusID-aware allowlist
// matching (HIGH-2) — Plan C hardening follow-up.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, isAddressAllowed, checkFinancialOp } from '../build/allowlist.js';

// A permissive count/cooldown config so amount-cap behaviour is isolated.
function uncountedLimiter(over = {}) {
  return new RateLimiter({
    maxSendsPerJob: 1000,
    maxSendsPerHour: 1000,
    cooldownMs: 0,
    ...over,
  });
}

describe('Absolute send caps (HIGH-1)', () => {
  it('blocks a single send above the per-send cap', () => {
    const limiter = uncountedLimiter({ maxAmountPerSend: 50, maxAmountPerDay: 100_000 });
    const result = limiter.checkSend('job1', 51, Infinity);
    assert.equal(result.allowed, false);
    assert.match(result.reason!, /per-send limit/i);
  });

  it('allows a send exactly at the per-send cap', () => {
    const limiter = uncountedLimiter({ maxAmountPerSend: 50, maxAmountPerDay: 100_000 });
    assert.ok(limiter.checkSend('job1', 50, Infinity).allowed);
  });

  it('bounds an Infinity job price by the absolute cap (the drain vector)', () => {
    // Pre-fix, Infinity jobPrice disabled the value ceiling entirely.
    const limiter = uncountedLimiter({ maxAmountPerSend: 50, maxAmountPerDay: 100_000 });
    const result = limiter.checkSend('_standalone', 1_000_000, Infinity);
    assert.equal(result.allowed, false);
    assert.match(result.reason!, /per-send limit/i);
  });

  it('blocks once the rolling 24h total would be exceeded', () => {
    const limiter = uncountedLimiter({ maxAmountPerSend: 1000, maxAmountPerDay: 250 });
    limiter.recordSend('job1', 200);
    const result = limiter.checkSend('job1', 100, Infinity); // 200 + 100 > 250
    assert.equal(result.allowed, false);
    assert.match(result.reason!, /daily send limit/i);
  });

  it('allows sends that stay within the daily total', () => {
    const limiter = uncountedLimiter({ maxAmountPerSend: 1000, maxAmountPerDay: 250 });
    limiter.recordSend('job1', 200);
    assert.ok(limiter.checkSend('job1', 50, Infinity).allowed); // 200 + 50 = 250
  });
});

describe('VerusID-aware allowlist matching (HIGH-2)', () => {
  const list = {
    permanent: [{ address: 'Alice@', label: 'friendly-name' }],
    operator: [{ address: 'RPlatformExact', label: 'r-addr' }],
    active_jobs: [{ address: 'iSellerResolved', jobId: 'j1', added: '' }],
  };

  it('matches a VerusID case-insensitively', () => {
    assert.ok(isAddressAllowed(list, 'alice@'));
    assert.ok(isAddressAllowed(list, 'ALICE@'));
  });

  it('keeps base58 R-/i-address matching case-sensitive', () => {
    assert.equal(isAddressAllowed(list, 'rplatformexact'), false);
    assert.ok(isAddressAllowed(list, 'RPlatformExact'));
  });

  it('allows when ANY candidate form matches (resolved address + friendly id)', () => {
    // Simulates resolving "bob@" -> "iSellerResolved" before the check.
    assert.ok(isAddressAllowed(list, ['iSellerResolved', 'bob@']));
  });

  it('blocks when no candidate form matches', () => {
    assert.equal(isAddressAllowed(list, ['iAttacker', 'mallory@']), false);
  });

  it('checkFinancialOp accepts an array of candidate forms', () => {
    const limiter = uncountedLimiter();
    const ok = checkFinancialOp(['iSellerResolved', 'bob@'], 1, 'j1', 100, list, limiter);
    assert.ok(ok.allowed);
    const bad = checkFinancialOp(['iAttacker'], 1, 'j1', 100, list, limiter);
    assert.equal(bad.allowed, false);
    assert.match(bad.reason!, /not in the financial allowlist/i);
  });
});
