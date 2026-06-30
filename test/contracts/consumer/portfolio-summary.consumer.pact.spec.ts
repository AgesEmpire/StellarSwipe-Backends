import * as path from 'path';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';

const { like, string, number, integer } = MatchersV3;

const provider = new PactV3({
  consumer: 'MobileClient',
  provider: 'StellarSwipeBackend',
  dir: path.resolve(process.cwd(), 'test/contracts/pacts'),
  logLevel: 'warn',
});

describe('Portfolio Summary – consumer contract', () => {
  describe('GET /api/v1/portfolio/summary/:walletAddress', () => {
    const walletAddress = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    it('returns portfolio summary for a valid wallet on 200', async () => {
      await provider
        .addInteraction({
          states: [{ description: 'portfolio exists for the given wallet address' }],
          uponReceiving: 'a request for portfolio summary by wallet address',
          withRequest: {
            method: 'GET',
            path: `/api/v1/portfolio/summary/${walletAddress}`,
          },
          willRespondWith: {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: like({
              data: like({
                walletAddress: string(walletAddress),
                totalValue: number(5000),
                unrealizedPnL: number(250),
                realizedPnL: number(100),
                openPositions: integer(3),
                winRate: number(0.65),
              }),
              meta: like({
                timestamp: string('2024-01-01T00:00:00.000Z'),
              }),
            }),
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/portfolio/summary/${walletAddress}`,
          );
          const body = await response.json();

          expect(response.status).toBe(200);
          expect(body.data.walletAddress).toBe(walletAddress);
          expect(typeof body.data.totalValue).toBe('number');
          expect(body.meta.timestamp).toBeDefined();
        });
    });

    it('returns 404 when wallet address has no associated account', async () => {
      const unknownWallet = 'GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

      await provider
        .addInteraction({
          states: [{ description: 'no account exists for the given wallet address' }],
          uponReceiving: 'a request for portfolio summary with unknown wallet',
          withRequest: {
            method: 'GET',
            path: `/api/v1/portfolio/summary/${unknownWallet}`,
          },
          willRespondWith: {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
            body: like({
              statusCode: integer(404),
              message: like('Not Found'),
            }),
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/portfolio/summary/${unknownWallet}`,
          );

          expect(response.status).toBe(404);
        });
    });
  });
});
