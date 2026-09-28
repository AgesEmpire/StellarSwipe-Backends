import { NormalizeStellarKeyPipe } from '../src/common/pipes/normalize-stellar-key.pipe';
import { NormalizeStellarKey } from '../src/common/decorators/normalize-stellar-key.decorator';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsStellarPublicKey } from '../src/common/decorators/is-stellar-address.decorator';

class TestDto {
  @NormalizeStellarKey()
  @IsStellarPublicKey()
  publicKey: string;
}

const VALID_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

describe('NormalizeStellarKeyPipe', () => {
  const pipe = new NormalizeStellarKeyPipe();

  it('trims leading and trailing whitespace', () => {
    expect(pipe.transform(`  ${VALID_KEY}  `)).toBe(VALID_KEY);
  });

  it('uppercases a lowercase key', () => {
    expect(pipe.transform(VALID_KEY.toLowerCase())).toBe(VALID_KEY);
  });

  it('handles mixed case with whitespace', () => {
    expect(pipe.transform(`  ${VALID_KEY.toLowerCase()}  `)).toBe(VALID_KEY);
  });

  it('returns non-string values unchanged', () => {
    expect(pipe.transform(12345 as any)).toBe(12345);
  });

  it('handles already-normalized key', () => {
    expect(pipe.transform(VALID_KEY)).toBe(VALID_KEY);
  });
});

describe('@NormalizeStellarKey() decorator', () => {
  it('normalizes whitespace-padded key before validation', async () => {
    const dto = plainToInstance(TestDto, { publicKey: `  ${VALID_KEY}  ` });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.publicKey).toBe(VALID_KEY);
  });

  it('normalizes lowercase key before validation', async () => {
    const dto = plainToInstance(TestDto, { publicKey: VALID_KEY.toLowerCase() });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.publicKey).toBe(VALID_KEY);
  });

  it('still rejects invalid keys after normalization', async () => {
    const dto = plainToInstance(TestDto, { publicKey: '  not-a-key  ' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
