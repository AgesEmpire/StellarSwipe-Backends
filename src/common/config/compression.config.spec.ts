import { compressionConfig } from './compression.config';

const buildReq = (headers: Record<string, string> = {}) => ({ headers }) as any;
const buildRes = (contentType?: string) =>
  ({
    getHeader: (name: string) =>
      name.toLowerCase() === 'content-type' ? contentType : undefined,
  }) as any;

describe('compressionConfig', () => {
  it('sets a 1KB threshold so tiny responses skip compression overhead', () => {
    expect(compressionConfig.threshold).toBe(1024);
  });

  describe('filter — compressed path', () => {
    it('compresses application/json responses', () => {
      const result = compressionConfig.filter!(buildReq(), buildRes('application/json'));
      expect(result).toBe(true);
    });

    it('compresses application/graphql-response+json responses (Apollo Server 4 content type)', () => {
      const result = compressionConfig.filter!(
        buildReq(),
        buildRes('application/graphql-response+json; charset=utf-8'),
      );
      expect(result).toBe(true);
    });

    it('compresses text/plain responses', () => {
      const result = compressionConfig.filter!(buildReq(), buildRes('text/plain'));
      expect(result).toBe(true);
    });

    it('compresses text/csv export responses', () => {
      const result = compressionConfig.filter!(buildReq(), buildRes('text/csv'));
      expect(result).toBe(true);
    });
  });

  describe('filter — uncompressed path', () => {
    it('does not compress when the client opts out via x-no-compression', () => {
      const result = compressionConfig.filter!(
        buildReq({ 'x-no-compression': '1' }),
        buildRes('application/json'),
      );
      expect(result).toBe(false);
    });

    it('does not compress binary image responses', () => {
      const result = compressionConfig.filter!(buildReq(), buildRes('image/png'));
      expect(result).toBe(false);
    });

    it('does not compress when no content-type header is present', () => {
      const result = compressionConfig.filter!(buildReq(), buildRes(undefined));
      expect(result).toBe(false);
    });

    it('does not compress application/octet-stream downloads', () => {
      const result = compressionConfig.filter!(buildReq(), buildRes('application/octet-stream'));
      expect(result).toBe(false);
    });
  });
});
