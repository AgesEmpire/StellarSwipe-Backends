import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes } from 'crypto';
import { RefreshTokenRecord, IssuedTokenPair } from './refresh-token.types';

@Injectable()
export class RefreshTokenService {
  private readonly store = new Map<string, RefreshTokenRecord>();

  constructor(@Optional() private readonly events?: EventEmitter2) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  issue(
    userId: string,
    ttlMs = 1000 * 60 * 60 * 24 * 30,
    familyId = randomBytes(16).toString('hex'),
  ): IssuedTokenPair {
    const rawRefreshToken = randomBytes(48).toString('hex');
    const id = randomBytes(16).toString('hex');
    const record: RefreshTokenRecord = {
      id,
      userId,
      tokenHash: this.hash(rawRefreshToken),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      revokedAt: null,
      replacedByTokenId: null,
      familyId,
      consumedAt: null,
    };
    this.store.set(id, record);

    return {
      accessToken: randomBytes(32).toString('hex'),
      refreshToken: `${id}.${rawRefreshToken}`,
      refreshTokenId: id,
    };
  }

  refresh(presentedToken: string): IssuedTokenPair {
    const [id, raw] = presentedToken.split('.');
    const record = id ? this.store.get(id) : undefined;

    if (!record || !raw || record.tokenHash !== this.hash(raw)) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (record.revokedAt) {
      if (record.consumedAt) {
        this.revokeFamily(record.familyId);
        this.events?.emit('security.refresh_token_reuse', {
          userId: record.userId,
          familyId: record.familyId,
          tokenId: record.id,
        });
      }
      throw new UnauthorizedException('Refresh token has been revoked');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const next = this.issue(record.userId, undefined, record.familyId);
    record.revokedAt = new Date();
    record.consumedAt = record.revokedAt;
    record.replacedByTokenId = next.refreshTokenId;

    return next;
  }

  revoke(presentedToken: string): void {
    const [id] = presentedToken.split('.');
    const record = id ? this.store.get(id) : undefined;
    if (record && !record.revokedAt) {
      record.revokedAt = new Date();
    }
  }

  get(id: string): RefreshTokenRecord | undefined {
    return this.store.get(id);
  }

  private revokeFamily(familyId: string): void {
    for (const token of this.store.values()) {
      if (token.familyId === familyId)
        token.revokedAt = token.revokedAt ?? new Date();
    }
  }
}
