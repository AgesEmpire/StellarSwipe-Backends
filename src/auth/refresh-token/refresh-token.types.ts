export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
  familyId: string;
  consumedAt: Date | null;
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
}
