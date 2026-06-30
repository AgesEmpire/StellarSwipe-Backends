import { BadRequestException } from '@nestjs/common';
import { SsrfValidationPipe } from './ssrf-validation.pipe';
import * as dns from 'dns';

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

const mockLookup = dns.promises.lookup as jest.Mock;

describe('SsrfValidationPipe', () => {
  let pipe: SsrfValidationPipe;

  beforeEach(() => {
    pipe = new SsrfValidationPipe();
    jest.clearAllMocks();
  });

  it('passes a public URL that resolves to a public IP', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(pipe.transform('https://example.com/hook')).resolves.toBe('https://example.com/hook');
  });

  it('rejects a URL with a literal private-range IPv4 address', async () => {
    await expect(pipe.transform('https://192.168.1.1/hook')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a URL with a literal loopback address', async () => {
    await expect(pipe.transform('http://127.0.0.1/hook')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a URL whose hostname resolves to a private IP (SSRF via DNS)', async () => {
    // Simulates a DNS rebinding or internal-redirect: the hostname looks public
    // but actually resolves to a private-range address.
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(pipe.transform('https://internal.example.com/hook')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a URL with a class-B private IP (172.16–31.x.x range)', async () => {
    await expect(pipe.transform('https://172.16.0.1/hook')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a URL with a link-local address (169.254.x.x)', async () => {
    await expect(pipe.transform('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a URL with IPv6 loopback', async () => {
    await expect(pipe.transform('http://[::1]/hook')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes through undefined (optional field)', async () => {
    await expect(pipe.transform(undefined as unknown as string)).resolves.toBeUndefined();
  });

  it('throws when DNS resolution fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(pipe.transform('https://nonexistent.invalid/hook')).rejects.toBeInstanceOf(BadRequestException);
  });
});
