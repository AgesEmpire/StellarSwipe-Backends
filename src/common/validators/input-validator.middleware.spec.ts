import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { InputValidatorMiddleware } from './input-validator.middleware';
import { Request, Response } from 'express';

const makeReq = (overrides: Partial<Request> = {}): Request =>
  ({
    headers: {},
    body: {},
    query: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request);

const makeRes = (): Response => ({} as Response);

describe('InputValidatorMiddleware', () => {
  let middleware: InputValidatorMiddleware;
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new InputValidatorMiddleware();
    next = jest.fn();
  });

  it('calls next() for a clean request', () => {
    const req = makeReq({ body: { name: 'Alice', amount: 100 } });
    middleware.use(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  describe('forbidden headers', () => {
    it('rejects x-internal-user-id header', () => {
      const req = makeReq({ headers: { 'x-internal-user-id': 'admin' } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects x-bypass-auth header', () => {
      const req = makeReq({ headers: { 'x-bypass-auth': '1' } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('allows normal headers', () => {
      const req = makeReq({ headers: { authorization: 'Bearer token', 'content-type': 'application/json' } });
      middleware.use(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('payload size', () => {
    it('rejects when content-length header exceeds limit', () => {
      const req = makeReq({ headers: { 'content-length': '2000000' } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(PayloadTooLargeException);
    });

    it('rejects serialized body larger than 1 MB', () => {
      const huge = { data: 'x'.repeat(1_100_000) };
      const req = makeReq({ body: huge });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(PayloadTooLargeException);
    });

    it('accepts body just below the limit', () => {
      const req = makeReq({ body: { data: 'x'.repeat(999_000) } });
      middleware.use(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('injection detection', () => {
    it('rejects SQL union select in body string', () => {
      const req = makeReq({ body: { q: "1 UNION SELECT * FROM users" } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('rejects script tag in body', () => {
      const req = makeReq({ body: { name: '<script>alert(1)</script>' } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('rejects path traversal in query param', () => {
      const req = makeReq({ query: { file: '../../../etc/passwd' } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('rejects NoSQL $where operator in body', () => {
      const req = makeReq({ body: { filter: { $where: 'this.a == 1' } } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('rejects template injection syntax in body', () => {
      const req = makeReq({ body: { template: '{{7*7}}' } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('allows normal query values', () => {
      const req = makeReq({ query: { page: '1', sort: 'asc', filter: 'active' } });
      middleware.use(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('prototype pollution', () => {
    it('rejects __proto__ key in body', () => {
      const body = JSON.parse('{"__proto__":{"isAdmin":true},"name":"test"}');
      const req = makeReq({ body });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('rejects constructor key in body', () => {
      const body = JSON.parse('{"constructor":{"prototype":{"isAdmin":true}}}');
      const req = makeReq({ body });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });
  });

  describe('structural limits', () => {
    it('rejects excessively deep nesting', () => {
      // Build a 12-levels deep object (max is 10)
      let deep: Record<string, unknown> = { value: 'leaf' };
      for (let i = 0; i < 12; i++) deep = { nested: deep };
      const req = makeReq({ body: deep });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('rejects object with too many keys', () => {
      const body: Record<string, string> = {};
      for (let i = 0; i < 110; i++) body[`key${i}`] = 'value';
      const req = makeReq({ body });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('rejects string field exceeding max length', () => {
      const req = makeReq({ body: { bio: 'a'.repeat(11_000) } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });

    it('allows object with exactly MAX_OBJECT_KEYS keys', () => {
      const body: Record<string, string> = {};
      for (let i = 0; i < 100; i++) body[`key${i}`] = 'v';
      const req = makeReq({ body });
      middleware.use(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('passes when body is null', () => {
      const req = makeReq({ body: null });
      middleware.use(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('passes for a body that is a primitive (non-object)', () => {
      const req = makeReq({ body: undefined });
      middleware.use(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('validates nested arrays', () => {
      const req = makeReq({ body: { tags: ['safe', 'also-safe'] } });
      middleware.use(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('rejects injection inside nested array element', () => {
      const req = makeReq({ body: { tags: ['ok', '<script>bad</script>'] } });
      expect(() => middleware.use(req, makeRes(), next)).toThrow(BadRequestException);
    });
  });
});
