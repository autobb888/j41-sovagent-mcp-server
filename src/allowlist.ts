// src/allowlist.ts
// Financial allowlist module — Plan C security hardening
// Prevents prompt-injected agents from draining wallets by enforcing
// destination allowlists and rate limits on every financial operation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Types ──

export interface AllowlistEntry {
  address: string;
  label: string;
  added?: string;
}

export interface ActiveJobEntry {
  address: string;
  jobId: string;
  added: string;
}

export interface FinancialAllowlist {
  permanent: AllowlistEntry[];
  operator: AllowlistEntry[];
  active_jobs: ActiveJobEntry[];
}

export interface RateLimitConfig {
  maxSendsPerJob: number;
  maxSendsPerHour: number;
  cooldownMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

interface SendRecord {
  timestamp: number;
  amount: number;
}

// ── Constants ──

const DEFAULT_ALLOWLIST_PATH = path.join(os.homedir(), '.j41', 'financial-allowlist.json');

const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  maxSendsPerJob: 3,
  maxSendsPerHour: 10,
  cooldownMs: 30_000, // 30 seconds
};

const EMPTY_ALLOWLIST: FinancialAllowlist = {
  permanent: [],
  operator: [],
  active_jobs: [],
};

// ── Allowlist Loading ──

/**
 * Get the allowlist file path. Uses J41_ALLOWLIST_PATH env var for testing,
 * otherwise defaults to ~/.j41/financial-allowlist.json.
 */
export function getAllowlistPath(): string {
  return process.env.J41_ALLOWLIST_PATH || DEFAULT_ALLOWLIST_PATH;
}

/**
 * Load the financial allowlist from disk.
 * If the file does not exist, creates a deny-all default and returns it.
 * This is fail-closed: any parse error returns an empty (deny-all) list.
 */
export function loadAllowlist(filePath?: string): FinancialAllowlist {
  const p = filePath ?? getAllowlistPath();

  if (!fs.existsSync(p)) {
    // Create deny-all default — Plan A's secure-setup normally creates this,
    // but if Plan A hasn't run, we bootstrap it here.
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(EMPTY_ALLOWLIST, null, 2), 'utf-8');
    return { permanent: [], operator: [], active_jobs: [] };
  }

  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw) as Partial<FinancialAllowlist>;
    return {
      permanent: Array.isArray(data.permanent) ? data.permanent : [],
      operator: Array.isArray(data.operator) ? data.operator : [],
      active_jobs: Array.isArray(data.active_jobs) ? data.active_jobs : [],
    };
  } catch {
    // Fail-closed: corrupt file = deny all
    console.error(`[allowlist] Failed to parse ${p} — deny-all mode active`);
    return { permanent: [], operator: [], active_jobs: [] };
  }
}

// ── Address Checking ──

/**
 * Check if a destination address is in the allowlist.
 * Checks permanent, operator, and active_jobs lists.
 */
export function isAddressAllowed(list: FinancialAllowlist, address: string): boolean {
  const allAddresses = [
    ...list.permanent.map((e) => e.address),
    ...list.operator.map((e) => e.address),
    ...list.active_jobs.map((e) => e.address),
  ];
  return allAddresses.includes(address);
}

// ── Rate Limiter ──

/**
 * In-memory rate limiter for financial operations.
 * State resets on process restart (by design — no persistence needed).
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly jobSends: Map<string, SendRecord[]> = new Map();
  private readonly globalSends: SendRecord[] = [];
  private suspended = false;
  private suspendedReason = '';

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_RATE_LIMITS, ...config };
  }

  /**
   * Suspend all financial operations globally.
   * Used when sweep validation fails or API is unreachable.
   */
  suspend(reason: string): void {
    this.suspended = true;
    this.suspendedReason = reason;
  }

  /**
   * Resume financial operations after suspension.
   */
  resume(): void {
    this.suspended = false;
    this.suspendedReason = '';
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Check if a send is allowed. Does NOT record it — call recordSend() after success.
   * @param jobId - The job this send is associated with
   * @param amount - Amount to send
   * @param jobPrice - The job's agreed price (for max value calculation)
   */
  checkSend(jobId: string, amount: number, jobPrice: number): RateLimitResult {
    // Global suspension check
    if (this.suspended) {
      return { allowed: false, reason: `Financial operations suspended: ${this.suspendedReason}` };
    }

    const now = Date.now();

    // 1. Per-job send count
    const jobHistory = this.jobSends.get(jobId) ?? [];
    if (jobHistory.length >= this.config.maxSendsPerJob) {
      return { allowed: false, reason: `Max sends per job exceeded (${this.config.maxSendsPerJob})` };
    }

    // 2. Per-job total value (job price + 10%)
    const maxValue = jobPrice * 1.1;
    const totalSent = jobHistory.reduce((sum, r) => sum + r.amount, 0);
    if (totalSent + amount > maxValue) {
      return {
        allowed: false,
        reason: `Total value would exceed job price + 10% (sent: ${totalSent}, attempted: ${amount}, max: ${maxValue.toFixed(4)})`,
      };
    }

    // 3. Global hourly limit
    const oneHourAgo = now - 3_600_000;
    const recentGlobal = this.globalSends.filter((r) => r.timestamp > oneHourAgo);
    if (recentGlobal.length >= this.config.maxSendsPerHour) {
      return { allowed: false, reason: `Hourly global send limit exceeded (${this.config.maxSendsPerHour})` };
    }

    // 4. Cooldown between sends
    if (jobHistory.length > 0) {
      const lastSend = jobHistory[jobHistory.length - 1];
      const elapsed = now - lastSend.timestamp;
      if (elapsed < this.config.cooldownMs) {
        const remaining = Math.ceil((this.config.cooldownMs - elapsed) / 1000);
        return { allowed: false, reason: `Cooldown active — ${remaining}s remaining` };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a successful send. Call this AFTER the send succeeds.
   */
  recordSend(jobId: string, amount: number): void {
    const record: SendRecord = { timestamp: Date.now(), amount };
    if (!this.jobSends.has(jobId)) {
      this.jobSends.set(jobId, []);
    }
    this.jobSends.get(jobId)!.push(record);
    this.globalSends.push(record);
  }

  /**
   * Clear rate limit state for a completed/cancelled job.
   */
  clearJob(jobId: string): void {
    this.jobSends.delete(jobId);
  }
}

// ── Allowlist Gate (combined check) ──

export interface AllowlistGateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Combined allowlist + rate limit gate for financial operations.
 * This is the single function that every financial tool calls.
 *
 * @param address - Destination address
 * @param amount - Amount to send
 * @param jobId - Associated job ID
 * @param jobPrice - Job's agreed price
 * @param allowlist - Loaded allowlist (caller caches this)
 * @param rateLimiter - Shared rate limiter instance
 */
export function checkFinancialOp(
  address: string,
  amount: number,
  jobId: string,
  jobPrice: number,
  allowlist: FinancialAllowlist,
  rateLimiter: RateLimiter,
): AllowlistGateResult {
  // 1. Allowlist check
  if (!isAddressAllowed(allowlist, address)) {
    return {
      allowed: false,
      reason: `BLOCKED: Address ${address} is not in the financial allowlist. Only pre-approved addresses can receive funds.`,
    };
  }

  // 2. Rate limit check
  const rateResult = rateLimiter.checkSend(jobId, amount, jobPrice);
  if (!rateResult.allowed) {
    return { allowed: false, reason: `RATE LIMITED: ${rateResult.reason}` };
  }

  return { allowed: true };
}

// ── Active Jobs Management ──

/**
 * Add a buyer refund address to the active_jobs section.
 * In standalone MCP mode this writes to the file directly.
 * In dispatcher mode, the dispatcher manages the file (this is a no-op).
 */
export function addActiveJobAddress(
  filePath: string | undefined,
  jobId: string,
  buyerAddress: string,
): void {
  const p = filePath ?? getAllowlistPath();
  const list = loadAllowlist(p);

  // Avoid duplicates
  if (list.active_jobs.some((e) => e.jobId === jobId)) {
    return;
  }

  list.active_jobs.push({
    address: buyerAddress,
    jobId,
    added: new Date().toISOString(),
  });

  writeAllowlist(p, list);
}

/**
 * Remove a buyer address from active_jobs when a job finishes.
 */
export function removeActiveJobAddress(
  filePath: string | undefined,
  jobId: string,
): void {
  const p = filePath ?? getAllowlistPath();
  const list = loadAllowlist(p);
  list.active_jobs = list.active_jobs.filter((e) => e.jobId !== jobId);
  writeAllowlist(p, list);
}

/**
 * Write the allowlist back to disk.
 * NOTE: In production, only root or the allowlist daemon should call this.
 * The MCP process may not have write permission (by design — see spec Section 5).
 * This function catches write errors gracefully.
 */
function writeAllowlist(filePath: string, list: FinancialAllowlist): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[allowlist] Cannot write ${filePath}: ${(err as Error).message}`);
    console.error('[allowlist] Active job address change will not persist — allowlist daemon required');
  }
}

// ── Logging ──

/**
 * Log a blocked financial operation with full details.
 */
export function logBlockedOperation(
  tool: string,
  address: string,
  amount: number,
  jobId: string,
  reason: string,
): void {
  const entry = {
    event: 'FINANCIAL_OP_BLOCKED',
    tool,
    address,
    amount,
    jobId,
    reason,
    timestamp: new Date().toISOString(),
  };
  console.error(`[allowlist] ${JSON.stringify(entry)}`);
}

// ── Sweep Timer ──

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;  // 10 minutes
const SUSPEND_AFTER_MS = 30 * 60 * 1000;   // 30 minutes of API outage → global suspend

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let apiOutageSince: number | null = null;

/**
 * Sweep all active_jobs entries against the platform API.
 * Removes addresses for jobs that are no longer active.
 * FAIL-CLOSED: if API unreachable, freeze active_jobs sends.
 * After 30 minutes of outage, suspend ALL financial operations.
 *
 * @param apiRequestFn - The apiRequest function (injected to avoid circular imports)
 * @param rateLimiter - The shared rate limiter
 */
export async function sweepActiveJobs(
  apiRequestFn: <T>(method: string, path: string) => Promise<T>,
  rateLimiter: RateLimiter,
): Promise<void> {
  const filePath = getAllowlistPath();
  const list = loadAllowlist(filePath);

  if (list.active_jobs.length === 0) {
    // Nothing to sweep — clear any outage state
    if (apiOutageSince) {
      apiOutageSince = null;
      rateLimiter.resume();
    }
    return;
  }

  let apiReachable = false;

  for (const entry of [...list.active_jobs]) {
    try {
      const job = await apiRequestFn<{ data: { status: string } }>('GET', `/v1/jobs/${entry.jobId}`);
      apiReachable = true;

      const activeStatuses = ['requested', 'accepted', 'in_progress', 'delivered', 'rework'];
      if (!activeStatuses.includes(job.data.status)) {
        // Job is no longer active — remove address
        removeActiveJobAddress(filePath, entry.jobId);
        rateLimiter.clearJob(entry.jobId);
        console.error(`[allowlist-sweep] Removed stale job ${entry.jobId} (status: ${job.data.status})`);
      }
    } catch (err) {
      console.error(`[allowlist-sweep] API check failed for job ${entry.jobId}: ${(err as Error).message}`);
      // Don't remove — fail-closed means we keep the entry but freeze sends
    }
  }

  if (apiReachable) {
    // API is back — clear outage
    if (apiOutageSince) {
      console.error('[allowlist-sweep] API connectivity restored — resuming financial operations');
      apiOutageSince = null;
      rateLimiter.resume();
    }
  } else {
    // API unreachable for all entries
    const now = Date.now();
    if (!apiOutageSince) {
      apiOutageSince = now;
      console.error('[allowlist-sweep] API unreachable — active_jobs sends frozen');
    }

    // After 30 minutes, suspend ALL financial operations
    if (now - apiOutageSince >= SUSPEND_AFTER_MS) {
      if (!rateLimiter.isSuspended()) {
        rateLimiter.suspend('Platform API unreachable for >30 minutes');
        console.error('[allowlist-sweep] API outage >30min — ALL financial operations suspended');
      }
    }
  }
}

/**
 * Start the sweep timer. Call once at MCP server boot.
 */
export function startSweepTimer(
  apiRequestFn: <T>(method: string, path: string) => Promise<T>,
  rateLimiter: RateLimiter,
): void {
  if (sweepTimer) return; // Already running

  sweepTimer = setInterval(() => {
    sweepActiveJobs(apiRequestFn, rateLimiter).catch((err) => {
      console.error(`[allowlist-sweep] Unhandled error: ${(err as Error).message}`);
    });
  }, SWEEP_INTERVAL_MS);

  // Don't prevent process exit
  if (sweepTimer.unref) sweepTimer.unref();

  console.error(`[allowlist] Sweep timer started (every ${SWEEP_INTERVAL_MS / 60_000} min)`);
}

/**
 * Stop the sweep timer (for graceful shutdown).
 */
export function stopSweepTimer(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
