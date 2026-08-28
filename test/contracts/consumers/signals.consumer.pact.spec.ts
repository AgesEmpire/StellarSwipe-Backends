import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { resolve } from 'path';

const { like, eachLike, string, integer, decimal, regex } = MatchersV3;

const provider = new PactV3({
  consumer: 'StellarSwipeFrontend',
  provider: 'StellarSwipeSignalsAPI',
  dir: resolve(__dirname, '..', 'pacts'),
});

describe('Signals API Contract Tests', () => {
  const authHeader = 'Bearer valid-test-token';

  describe('GET /api/v1/signals', () => {
    it('returns a paginated list of signals', async () => {
      await provider
        .given('signals exist in the system')
        .uponReceiving('a request to list signals')
        .withRequest({
          method: 'GET',
          path: '/api/v1/signals',
          headers: { Authorization: authHeader },
          query: { page: '1', limit: '10' },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': regex('application/json.*', 'application/json') },
          body: {
            success: true,
            data: eachLike({
              id: string('signal-uuid'),
              providerId: string('provider-uuid'),
              type: string('buy'),
              asset: string('XLM'),
              entryPrice: string('0.12'),
              targetPrice: string('0.15'),
              stopLoss: string('0.10'),
              status: string('active'),
              createdAt: string('2024-01-01T00:00:00.000Z'),
            }),
            meta: {
              page: integer(1),
              limit: integer(10),
              total: integer(25),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/signals?page=1&limit=10`,
            { headers: { Authorization: authHeader } },
          );

          const body = await response.json();
          expect(response.status).toBe(200);
          expect(Array.isArray(body.data)).toBe(true);
          expect(body.meta.page).toBe(1);
        });
    });
  });

  describe('POST /api/v1/signals/:id/copy', () => {
    it('copies a signal to the user portfolio', async () => {
      await provider
        .given('an active signal exists and user has sufficient balance')
        .uponReceiving('a request to copy a signal')
        .withRequest({
          method: 'POST',
          path: '/api/v1/signals/signal-uuid/copy',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: {
            amount: '500',
          },
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': regex('application/json.*', 'application/json') },
          body: {
            success: true,
            data: {
              tradeId: string('trade-uuid'),
              signalId: string('signal-uuid'),
              amount: string('500'),
              status: string('pending'),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/signals/signal-uuid/copy`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader,
              },
              body: JSON.stringify({ amount: '500' }),
            },
          );

          const body = await response.json();
          expect(response.status).toBe(201);
          expect(body.data.tradeId).toBeTruthy();
        });
    });
  });
});
