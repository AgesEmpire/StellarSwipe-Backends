import { BadRequestException } from '@nestjs/common';
import { RejectDuplicateJsonKeysGuard } from './reject-duplicate-json-keys.guard';

const makeContext = (request: Record<string, unknown>) => ({
  getHandler: () => ({}),
  getClass: () => ({}),
  switchToHttp: () => ({
    getRequest: () => request,
  }),
});

const makeGuard = (enabled: boolean | undefined) => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(enabled) } as any;
  return new RejectDuplicateJsonKeysGuard(reflector);
};

describe('RejectDuplicateJsonKeysGuard', () => {
  it('is a no-op when the endpoint has not opted in via @RejectDuplicateJsonKeys()', () => {
    const request = {
      headers: { 'content-type': 'application/json' },
      rawBody: Buffer.from('{"amount":1,"amount":2}'),
    };
    expect(makeGuard(undefined).canActivate(makeContext(request) as any)).toBe(true);
  });

  it('allows an opted-in request whose JSON body has no duplicate keys', () => {
    const request = {
      headers: { 'content-type': 'application/json' },
      rawBody: Buffer.from('{"amount":1,"currency":"USD"}'),
    };
    expect(makeGuard(true).canActivate(makeContext(request) as any)).toBe(true);
  });

  it('rejects an opted-in request whose JSON body has a duplicate key', () => {
    const request = {
      headers: { 'content-type': 'application/json' },
      rawBody: Buffer.from('{"amount":1,"amount":999}'),
    };
    expect(() => makeGuard(true).canActivate(makeContext(request) as any)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a duplicate key nested inside the body', () => {
    const request = {
      headers: { 'content-type': 'application/json' },
      rawBody: Buffer.from('{"transfer":{"to":"A","to":"B"}}'),
    };
    expect(() => makeGuard(true).canActivate(makeContext(request) as any)).toThrow(
      BadRequestException,
    );
  });

  it('passes through when there is no raw body to inspect', () => {
    const request = { headers: { 'content-type': 'application/json' } };
    expect(makeGuard(true).canActivate(makeContext(request) as any)).toBe(true);
  });

  it('passes through non-JSON content types untouched', () => {
    const request = {
      headers: { 'content-type': 'multipart/form-data' },
      rawBody: Buffer.from('irrelevant'),
    };
    expect(makeGuard(true).canActivate(makeContext(request) as any)).toBe(true);
  });

  it('fails open when the body cannot be parsed at all (body-parser already rejects malformed JSON upstream)', () => {
    const request = {
      headers: { 'content-type': 'application/json' },
      rawBody: Buffer.from('{not valid json'),
    };
    expect(makeGuard(true).canActivate(makeContext(request) as any)).toBe(true);
  });
});
