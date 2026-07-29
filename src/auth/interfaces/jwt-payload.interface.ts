export interface JwtPayload {
  sub: string; // Internal User ID (UUID)
  sid?: string; // Session ID for revocation checks
  iat?: number;
  exp?: number;
}
