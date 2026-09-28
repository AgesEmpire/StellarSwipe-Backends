import * as path from 'path';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';

const { like, string, number, integer } = MatchersV3;

const provider = new PactV3({
  consumer: 'MobileClient',
  provider: 'StellarSwipeBackend',
  dir: path.resolve(process.cwd(), 'test/contracts/pacts'),
  logLevel: 'warn',
});

describe('Trade Execution – consumer contract', () => {
  describe('POST /api/v1/trades/execute', () => {
    it('creates a trade and returns trade result on 201', async () => {
      await provider
        .addInteraction({
          states: [{ description: 'user has sufficient balance and signal is active' }],
          uponReceiving: 'a request to execute a BUY trade',
          withRequest: {
            method: 'POST',
            path: '/api/v1/trades/execute',
            headers: { 'Content-Type': 'application/json' },
            body: {
              userId: string('user-uuid'),
              signalId: string('signal-uuid'),
              amount: number(100),
              type: string('BUY'),
            },
          },
          willRespondWith: {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: like({
              data: like({
                tradeId: string('trade-uuid'),
                status: string('PENDING'),
                type: string('BUY'),
                amount: number(100),
                entryPrice: string('0.12'),
                userId: string('user-uuid'),
                signalId: string('signal-uuid'),
                createdAt: string('2024-01-01T00:00:00.000Z'),
              }),
              meta: like({
                timestamp: string('2024-01-01T00:00:00.000Z'),
              }),
            }),
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/trades/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: 'user-uuid',
              signalId: 'signal-uuid',
              amount: 100,
              type: 'BUY',
            }),
          });

          const body = await response.json();
          expect(response.status).toBe(201);
          expect(body.data.tradeId).toBeDefined();
          expect(body.data.status).toBeDefined();
          expect(body.meta.timestamp).toBeDefined();
        });
    });

    it('returns 400 when request body is invalid', async () => {
      await provider
        .addInteraction({
          states: [],
          uponReceiving: 'a trade execution request with missing required fields',
          withRequest: {
            method: 'POST',
            path: '/api/v1/trades/execute',
            headers: { 'Content-Type': 'application/json' },
            body: {},
          },
          willRespondWith: {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: like({
              statusCode: integer(400),
              message: like('Bad Request'),
            }),
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/trades/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });

          expect(response.status).toBe(400);
        });
    });
  });
});
