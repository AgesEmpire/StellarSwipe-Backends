/**
 * Consumer contract: MobileClient → StellarSwipe signal feed endpoint.
 *
 * Run with: jest --testPathPattern=contracts/consumer
 * Generated pact files land in test/contracts/pacts/ and are used by the
 * provider verification suite to confirm the backend honours the contract.
 */
import * as path from 'path';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';

const { like, eachLike, integer, string } = MatchersV3;

const provider = new PactV3({
  consumer: 'MobileClient',
  provider: 'StellarSwipeBackend',
  dir: path.resolve(process.cwd(), 'test/contracts/pacts'),
  logLevel: 'warn',
});

describe('Signal Feed – consumer contract', () => {
  describe('GET /api/v1/signals/feed', () => {
    it('returns a paginated list of signals with ETag on 200', async () => {
      await provider
        .addInteraction({
          states: [{ description: 'at least one active signal exists' }],
          uponReceiving: 'a request for the signal feed',
          withRequest: {
            method: 'GET',
            path: '/api/v1/signals/feed',
            query: { limit: '20', sortBy: 'ranked' },
          },
          willRespondWith: {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ETag: string('"abc123"'),
            },
            body: like({
              data: like({
                signals: eachLike({
                  id: string('signal-uuid'),
                  pair: string('USDC/XLM'),
                  action: string('BUY'),
                  price: string('0.12'),
                  confidence: integer(80),
                  status: string('ACTIVE'),
                  provider: like({
                    id: string('provider-uuid'),
                    displayName: string('TraderOne'),
                    successRate: integer(75),
                    totalSignals: integer(100),
                    reputationScore: integer(85),
                  }),
                  timestamp: string('2024-01-01T00:00:00.000Z'),
                  expiresAt: string('2024-01-02T00:00:00.000Z'),
                }),
              }),
              meta: like({
                timestamp: string('2024-01-01T00:00:00.000Z'),
                page: integer(1),
                totalPages: integer(1),
                hasMore: like(false),
                nextCursor: like(null),
                links: like({
                  self: string('/api/v1/signals/feed?page=1&limit=20'),
                  first: string('/api/v1/signals/feed?page=1&limit=20'),
                  last: string('/api/v1/signals/feed?page=1&limit=20'),
                  next: like(null),
                  prev: like(null),
                }),
              }),
            }),
          },
        })
        .executeTest(async (mockServer) => {
          const url = `${mockServer.url}/api/v1/signals/feed?limit=20&sortBy=ranked`;
          const response = await fetch(url);
          const body = await response.json();

          expect(response.status).toBe(200);
          expect(response.headers.get('etag')).toBeTruthy();
          expect(body.data.signals).toBeDefined();
          expect(Array.isArray(body.data.signals)).toBe(true);
          expect(body.meta).toBeDefined();
        });
    });

    it('returns 304 Not Modified when ETag matches', async () => {
      const knownEtag = '"abc123"';

      await provider
        .addInteraction({
          states: [{ description: 'signal feed content has not changed since last request' }],
          uponReceiving: 'a conditional GET with a matching If-None-Match header',
          withRequest: {
            method: 'GET',
            path: '/api/v1/signals/feed',
            headers: { 'If-None-Match': knownEtag },
          },
          willRespondWith: {
            status: 304,
          },
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/signals/feed`, {
            headers: { 'If-None-Match': knownEtag },
          });

          expect(response.status).toBe(304);
        });
    });
  });
});
