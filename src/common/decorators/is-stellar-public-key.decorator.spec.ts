import { validate } from 'class-validator';
import { IsStellarPublicKey } from './is-stellar-address.decorator';

class TestDto {
  @IsStellarPublicKey()
  address: string;
}

// Valid Stellar public key (from Stellar testnet)
const VALID_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

async function errorsFor(value: string): Promise<string[]> {
  const dto = new TestDto();
  dto.address = value;
  const errors = await validate(dto);
  if (errors.length === 0) return [];
  return Object.values(errors[0].constraints ?? {});
}

describe('@IsStellarPublicKey', () => {
  it('accepts a valid Stellar public key', async () => {
    const errors = await errorsFor(VALID_KEY);
    expect(errors).toHaveLength(0);
  });

  it('rejects a Stellar secret key (S...)', async () => {
    const errors = await errorsFor('SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/Stellar public key/i);
  });

  it('rejects a muxed account (M...)', async () => {
    const errors = await errorsFor('MA7QYNF7SOWQ3GLR2BGMZEHXR' + 'A'.repeat(40));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects wrong prefix (A...)', async () => {
    const errors = await errorsFor('A' + VALID_KEY.slice(1));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects too-short address', async () => {
    const errors = await errorsFor('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOC');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects too-long address', async () => {
    const errors = await errorsFor(VALID_KEY + 'AAAA');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects wrong checksum (last char mutated)', async () => {
    const mutated = VALID_KEY.slice(0, -1) + (VALID_KEY.endsWith('A') ? 'B' : 'A');
    const errors = await errorsFor(mutated);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects empty string', async () => {
    const errors = await errorsFor('');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-string value', async () => {
    const dto = new TestDto();
    (dto as any).address = 12345;
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
