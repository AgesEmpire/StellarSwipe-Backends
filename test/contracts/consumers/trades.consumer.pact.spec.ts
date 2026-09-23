import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { resolve } from 'path';

const { like, eachLike, string, integer, decimal, regex, boolean } = MatchersV3;

const provider = new PactV3({
  consumer: 'StellarSwipeFrontend',
  provider: 'StellarSwipeTradesAPI',
  dir: resolve(__dirname, '..', 'pacts'),
});

describe('Trades API Contract Tests', () => {
  const authHeader = 'Bearer valid-test-token';

  describe('POST /api/v1/trades', () => {
    it('creates a trade order', async () => {
      await provider
        .given('an authenticated user with sufficient balance')
        .uponReceiving('a request to create a buy trade')
        .withRequest({
          method: 'POST',
          path: '/api/v1/trades',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: {
            type: 'buy',
            asset: 'XLM',
            amount: '1000',
            price: '0.12',
          },
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': regex('application/json.*', 'application/json') },
          body: {
            success: true,
            data: {
              id: string('trade-uuid'),
              type: string('buy'),
              asset: string('XLM'),
              amount: string('1000'),
              price: string('0.12'),
              status: string('pending'),
              createdAt: string('2024-01-01T00:00:00.000Z'),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/trades`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({
              type: 'buy',
              asset: 'XLM',
              amount: '1000',
              price: '0.12',
            }),
          });

          const body = await response.json();
          expect(response.status).toBe(201);
          expect(body.data.status).toBe('pending');
        });
    });
  });

  describe('GET /api/v1/trades/positions', () => {
    it('returns the user open positions', async () => {
      await provider
        .given('an authenticated user with open positions')
        .uponReceiving('a request to list open positions')
        .withRequest({
          method: 'GET',
          path: '/api/v1/trades/positions',
          headers: { Authorization: authHeader },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': regex('application/json.*', 'application/json') },
          body: {
            success: true,
            data: eachLike({
              id: string('position-uuid'),
              asset: string('XLM'),
              amount: string('1000'),
              entryPrice: string('0.12'),
              currentPrice: string('0.13'),
              pnl: string('10.00'),
              pnlPercentage: string('8.33'),
              openedAt: string('2024-01-01T00:00:00.000Z'),
            }),
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/trades/positions`, {
            headers: { Authorization: authHeader },
          });

          const body = await response.json();
          expect(response.status).toBe(200);
          expect(Array.isArray(body.data)).toBe(true);
        });
    });
  });

  describe('GET /api/v1/trades/:id', () => {
    it('returns 404 for non-existent trade', async () => {
      await provider
        .given('an authenticated user')
        .uponReceiving('a request for a non-existent trade')
        .withRequest({
          method: 'GET',
          path: '/api/v1/trades/non-existent-id',
          headers: { Authorization: authHeader },
        })
        .willRespondWith({
          status: 404,
          headers: { 'Content-Type': regex('application/json.*', 'application/json') },
          body: {
            success: false,
            error: {
              message: string('Trade not found'),
              code: string('TRADE_NOT_FOUND'),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/trades/non-existent-id`,
            { headers: { Authorization: authHeader } },
          );

          expect(response.status).toBe(404);
        });
    });
  });
});
