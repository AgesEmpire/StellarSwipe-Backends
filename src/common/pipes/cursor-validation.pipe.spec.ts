import { BadRequestException } from '@nestjs/common';
import { CursorValidationPipe } from './cursor-validation.pipe';

describe('CursorValidationPipe', () => {
  let pipe: CursorValidationPipe;

  beforeEach(() => {
    pipe = new CursorValidationPipe();
  });

  it('should pass through undefined cursor', () => {
    expect(pipe.transform(undefined, {} as any)).toBeUndefined();
  });

  it('should validate and accept a valid cursor', () => {
    const validCursor = pipe.encodeCursor(10, 20);
    const result = pipe.transform(validCursor, {} as any);
    expect(result).toBe(validCursor);
  });

  it('should reject invalid base64', () => {
    expect(() => {
      pipe.transform('!!!invalid base64!!!', {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject an empty string', () => {
    expect(() => {
      pipe.transform('', {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject malformed cursor payload', () => {
    // Create a valid base64 string with invalid JSON
    const badPayload = Buffer.from('not-json', 'utf-8').toString('base64');
    expect(() => {
      pipe.transform(badPayload, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject cursor with missing fields', () => {
    const incompletePayload = Buffer.from(JSON.stringify({ offset: 0 }), 'utf-8').toString('base64');
    expect(() => {
      pipe.transform(incompletePayload, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject negative offset', () => {
    const payload = {
      offset: -1,
      limit: 20,
      hash: 'any', // Will be validated and rejected anyway
    };
    const cursor = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    expect(() => {
      pipe.transform(cursor, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject offset exceeding maximum', () => {
    const payload = {
      offset: 2000000, // Exceeds MAX_OFFSET (1000000)
      limit: 20,
      hash: 'any',
    };
    const cursor = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    expect(() => {
      pipe.transform(cursor, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject limit of 0', () => {
    const payload = {
      offset: 0,
      limit: 0,
      hash: 'any',
    };
    const cursor = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    expect(() => {
      pipe.transform(cursor, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject negative limit', () => {
    const payload = {
      offset: 0,
      limit: -5,
      hash: 'any',
    };
    const cursor = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    expect(() => {
      pipe.transform(cursor, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject limit exceeding maximum', () => {
    const payload = {
      offset: 0,
      limit: 2000, // Exceeds MAX_LIMIT (1000)
      hash: 'any',
    };
    const cursor = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    expect(() => {
      pipe.transform(cursor, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject tampered cursor (modified hash)', () => {
    const originalCursor = pipe.encodeCursor(10, 20);
    const decoded = JSON.parse(Buffer.from(originalCursor, 'base64').toString('utf-8'));
    decoded.hash = 'tampered_hash';
    const tamperedCursor = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64');

    expect(() => {
      pipe.transform(tamperedCursor, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject tampered cursor (modified offset)', () => {
    const originalCursor = pipe.encodeCursor(10, 20);
    const decoded = JSON.parse(Buffer.from(originalCursor, 'base64').toString('utf-8'));
    decoded.offset = 999; // Change offset without updating hash

    const tamperedCursor = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64');

    expect(() => {
      pipe.transform(tamperedCursor, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should reject tampered cursor (modified limit)', () => {
    const originalCursor = pipe.encodeCursor(10, 20);
    const decoded = JSON.parse(Buffer.from(originalCursor, 'base64').toString('utf-8'));
    decoded.limit = 500; // Change limit without updating hash

    const tamperedCursor = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64');

    expect(() => {
      pipe.transform(tamperedCursor, {} as any);
    }).toThrow(BadRequestException);
  });

  it('should accept valid cursor at boundary values', () => {
    const cursor = pipe.encodeCursor(0, 1);
    const result = pipe.transform(cursor, {} as any);
    expect(result).toBe(cursor);
  });

  it('should accept valid cursor at maximum limits', () => {
    const cursor = pipe.encodeCursor(1000000, 1000);
    const result = pipe.transform(cursor, {} as any);
    expect(result).toBe(cursor);
  });

  it('should encode different offsets as different cursors', () => {
    const cursor1 = pipe.encodeCursor(0, 20);
    const cursor2 = pipe.encodeCursor(20, 20);
    expect(cursor1).not.toBe(cursor2);
  });

  it('should encode different limits as different cursors', () => {
    const cursor1 = pipe.encodeCursor(10, 20);
    const cursor2 = pipe.encodeCursor(10, 50);
    expect(cursor1).not.toBe(cursor2);
  });

  it('should consistently encode the same parameters', () => {
    const cursor1 = pipe.encodeCursor(10, 20);
    const cursor2 = pipe.encodeCursor(10, 20);
    expect(cursor1).toBe(cursor2);
  });

  it('should return error object with clear message for tampered cursor', () => {
    const badCursor = Buffer.from(JSON.stringify({ offset: 10, limit: 20, hash: 'bad' }), 'utf-8').toString('base64');
    expect(() => {
      pipe.transform(badCursor, {} as any);
    }).toThrow(BadRequestException);
  });
});
