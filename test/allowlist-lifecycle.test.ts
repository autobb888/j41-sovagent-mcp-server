// test/allowlist-lifecycle.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Allowlist Lifecycle', () => {
  let tmpDir: string;
  let allowlistPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'j41-lifecycle-test-'));
    allowlistPath = path.join(tmpDir, 'financial-allowlist.json');
    process.env.J41_ALLOWLIST_PATH = allowlistPath;
    // Seed with empty allowlist
    fs.writeFileSync(allowlistPath, JSON.stringify({
      permanent: [], operator: [], active_jobs: [],
    }));
  });

  afterEach(() => {
    delete process.env.J41_ALLOWLIST_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('addActiveJobAddress', () => {
    it('should add a buyer address to active_jobs', async () => {
      const { addActiveJobAddress, loadAllowlist } = await import('../build/allowlist.js');
      addActiveJobAddress(allowlistPath, 'job123', 'iBuyerAddr');
      const list = loadAllowlist(allowlistPath);
      assert.equal(list.active_jobs.length, 1);
      assert.equal(list.active_jobs[0].address, 'iBuyerAddr');
      assert.equal(list.active_jobs[0].jobId, 'job123');
    });

    it('should not duplicate on repeated add', async () => {
      const { addActiveJobAddress, loadAllowlist } = await import('../build/allowlist.js');
      addActiveJobAddress(allowlistPath, 'job123', 'iBuyerAddr');
      addActiveJobAddress(allowlistPath, 'job123', 'iBuyerAddr');
      const list = loadAllowlist(allowlistPath);
      assert.equal(list.active_jobs.length, 1);
    });
  });

  describe('removeActiveJobAddress', () => {
    it('should remove a buyer address from active_jobs', async () => {
      const { addActiveJobAddress, removeActiveJobAddress, loadAllowlist } = await import('../build/allowlist.js');
      addActiveJobAddress(allowlistPath, 'job123', 'iBuyerAddr');
      removeActiveJobAddress(allowlistPath, 'job123');
      const list = loadAllowlist(allowlistPath);
      assert.equal(list.active_jobs.length, 0);
    });

    it('should be a no-op for unknown job', async () => {
      const { removeActiveJobAddress, loadAllowlist } = await import('../build/allowlist.js');
      removeActiveJobAddress(allowlistPath, 'nonexistent');
      const list = loadAllowlist(allowlistPath);
      assert.equal(list.active_jobs.length, 0);
    });
  });

  describe('sweepActiveJobs', () => {
    it('should remove jobs that are no longer active', async () => {
      const { addActiveJobAddress, sweepActiveJobs, loadAllowlist, RateLimiter } = await import('../build/allowlist.js');
      addActiveJobAddress(allowlistPath, 'job-done', 'iDoneAddr');
      addActiveJobAddress(allowlistPath, 'job-active', 'iActiveAddr');

      const mockApiRequest = async <T>(_method: string, path: string): Promise<T> => {
        if (path.includes('job-done')) {
          return { data: { status: 'completed' } } as T;
        }
        return { data: { status: 'in_progress' } } as T;
      };

      const limiter = new RateLimiter();
      await sweepActiveJobs(mockApiRequest, limiter);

      const list = loadAllowlist(allowlistPath);
      assert.equal(list.active_jobs.length, 1);
      assert.equal(list.active_jobs[0].jobId, 'job-active');
    });

    it('should NOT remove jobs when API is unreachable (fail-closed)', async () => {
      const { addActiveJobAddress, sweepActiveJobs, loadAllowlist, RateLimiter } = await import('../build/allowlist.js');
      addActiveJobAddress(allowlistPath, 'job1', 'iAddr1');

      const mockApiRequest = async <T>(): Promise<T> => {
        throw new Error('Connection refused');
      };

      const limiter = new RateLimiter();
      await sweepActiveJobs(mockApiRequest, limiter);

      const list = loadAllowlist(allowlistPath);
      assert.equal(list.active_jobs.length, 1, 'Job should NOT be removed on API failure');
    });
  });
});
