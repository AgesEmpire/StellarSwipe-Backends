import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  beforeEach(() => {
    service = new RefreshTokenService();
  });

  it('issues an access/refresh token pair', () => {
    const pair = service.issue('user-1');
    expect(pair.accessToken).toBeDefined();
    expect(pair.refreshToken).toContain('.');
  });

  it('rotates the refresh token on use', () => {
    const first = service.issue('user-1');
    const second = service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(() => service.refresh(first.refreshToken)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a revoked token', () => {
    const pair = service.issue('user-1');
    service.revoke(pair.refreshToken);

    expect(() => service.refresh(pair.refreshToken)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a malformed or unknown token', () => {
    expect(() => service.refresh('not-a-real-token')).toThrow(
      UnauthorizedException,
    );
    expect(() => service.refresh('unknown-id.deadbeef')).toThrow(
      UnauthorizedException,
    );
  });
});
