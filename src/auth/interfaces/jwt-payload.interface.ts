
export interface JwtPayload {
    sub: string; // Internal User ID (UUID)
    iat?: number;
    exp?: number;
}
