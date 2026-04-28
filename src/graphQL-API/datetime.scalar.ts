import { Scalar, CustomScalar } from '@nestjs/graphql';
import { Kind, ValueNode } from 'graphql';

@Scalar('DateTime', () => Date)
export class DateTimeScalar implements CustomScalar<string, Date> {
  description = 'ISO-8601 DateTime scalar — serializes to string, parses to Date';

  serialize(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value).toISOString();
    }
    throw new Error(`DateTimeScalar cannot serialize value: ${value}`);
  }

  parseValue(value: unknown): Date {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(`DateTimeScalar cannot parse value: ${value}`);
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error(`DateTimeScalar: invalid date "${value}"`);
    }
    return date;
  }

  parseLiteral(ast: ValueNode): Date {
    if (ast.kind !== Kind.STRING && ast.kind !== Kind.INT) {
      throw new Error(`DateTimeScalar only accepts string or int literals`);
    }
    const date = new Date(ast.value);
    if (isNaN(date.getTime())) {
      throw new Error(`DateTimeScalar: invalid literal date "${ast.value}"`);
    }
    return date;
  }
}
