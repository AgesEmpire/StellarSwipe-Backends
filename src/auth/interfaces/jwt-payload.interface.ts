export interface JwtPayload {
  sub: string; // Internal User ID (UUID)
  sid?: string; // Session ID bound to the issued access token
  iat?: number;
  exp?: number;
}
