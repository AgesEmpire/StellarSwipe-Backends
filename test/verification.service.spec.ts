import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { VerificationService } from '../src/backup/verification.service';

const TMP = join(__dirname, '__backup_verify_tmp__');
const tmpFile = (name: string) => join(TMP, name);

const sha256 = (buf: Buffer) =>
  createHash('sha256').update(buf).digest('hex');

beforeAll(async () => {
  if (!existsSync(TMP)) await mkdir(TMP, { recursive: true });
});

afterAll(async () => {
  // clean up tmp dir
  const { rm } = await import('fs/promises');
  await rm(TMP, { recursive: true, force: true });
});

describe('VerificationService', () => {
  let svc: VerificationService;

  beforeEach(() => {
    svc = new VerificationService();
  });

  // ── exists check ──────────────────────────────────────────────────────────

  it('fails when file does not exist', async () => {
    const result = await svc.verify('/nonexistent/path/backup.gpg');
    expect(result.passed).toBe(false);
    expect(result.checks.exists).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  // ── min size check ────────────────────────────────────────────────────────

  it('fails when file is smaller than 1 KB', async () => {
    const p = tmpFile('tiny.gpg');
    await writeFile(p, Buffer.alloc(512)); // 512 bytes < 1024
    const result = await svc.verify(p);
    expect(result.checks.exists).toBe(true);
    expect(result.checks.minSize).toBe(false);
    expect(result.passed).toBe(false);
    await unlink(p);
  });

  it('passes min-size check for a file >= 1 KB', async () => {
    const p = tmpFile('ok.gpg');
    await writeFile(p, Buffer.alloc(2_048));
    const result = await svc.verify(p);
    expect(result.checks.minSize).toBe(true);
    await unlink(p);
  });

  // ── staleness check ───────────────────────────────────────────────────────

  it('fails staleness check when maxAgeMs is 0 (always stale)', async () => {
    const p = tmpFile('stale.gpg');
    await writeFile(p, Buffer.alloc(2_048));
    const result = await svc.verify(p, undefined, 0);
    expect(result.checks.notStale).toBe(false);
    expect(result.passed).toBe(false);
    await unlink(p);
  });

  it('passes staleness check for a freshly written file', async () => {
    const p = tmpFile('fresh.gpg');
    await writeFile(p, Buffer.alloc(2_048));
    const result = await svc.verify(p, undefined, 60_000);
    expect(result.checks.notStale).toBe(true);
    await unlink(p);
  });

  // ── checksum check ────────────────────────────────────────────────────────

  it('sets checksumMatch to null when no expected checksum is provided', async () => {
    const p = tmpFile('nochecksum.gpg');
    await writeFile(p, Buffer.alloc(2_048));
    const result = await svc.verify(p, undefined, 60_000);
    expect(result.checks.checksumMatch).toBeNull();
    await unlink(p);
  });

  it('passes checksum check when digest matches', async () => {
    const content = Buffer.from('backup-content-abc');
    const p = tmpFile('good-checksum.gpg');
    await writeFile(p, content);
    const expected = sha256(content);
    const result = await svc.verify(p, expected, 60_000);
    expect(result.checks.checksumMatch).toBe(true);
    await unlink(p);
  });

  it('fails checksum check when digest does not match', async () => {
    const p = tmpFile('bad-checksum.gpg');
    await writeFile(p, Buffer.from('real-content'));
    const result = await svc.verify(p, 'deadbeef'.repeat(8), 60_000);
    expect(result.checks.checksumMatch).toBe(false);
    expect(result.passed).toBe(false);
    await unlink(p);
  });

  it('is case-insensitive for the expected checksum', async () => {
    const content = Buffer.from('case-test');
    const p = tmpFile('case-checksum.gpg');
    await writeFile(p, content);
    const upper = sha256(content).toUpperCase();
    const result = await svc.verify(p, upper, 60_000);
    expect(result.checks.checksumMatch).toBe(true);
    await unlink(p);
  });

  // ── full pass ─────────────────────────────────────────────────────────────

  it('returns passed=true when all checks pass', async () => {
    const content = Buffer.alloc(4_096, 0xab);
    const p = tmpFile('all-pass.gpg');
    await writeFile(p, content);
    const digest = sha256(content);
    const result = await svc.verify(p, digest, 60_000);
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual({
      exists: true,
      minSize: true,
      notStale: true,
      checksumMatch: true,
    });
    await unlink(p);
  });

  // ── result metadata ───────────────────────────────────────────────────────

  it('reports sizeBytes and ageMs in the result', async () => {
    const p = tmpFile('meta.gpg');
    await writeFile(p, Buffer.alloc(2_048));
    const result = await svc.verify(p, undefined, 60_000);
    expect(result.sizeBytes).toBe(2_048);
    expect(result.ageMs).toBeGreaterThanOrEqual(0);
    await unlink(p);
  });

  // ── sha256 helper ─────────────────────────────────────────────────────────

  describe('sha256()', () => {
    it('returns the correct SHA-256 hex digest', async () => {
      const content = Buffer.from('hello-backup');
      const p = tmpFile('sha256-test.bin');
      await writeFile(p, content);
      const result = await svc.sha256(p);
      expect(result).toBe(sha256(content));
      await unlink(p);
    });
  });
});
