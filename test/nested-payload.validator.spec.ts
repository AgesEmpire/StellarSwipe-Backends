import { BadRequestException } from '@nestjs/common';
import {
  IsString,
  IsInt,
  IsEmail,
  IsNotEmpty,
  ValidateNested,
  IsOptional,
  IsArray,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  NestedPayloadValidator,
  flattenErrors,
} from '../src/common/validators/nested-payload.validator';

// ── fixture DTOs ──────────────────────────────────────────────────────────────

class AddressDto {
  @IsString()
  @IsNotEmpty()
  street: string;

  @IsString()
  @IsNotEmpty()
  city: string;
}

class ItemDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

class OrderDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEmail()
  email: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];

  @IsOptional()
  @IsString()
  note?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const validPayload = () => ({
  userId: 'user-1',
  email: 'user@example.com',
  address: { street: '1 Main St', city: 'Springfield' },
  items: [{ name: 'Widget', quantity: 2 }],
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('NestedPayloadValidator', () => {
  let validator: NestedPayloadValidator;

  beforeEach(() => {
    validator = new NestedPayloadValidator();
  });

  it('returns a validated instance for a fully valid payload', async () => {
    const result = await validator.validate(OrderDto, validPayload());
    expect(result).toBeInstanceOf(OrderDto);
    expect(result.userId).toBe('user-1');
  });

  it('validates nested object fields (address)', async () => {
    const payload = { ...validPayload(), address: { street: '', city: 'X' } };
    await expect(validator.validate(OrderDto, payload)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reports the nested field path in the error map', async () => {
    const payload = { ...validPayload(), address: { street: '', city: 'X' } };
    try {
      await validator.validate(OrderDto, payload);
      fail('expected to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      const errors = err.response.errors as Record<string, string[]>;
      // street is empty — should appear under address.street
      expect(Object.keys(errors).some((k) => k.includes('address'))).toBe(true);
    }
  });

  it('validates each element of a nested array (items)', async () => {
    const payload = {
      ...validPayload(),
      items: [{ name: 'Widget', quantity: 0 }], // quantity < 1
    };
    await expect(validator.validate(OrderDto, payload)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reports nested array element path in the error map', async () => {
    const payload = {
      ...validPayload(),
      items: [{ name: '', quantity: 1 }],
    };
    try {
      await validator.validate(OrderDto, payload);
      fail('expected to throw');
    } catch (err: any) {
      const errors = err.response.errors as Record<string, string[]>;
      expect(Object.keys(errors).some((k) => k.includes('items'))).toBe(true);
    }
  });

  it('rejects undeclared top-level properties (forbidNonWhitelisted)', async () => {
    // With forbidNonWhitelisted:true, extra properties throw rather than being
    // silently stripped — this is the stricter, more secure behavior.
    const payload = { ...validPayload(), __admin: true };
    await expect(validator.validate(OrderDto, payload)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects payloads with extra (non-whitelisted) properties', async () => {
    const payload = { ...validPayload(), extraField: 'injected' };
    await expect(validator.validate(OrderDto, payload)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when a required top-level field is missing', async () => {
    const { userId: _omit, ...payload } = validPayload();
    await expect(validator.validate(OrderDto, payload as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an invalid email at the top level', async () => {
    const payload = { ...validPayload(), email: 'not-an-email' };
    await expect(validator.validate(OrderDto, payload)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts an optional field when omitted', async () => {
    const payload = validPayload(); // note is absent
    await expect(validator.validate(OrderDto, payload)).resolves.toBeDefined();
  });

  it('accepts an optional field when present and valid', async () => {
    const payload = { ...validPayload(), note: 'leave at door' };
    const result = await validator.validate(OrderDto, payload);
    expect(result.note).toBe('leave at door');
  });

  it('collects multiple errors in a single pass (stopAtFirstError=false)', async () => {
    const payload = {
      ...validPayload(),
      email: 'bad',
      address: { street: '', city: '' },
    };
    try {
      await validator.validate(OrderDto, payload);
      fail('expected to throw');
    } catch (err: any) {
      const errors = err.response.errors as Record<string, string[]>;
      // Should have errors for both email and address fields
      expect(Object.keys(errors).length).toBeGreaterThan(1);
    }
  });

  it('coerces string numbers to integers via implicit conversion', async () => {
    const payload = {
      ...validPayload(),
      items: [{ name: 'Widget', quantity: '3' }], // string instead of number
    };
    const result = await validator.validate(OrderDto, payload);
    expect(result.items[0].quantity).toBe(3);
  });
});

// ── flattenErrors unit tests ──────────────────────────────────────────────────

describe('flattenErrors()', () => {
  it('returns empty object for no errors', () => {
    expect(flattenErrors([])).toEqual({});
  });

  it('flattens a single top-level error', () => {
    const err = {
      property: 'email',
      constraints: { isEmail: 'email must be an email' },
      children: [],
    } as any;
    expect(flattenErrors([err])).toEqual({
      email: ['email must be an email'],
    });
  });

  it('flattens nested errors with dot-notation paths', () => {
    const child = {
      property: 'street',
      constraints: { isNotEmpty: 'street should not be empty' },
      children: [],
    } as any;
    const parent = {
      property: 'address',
      constraints: {},
      children: [child],
    } as any;
    const result = flattenErrors([parent]);
    expect(result['address.street']).toEqual(['street should not be empty']);
  });

  it('handles a prefix for array element paths', () => {
    const child = {
      property: 'name',
      constraints: { isNotEmpty: 'name should not be empty' },
      children: [],
    } as any;
    const result = flattenErrors([child], 'items.0');
    expect(result['items.0.name']).toEqual(['name should not be empty']);
  });
});
