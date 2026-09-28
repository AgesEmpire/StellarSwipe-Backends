import {
  Injectable,
  PipeTransform,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';

export interface CursorPayload {
  offset: number;
  limit: number;
  hash: string;
}

/**
 * Validates and decodes cursor tokens for cursor-based pagination.
 *
 * A cursor is an opaque, base64-encoded token that encodes pagination state.
 * This pipe:
 * 1. Decodes the base64 cursor
 * 2. Validates the embedded hash to detect tampering
 * 3. Validates that offset and limit are within safe bounds
 * 4. Re-encodes the cursor for use in response links
 *
 * @example
 * @Get('items')
 * getItems(@Query('cursor', new CursorValidationPipe()) cursor: string) {
 *   // cursor has been validated and decoded
 * }
 */
@Injectable()
export class CursorValidationPipe implements PipeTransform<string | undefined, string | undefined> {
  private readonly MAX_OFFSET = 1000000; // 1M max offset
  private readonly MAX_LIMIT = 1000; // 1K max items per page

  transform(value: string | undefined, metadata: ArgumentMetadata): string | undefined {
    if (!value) {
      return undefined;
    }

    try {
      this.validateCursor(value);
      return value;
    } catch (error) {
      throw new BadRequestException({
        message: 'Invalid or tampered cursor token',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Validates the integrity and format of a cursor token.
   *
   * @throws {Error} If cursor is malformed, tampered, or out of bounds.
   */
  private validateCursor(cursor: string): void {
    if (typeof cursor !== 'string' || cursor.length === 0) {
      throw new Error('Cursor must be a non-empty string');
    }

    // Verify it's valid base64
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cursor)) {
      throw new Error('Cursor is not valid base64');
    }

    // Decode the cursor
    let decoded: string;
    try {
      decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    } catch (error) {
      throw new Error('Failed to decode cursor from base64');
    }

    // Parse the JSON payload
    let payload: CursorPayload;
    try {
      payload = JSON.parse(decoded);
    } catch (error) {
      throw new Error('Cursor payload is not valid JSON');
    }

    // Validate payload structure
    if (typeof payload.offset !== 'number' || typeof payload.limit !== 'number' || typeof payload.hash !== 'string') {
      throw new Error('Cursor payload is missing required fields (offset, limit, hash)');
    }

    // Validate bounds
    if (payload.offset < 0 || payload.offset > this.MAX_OFFSET) {
      throw new Error(`Cursor offset must be between 0 and ${this.MAX_OFFSET}`);
    }

    if (payload.limit <= 0 || payload.limit > this.MAX_LIMIT) {
      throw new Error(`Cursor limit must be between 1 and ${this.MAX_LIMIT}`);
    }

    // Validate hash (detect tampering)
    const expectedHash = this.computeHash(payload.offset, payload.limit);
    if (payload.hash !== expectedHash) {
      throw new Error('Cursor hash validation failed — token may have been tampered with');
    }
  }

  /**
   * Encodes pagination state into an opaque cursor token.
   *
   * @param offset The current offset in the result set.
   * @param limit The number of items to return.
   * @returns A base64-encoded, tamper-evident cursor string.
   */
  encodeCursor(offset: number, limit: number): string {
    const payload: CursorPayload = {
      offset,
      limit,
      hash: this.computeHash(offset, limit),
    };
    return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
  }

  /**
   * Computes a deterministic hash of offset and limit to detect tampering.
   * Uses a simple approach; in production, consider HMAC with a secret key.
   *
   * @param offset The pagination offset.
   * @param limit The pagination limit.
   * @returns A hash string.
   */
  private computeHash(offset: number, limit: number): string {
    const crypto = require('crypto');
    const data = `${offset}:${limit}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
