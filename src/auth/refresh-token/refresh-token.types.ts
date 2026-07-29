export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
}
