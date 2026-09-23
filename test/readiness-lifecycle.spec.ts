/**
 * Issue #1038 — Graceful readiness transitions during migrations and deploys.
 *
 * Covers: startup failure, recovery, shutdown drain, dependency failure vs
 * process death distinction.
 */
import { ReadinessService } from '../../src/health/readiness.service';

describe('ReadinessService (Issue #1038)', () => {
  let svc: ReadinessService;

  beforeEach(() => {
    svc = new ReadinessService();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it('starts as NOT ready (startup_pending)', () => {
    expect(svc.isReady()).toBe(false);
    expect(svc.getNotReadyReason()).toBe('startup_pending');
  });

  // ── markReady ──────────────────────────────────────────────────────────────

  it('becomes ready after markReady()', () => {
    svc.markReady();
    expect(svc.isReady()).toBe(true);
    expect(svc.getNotReadyReason()).toBeNull();
  });

  // ── markNotReady ───────────────────────────────────────────────────────────

  it('becomes not-ready with a reason after markNotReady()', () => {
    svc.markReady();
    svc.markNotReady('dependency_failure:redis');
    expect(svc.isReady()).toBe(false);
    expect(svc.getNotReadyReason()).toBe('dependency_failure:redis');
  });

  // ── Startup failure ────────────────────────────────────────────────────────

  it('remains not-ready when startup check fails', () => {
    svc.markNotReady('startup_check_failed:attempt_1');
    expect(svc.isReady()).toBe(false);
    expect(svc.getNotReadyReason()).toMatch(/startup_check_failed/);
  });

  // ── Recovery ──────────────────────────────────────────────────────────────

  it('recovers to ready after a transient failure is resolved', () => {
    svc.markNotReady('startup_check_failed:attempt_1');
    expect(svc.isReady()).toBe(false);
    svc.markReady(); // dependency came back up
    expect(svc.isReady()).toBe(true);
  });

  // ── Shutdown drain ────────────────────────────────────────────────────────

  it('becomes not-ready on application shutdown signal', () => {
    svc.markReady();
    svc.onApplicationShutdown('SIGTERM');
    expect(svc.isReady()).toBe(false);
    expect(svc.getNotReadyReason()).toMatch(/shutdown_signal:SIGTERM/);
  });

  it('becomes not-ready before shutdown even without a signal', () => {
    svc.markReady();
    svc.onApplicationShutdown();
    expect(svc.isReady()).toBe(false);
  });

  // ── Dependency failure vs process death ───────────────────────────────────

  it('distinguishes dependency failure from process death via reason', () => {
    svc.markNotReady('dependency_failure:database');
    // Dependency failure: not ready, but process is alive (liveness still passes)
    expect(svc.isReady()).toBe(false);
    expect(svc.getNotReadyReason()).toContain('dependency_failure');
    // Liveness is separate — process is still running (no process.exit called)
  });

  it('getNotReadyReason returns null when ready (no reason to report)', () => {
    svc.markReady();
    expect(svc.getNotReadyReason()).toBeNull();
  });

  // ── onApplicationBootstrap ────────────────────────────────────────────────

  it('onApplicationBootstrap does not mark ready (waits for explicit markReady)', () => {
    svc.onApplicationBootstrap();
    // Still not ready — markReady() must be called explicitly after checks pass
    expect(svc.isReady()).toBe(false);
  });
});
