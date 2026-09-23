import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import { SsrfValidationPipe } from './ssrf-validation.pipe';

jest.mock('dns', () => ({
  promises: { lookup: jest.fn() },
}));

const mockLookup = dns.lookup as jest.MockedFunction<typeof dns.lookup>;

describe('SsrfValidationPipe (issue #1029)', () => {
  let pipe: SsrfValidationPipe;

  beforeEach(() => {
    pipe = new SsrfValidationPipe();
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Scheme checks ─────────────────────────────────────────────────────────

  it('accepts a valid HTTPS URL', async () => {
    await expect(pipe.transform('https://example.com/hook')).resolves.toBe(
      'https://example.com/hook',
    );
  });

  it('rejects HTTP URLs', async () => {
    await expect(pipe.transform('http://example.com/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects ftp URLs', async () => {
    await expect(pipe.transform('ftp://example.com/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── Port checks ───────────────────────────────────────────────────────────

  it('accepts explicit port 443', async () => {
    await expect(
      pipe.transform('https://example.com:443/hook'),
    ).resolves.toBeDefined();
  });

  it('rejects non-standard ports', async () => {
    await expect(
      pipe.transform('https://example.com:8443/hook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects port 80', async () => {
    await expect(pipe.transform('https://example.com:80/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── Blocked hostname checks ───────────────────────────────────────────────

  it('rejects Google metadata hostname by name', async () => {
    await expect(
      pipe.transform('https://metadata.google.internal/computeMetadata/v1/'),
    ).rejects.toThrow(BadRequestException);
  });

  // ── IPv4 blocked ranges ───────────────────────────────────────────────────

  it('rejects 127.0.0.1 (loopback)', async () => {
    await expect(pipe.transform('https://127.0.0.1/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects 10.0.0.1 (RFC-1918 class A)', async () => {
    await expect(pipe.transform('https://10.0.0.1/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects 172.16.0.1 (RFC-1918 class B)', async () => {
    await expect(pipe.transform('https://172.16.0.1/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects 192.168.1.1 (RFC-1918 class C)', async () => {
    await expect(pipe.transform('https://192.168.1.1/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects 169.254.169.254 (AWS/GCP metadata)', async () => {
    await expect(
      pipe.transform('https://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow(BadRequestException);
  });

  // ── IPv6 blocked ranges ───────────────────────────────────────────────────

  it('rejects ::1 (IPv6 loopback)', async () => {
    await expect(pipe.transform('https://[::1]/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects fe80::1 (IPv6 link-local)', async () => {
    await expect(pipe.transform('https://[fe80::1]/hook')).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── DNS-resolved addresses ────────────────────────────────────────────────

  it('rejects hostnames that resolve to private IPs (DNS-rebinding guard)', async () => {
    mockLookup.mockResolvedValue([
      { address: '192.168.1.5', family: 4 },
    ] as any);
    await expect(
      pipe.transform('https://evil-internal.example.com/hook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects hostnames resolving to metadata IP', async () => {
    mockLookup.mockResolvedValue([
      { address: '169.254.169.254', family: 4 },
    ] as any);
    await expect(
      pipe.transform('https://sneaky.example.com/hook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unresolvable hostnames', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      pipe.transform('https://nonexistent.invalid/hook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts hostnames resolving to public IPs', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any);
    await expect(
      pipe.transform('https://example.com/hook'),
    ).resolves.toBeDefined();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('passes through null/undefined without throwing', async () => {
    await expect(pipe.transform(null as any)).resolves.toBeNull();
    await expect(pipe.transform(undefined as any)).resolves.toBeUndefined();
  });

  it('throws on malformed URL', async () => {
    await expect(pipe.transform('not a url')).rejects.toThrow(
      BadRequestException,
    );
  });
});
