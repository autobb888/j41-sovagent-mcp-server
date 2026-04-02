// test/allowlist-enforcement.test.ts
// TDD tests for financial allowlist enforcement in payment tools — Plan C, Task 3
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Allowlist Enforcement', () => {
  let tmpDir: string;
  let allowlistPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'j41-enforce-test-'));
    allowlistPath = path.join(tmpDir, 'financial-allowlist.json');
    process.env.J41_ALLOWLIST_PATH = allowlistPath;
  });

  afterEach(() => {
    delete process.env.J41_ALLOWLIST_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('checkFinancialOp', () => {
    it('should allow a valid send to an allowlisted address', async () => {
      const data = {
        permanent: [{ address: 'RPlatform', label: 'platform' }],
        operator: [],
        active_jobs: [],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist, checkFinancialOp, RateLimiter } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      const limiter = new RateLimiter();
      const result = checkFinancialOp('RPlatform', 10, 'job1', 100, list, limiter);
      assert.ok(result.allowed);
    });

    it('should block a send to a non-allowlisted address', async () => {
      const data = { permanent: [], operator: [], active_jobs: [] };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist, checkFinancialOp, RateLimiter } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      const limiter = new RateLimiter();
      const result = checkFinancialOp('RAttacker', 10, 'job1', 100, list, limiter);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /not in the financial allowlist/i);
    });

    it('should block when rate limited even if address is allowed', async () => {
      const data = {
        permanent: [{ address: 'RPlatform', label: 'p' }],
        operator: [],
        active_jobs: [],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist, checkFinancialOp, RateLimiter } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      const limiter = new RateLimiter({ maxSendsPerJob: 1 });
      limiter.recordSend('job1', 10);
      const result = checkFinancialOp('RPlatform', 10, 'job1', 100, list, limiter);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /RATE LIMITED/i);
    });

    it('should block when globally suspended', async () => {
      const data = {
        permanent: [{ address: 'RPlatform', label: 'p' }],
        operator: [],
        active_jobs: [],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist, checkFinancialOp, RateLimiter } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      const limiter = new RateLimiter();
      limiter.suspend('API outage >30min');
      const result = checkFinancialOp('RPlatform', 10, 'job1', 100, list, limiter);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /suspended/i);
    });
  });

  describe('logBlockedOperation', () => {
    it('should log without throwing', async () => {
      const { logBlockedOperation } = await import('../build/allowlist.js');
      assert.doesNotThrow(() => {
        logBlockedOperation('j41_send_currency', 'RBad', 99, 'job1', 'not allowed');
      });
    });
  });
});
