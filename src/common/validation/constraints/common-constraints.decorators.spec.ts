import { validate } from 'class-validator';
import {
  NullableString,
  BoundedString,
  NullableBoundedNumber,
  BoundedNumber,
  NullableEnum,
  RequiredEnum,
  NullableIsoDate,
} from './common-constraints.decorators';

enum Color {
  RED = 'RED',
  BLUE = 'BLUE',
}

class Sample {
  @NullableString(5)
  nickname?: string;

  @BoundedString(2, 10)
  name!: string;

  @NullableBoundedNumber(0, 1)
  confidence?: number;

  @BoundedNumber(1, 100)
  quantity!: number;

  @NullableEnum(Color)
  favoriteColor?: Color;

  @RequiredEnum(Color)
  color!: Color;

  @NullableIsoDate()
  since?: string;
}

function build(overrides: Partial<Sample>): Sample {
  const instance = new Sample();
  Object.assign(instance, { name: 'ab', quantity: 1, color: Color.RED }, overrides);
  return instance;
}

describe('common validation constraints', () => {
  it('passes with only required fields set', async () => {
    const errors = await validate(build({}));
    expect(errors).toHaveLength(0);
  });

  it('rejects a nullable string longer than the max length', async () => {
    const errors = await validate(build({ nickname: 'way-too-long-nickname' }));
    expect(errors.some((e) => e.property === 'nickname')).toBe(true);
  });

  it('rejects a required string outside its bounds', async () => {
    const errors = await validate(build({ name: 'a' }));
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a nullable number outside its bounds', async () => {
    const errors = await validate(build({ confidence: 1.5 }));
    expect(errors.some((e) => e.property === 'confidence')).toBe(true);
  });

  it('rejects a required number outside its bounds', async () => {
    const errors = await validate(build({ quantity: 0 }));
    expect(errors.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('rejects a value not in the nullable enum', async () => {
    const errors = await validate(build({ favoriteColor: 'GREEN' as Color }));
    expect(errors.some((e) => e.property === 'favoriteColor')).toBe(true);
  });

  it('rejects a value not in the required enum', async () => {
    const errors = await validate(build({ color: 'GREEN' as Color }));
    expect(errors.some((e) => e.property === 'color')).toBe(true);
  });

  it('rejects a non-ISO-8601 date string', async () => {
    const errors = await validate(build({ since: 'not-a-date' }));
    expect(errors.some((e) => e.property === 'since')).toBe(true);
  });

  it('accepts a valid ISO-8601 date string', async () => {
    const errors = await validate(build({ since: '2026-01-01T00:00:00Z' }));
    expect(errors.some((e) => e.property === 'since')).toBe(false);
  });
});
