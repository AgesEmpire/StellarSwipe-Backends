import { StakeVerificationService } from './stake-verification.service';
import { ConfigService } from '@nestjs/config';

const makeService = () => {
  const cfg = { get: (k: string) => 'https://example.org' } as unknown as ConfigService;
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any;
  const svc = new StakeVerificationService(cfg, cache);
  // patch private query method
  return { svc, cache };
};

describe('StakeVerificationService', () => {
  it('verifies eligible provider', async () => {
    const { svc } = makeService();
    // @ts-ignore
    svc.queryStakeFromSoroban = jest.fn(async () => '2000');
    const res = await svc.verifyProviderStake({ publicKey: 'GABC' } as any);
    expect(res.verified).toBe(true);
    expect(res.stakeAmount).toBe('2000');
  });

  it('rejects ineligible provider', async () => {
    const { svc } = makeService();
    // @ts-ignore
    svc.queryStakeFromSoroban = jest.fn(async () => '10');
    const res = await svc.verifyProviderStake({ publicKey: 'GXYZ' } as any);
    expect(res.verified).toBe(false);
  });
});
