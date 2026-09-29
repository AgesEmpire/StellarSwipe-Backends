import { BadRequestException } from '@nestjs/common';

/** Keyset position: the sort value plus a unique tiebreaker id. */
export interface CursorPayload {
  v: string | number;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed && ['string', 'number'].includes(typeof parsed.v) && typeof parsed.id === 'string') {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  throw new BadRequestException('Invalid pagination cursor');
}
