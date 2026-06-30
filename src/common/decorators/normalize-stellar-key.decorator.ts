import { Transform } from 'class-transformer';

export function NormalizeStellarKey(): PropertyDecorator {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return value.trim().toUpperCase();
  });
}
