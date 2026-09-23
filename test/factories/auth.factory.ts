import { JwtService } from '@nestjs/jwt';
import { TestUser } from './user.factory';

export interface AuthenticatedUser {
  user: TestUser;
  accessToken: string;
  refreshToken: string;
}

/**
 * AuthFactory — creates authenticated test contexts with valid JWT tokens.
 */
export class AuthFactory {
  private readonly jwtSecret: string;
  private readonly jwtService: JwtService;

  constructor(jwtSecret = 'test-jwt-secret-for-integration-tests') {
    this.jwtSecret = jwtSecret;
    this.jwtService = new JwtService({
      secret: this.jwtSecret,
      signOptions: { expiresIn: '1h' },
    });
  }

  /**
   * Generate a valid access token for a test user.
   */
  createAccessToken(user: TestUser): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      username: user.username,
    });
  }

  /**
   * Generate a refresh token for a test user.
   */
  createRefreshToken(user: TestUser): string {
    return this.jwtService.sign(
      { sub: user.id, type: 'refresh' },
      { expiresIn: '7d' },
    );
  }

  /**
   * Create an authenticated user context with access + refresh tokens.
   */
  authenticate(user: TestUser): AuthenticatedUser {
    return {
      user,
      accessToken: this.createAccessToken(user),
      refreshToken: this.createRefreshToken(user),
    };
  }

  /**
   * Create an authorization header value.
   */
  bearerHeader(user: TestUser): string {
    return `Bearer ${this.createAccessToken(user)}`;
  }
}
