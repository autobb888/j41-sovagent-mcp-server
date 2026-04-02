// test/allowlist.test.ts
// TDD tests for financial allowlist module — Plan C, Task 1
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Tests import from build output (same pattern as state.test.ts).
// We set J41_ALLOWLIST_PATH env var to a temp file for testing.

describe('Allowlist', () => {
  let tmpDir: string;
  let allowlistPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'j41-allowlist-test-'));
    allowlistPath = path.join(tmpDir, 'financial-allowlist.json');
    process.env.J41_ALLOWLIST_PATH = allowlistPath;
  });

  afterEach(() => {
    delete process.env.J41_ALLOWLIST_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadAllowlist', () => {
    it('should create deny-all file when none exists', async () => {
      const { loadAllowlist } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      assert.deepEqual(list.permanent, []);
      assert.deepEqual(list.operator, []);
      assert.deepEqual(list.active_jobs, []);
      assert.ok(fs.existsSync(allowlistPath));
    });

    it('should parse a valid allowlist file', async () => {
      const data = {
        permanent: [{ address: 'RxxxxPlatform', label: 'platform_fee' }],
        operator: [{ address: 'RxxxxCold', label: 'cold wallet', added: '2026-04-01' }],
        active_jobs: [],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      assert.equal(list.permanent.length, 1);
      assert.equal(list.permanent[0].address, 'RxxxxPlatform');
    });

    it('should return deny-all on corrupt JSON (fail-closed)', async () => {
      fs.writeFileSync(allowlistPath, '{{not valid json');
      const { loadAllowlist } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      assert.deepEqual(list.permanent, []);
      assert.deepEqual(list.operator, []);
      assert.deepEqual(list.active_jobs, []);
    });
  });

  describe('isAddressAllowed', () => {
    it('should allow permanent addresses', async () => {
      const data = {
        permanent: [{ address: 'RPlatformAddr', label: 'platform' }],
        operator: [],
        active_jobs: [],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist, isAddressAllowed } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      assert.ok(isAddressAllowed(list, 'RPlatformAddr'));
    });

    it('should allow operator addresses', async () => {
      const data = {
        permanent: [],
        operator: [{ address: 'RColdWallet', label: 'cold', added: '2026-04-01' }],
        active_jobs: [],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist, isAddressAllowed } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      assert.ok(isAddressAllowed(list, 'RColdWallet'));
    });

    it('should allow active_jobs addresses', async () => {
      const data = {
        permanent: [],
        operator: [],
        active_jobs: [{ address: 'iBuyerAddr', jobId: 'job123', added: '2026-04-02T10:00:00Z' }],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist, isAddressAllowed } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      assert.ok(isAddressAllowed(list, 'iBuyerAddr'));
    });

    it('should deny unlisted addresses', async () => {
      const data = { permanent: [], operator: [], active_jobs: [] };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const { loadAllowlist, isAddressAllowed } = await import('../build/allowlist.js');
      const list = loadAllowlist(allowlistPath);
      assert.equal(isAddressAllowed(list, 'RAttackerAddr'), false);
    });
  });

  describe('RateLimiter', () => {
    it('should allow sends within per-job limit', async () => {
      const { RateLimiter } = await import('../build/allowlist.js');
      const limiter = new RateLimiter();
      const result = limiter.checkSend('job1', 10, 100);
      assert.ok(result.allowed);
    });

    it('should block after max sends per job', async () => {
      const { RateLimiter } = await import('../build/allowlist.js');
      const limiter = new RateLimiter({ maxSendsPerJob: 3 });
      limiter.recordSend('job1', 10);
      limiter.recordSend('job1', 10);
      limiter.recordSend('job1', 10);
      const result = limiter.checkSend('job1', 10, 100);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /max sends per job/i);
    });

    it('should block when total value exceeds job price + 10%', async () => {
      const { RateLimiter } = await import('../build/allowlist.js');
      const limiter = new RateLimiter({ maxSendsPerJob: 10 });
      limiter.recordSend('job1', 100);
      // Job price is 100, max is 110 (100 + 10%). Already sent 100, trying 20 more.
      const result = limiter.checkSend('job1', 20, 100);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /total value/i);
    });

    it('should block when hourly global limit exceeded', async () => {
      const { RateLimiter } = await import('../build/allowlist.js');
      const limiter = new RateLimiter({ maxSendsPerHour: 2 });
      limiter.recordSend('job1', 10);
      limiter.recordSend('job2', 10);
      const result = limiter.checkSend('job3', 10, 100);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /hourly/i);
    });

    it('should block within cooldown window', async () => {
      const { RateLimiter } = await import('../build/allowlist.js');
      const limiter = new RateLimiter({ cooldownMs: 30_000 });
      limiter.recordSend('job1', 10);
      const result = limiter.checkSend('job1', 10, 100);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /cooldown/i);
    });

    it('should clear state for a job', async () => {
      const { RateLimiter } = await import('../build/allowlist.js');
      const limiter = new RateLimiter({ maxSendsPerJob: 1 });
      limiter.recordSend('job1', 10);
      limiter.clearJob('job1');
      const result = limiter.checkSend('job1', 10, 100);
      assert.ok(result.allowed);
    });

    it('should block when globally suspended', async () => {
      const { RateLimiter } = await import('../build/allowlist.js');
      const limiter = new RateLimiter();
      limiter.suspend('sweep failure');
      const result = limiter.checkSend('job1', 10, 100);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /suspended/i);
    });

    it('should resume after suspension', async () => {
      const { RateLimiter } = await import('../build/allowlist.js');
      const limiter = new RateLimiter();
      limiter.suspend('sweep failure');
      limiter.resume();
      const result = limiter.checkSend('job1', 10, 100);
      assert.ok(result.allowed);
    });
  });

  describe('checkFinancialOp', () => {
    it('should block unlisted address', async () => {
      const { loadAllowlist, checkFinancialOp, RateLimiter } = await import('../build/allowlist.js');
      const data = { permanent: [], operator: [], active_jobs: [] };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const list = loadAllowlist(allowlistPath);
      const limiter = new RateLimiter();
      const result = checkFinancialOp('RAttacker', 10, 'job1', 100, list, limiter);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /not in the financial allowlist/i);
    });

    it('should allow listed address within rate limits', async () => {
      const { loadAllowlist, checkFinancialOp, RateLimiter } = await import('../build/allowlist.js');
      const data = {
        permanent: [{ address: 'RPlatform', label: 'platform' }],
        operator: [],
        active_jobs: [],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const list = loadAllowlist(allowlistPath);
      const limiter = new RateLimiter();
      const result = checkFinancialOp('RPlatform', 10, 'job1', 100, list, limiter);
      assert.ok(result.allowed);
    });

    it('should block listed address when rate limited', async () => {
      const { loadAllowlist, checkFinancialOp, RateLimiter } = await import('../build/allowlist.js');
      const data = {
        permanent: [{ address: 'RPlatform', label: 'platform' }],
        operator: [],
        active_jobs: [],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));
      const list = loadAllowlist(allowlistPath);
      const limiter = new RateLimiter({ maxSendsPerJob: 1 });
      limiter.recordSend('job1', 10);
      const result = checkFinancialOp('RPlatform', 10, 'job1', 100, list, limiter);
      assert.equal(result.allowed, false);
      assert.match(result.reason!, /rate limited/i);
    });
  });

  describe('addActiveJobAddress / removeActiveJobAddress', () => {
    it('should add a job address to the allowlist file', async () => {
      const { loadAllowlist, addActiveJobAddress } = await import('../build/allowlist.js');
      // Create initial empty allowlist
      const data = { permanent: [], operator: [], active_jobs: [] };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));

      addActiveJobAddress(allowlistPath, 'job42', 'iBuyerRefund');

      const reloaded = loadAllowlist(allowlistPath);
      assert.equal(reloaded.active_jobs.length, 1);
      assert.equal(reloaded.active_jobs[0].jobId, 'job42');
      assert.equal(reloaded.active_jobs[0].address, 'iBuyerRefund');
    });

    it('should not add duplicate job entries', async () => {
      const { loadAllowlist, addActiveJobAddress } = await import('../build/allowlist.js');
      const data = { permanent: [], operator: [], active_jobs: [] };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));

      addActiveJobAddress(allowlistPath, 'job42', 'iBuyerRefund');
      addActiveJobAddress(allowlistPath, 'job42', 'iBuyerRefund');

      const reloaded = loadAllowlist(allowlistPath);
      assert.equal(reloaded.active_jobs.length, 1);
    });

    it('should remove a job address from the allowlist file', async () => {
      const { loadAllowlist, removeActiveJobAddress } = await import('../build/allowlist.js');
      const data = {
        permanent: [],
        operator: [],
        active_jobs: [{ address: 'iBuyer1', jobId: 'job42', added: '2026-04-02T10:00:00Z' }],
      };
      fs.writeFileSync(allowlistPath, JSON.stringify(data));

      removeActiveJobAddress(allowlistPath, 'job42');

      const reloaded = loadAllowlist(allowlistPath);
      assert.equal(reloaded.active_jobs.length, 0);
    });
  });
});
