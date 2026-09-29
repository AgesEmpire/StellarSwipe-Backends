import { maskSecret } from './secret-masking.util';
import { hashSecret } from './secret-entropy.util';

describe('webhook secret masking', () => {
  const secret =
    'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a';

  it('keeps only the last four characters of a secret', () => {
    expect(maskSecret(secret)).toBe('****8f9a');
  });

  it('fully masks short secrets', () => {
    expect(maskSecret('short')).toBe('****');
  });

  it('fingerprints secrets without exposing any prefix', () => {
    const fingerprint = hashSecret(secret);
    const hexOfPrefix = Buffer.from(secret.slice(0, 6)).toString('hex');

    expect(fingerprint).toMatch(/^\*{4}[0-9a-f]{12}…$/);
    expect(fingerprint).not.toContain(secret.slice(0, 6));
    expect(fingerprint).not.toContain(hexOfPrefix);
    expect(hashSecret(secret)).toBe(fingerprint);
  });
});
