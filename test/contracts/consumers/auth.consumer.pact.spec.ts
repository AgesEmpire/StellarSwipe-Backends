import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { resolve } from 'path';

const { like, eachLike, string, integer, regex, timestamp } = MatchersV3;

const provider = new PactV3({
  consumer: 'StellarSwipeFrontend',
  provider: 'StellarSwipeAuthAPI',
  dir: resolve(__dirname, '..', 'pacts'),
});

describe('Auth API Contract Tests', () => {
  describe('POST /api/v1/auth/login', () => {
    it('returns access and refresh tokens on valid credentials', async () => {
      await provider
        .given('a verified user exists')
        .uponReceiving('a login request with valid credentials')
        .withRequest({
          method: 'POST',
          path: '/api/v1/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: {
            email: 'user@example.com',
            password: 'ValidPassword123!',
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': regex('application/json.*', 'application/json') },
          body: {
            success: true,
            data: {
              accessToken: string('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'),
              refreshToken: string('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.refresh'),
              expiresIn: integer(3600),
              user: {
                id: string('uuid-123'),
                email: string('user@example.com'),
                username: string('testuser'),
              },
            },
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'user@example.com',
              password: 'ValidPassword123!',
            }),
          });

          const body = await response.json();
          expect(response.status).toBe(200);
          expect(body.success).toBe(true);
          expect(body.data.accessToken).toBeTruthy();
        });
    });

    it('returns 401 on invalid credentials', async () => {
      await provider
        .given('a verified user exists')
        .uponReceiving('a login request with invalid credentials')
        .withRequest({
          method: 'POST',
          path: '/api/v1/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: {
            email: 'user@example.com',
            password: 'WrongPassword',
          },
        })
        .willRespondWith({
          status: 401,
          headers: { 'Content-Type': regex('application/json.*', 'application/json') },
          body: {
            success: false,
            error: {
              message: string('Invalid credentials'),
              code: string('AUTH_INVALID_CREDENTIALS'),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'user@example.com',
              password: 'WrongPassword',
            }),
          });

          expect(response.status).toBe(401);
        });
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('returns a new access token for a valid refresh token', async () => {
      await provider
        .given('a valid refresh token exists')
        .uponReceiving('a token refresh request')
        .withRequest({
          method: 'POST',
          path: '/api/v1/auth/refresh',
          headers: { 'Content-Type': 'application/json' },
          body: {
            refreshToken: 'valid-refresh-token',
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': regex('application/json.*', 'application/json') },
          body: {
            success: true,
            data: {
              accessToken: string('new-access-token'),
              expiresIn: integer(3600),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: 'valid-refresh-token' }),
          });

          const body = await response.json();
          expect(response.status).toBe(200);
          expect(body.data.accessToken).toBeTruthy();
        });
    });
  });
});
