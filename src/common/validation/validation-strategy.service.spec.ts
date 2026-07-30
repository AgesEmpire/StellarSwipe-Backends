import { BadRequestException } from '@nestjs/common';
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';
import { ValidationStrategyService } from './validation-strategy.service';

class SamplePayload {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(10)
  score!: number;
}

describe('ValidationStrategyService', () => {
  const service = new ValidationStrategyService();

  it('returns the transformed instance when the payload is valid', async () => {
    const result = await service.validate(SamplePayload, { name: 'abc', score: 5 });
    expect(result).toBeInstanceOf(SamplePayload);
    expect(result.name).toBe('abc');
  });

  it('throws BadRequestException with a field-keyed error map on invalid input', async () => {
    await expect(service.validate(SamplePayload, { name: 'a', score: 999 })).rejects.toThrow(
      BadRequestException,
    );

    try {
      await service.validate(SamplePayload, { name: 'a', score: 999 });
      fail('expected validate() to throw');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as any;
      expect(response.message).toBe('Validation failed');
      expect(Object.keys(response.errors)).toEqual(expect.arrayContaining(['name', 'score']));
    }
  });

  it('strips properties not declared on the target class (whitelist)', async () => {
    const result = await service.validate(SamplePayload, {
      name: 'abc',
      score: 5,
      unexpected: 'nope',
    });
    expect((result as any).unexpected).toBeUndefined();
  });

  it('safeValidate returns a valid=false result instead of throwing', async () => {
    const result = await service.safeValidate(SamplePayload, { name: 'a', score: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeDefined();
    expect(result.errors.score).toBeDefined();
  });

  it('safeValidate returns valid=true for a well-formed payload', async () => {
    const result = await service.safeValidate(SamplePayload, { name: 'abc', score: 5 });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });
});
