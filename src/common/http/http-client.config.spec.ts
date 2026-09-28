import {
  DEFAULT_HTTP_TIMEOUTS,
  buildHttpClientOptions,
  resolveTimeoutBudget,
} from './http-client.config';

describe('http-client.config', () => {
  describe('resolveTimeoutBudget', () => {
    it('returns the standardized defaults when no budget is provided', () => {
      expect(resolveTimeoutBudget()).toEqual(DEFAULT_HTTP_TIMEOUTS);
    });

    it('honors a valid custom budget', () => {
      expect(resolveTimeoutBudget({ connect: 500, response: 2_000 })).toEqual({
        connect: 500,
        response: 2_000,
      });
    });

    it('falls back to defaults for invalid values', () => {
      expect(
        resolveTimeoutBudget({ connect: 0, response: Number.NaN }),
      ).toEqual(DEFAULT_HTTP_TIMEOUTS);
    });
  });

  describe('buildHttpClientOptions', () => {
    it('applies the response timeout to the client options', () => {
      const options = buildHttpClientOptions({ response: 4_000 });
      expect(options.timeout).toBe(4_000);
    });

    it('uses the default response timeout when unset', () => {
      const options = buildHttpClientOptions();
      expect(options.timeout).toBe(DEFAULT_HTTP_TIMEOUTS.response);
    });
  });
});
