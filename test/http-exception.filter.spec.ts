import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpExceptionFilter, ErrorPayload } from '../src/common/filters/http-exception.filter';
import { TRACE_ID_HEADER } from '../src/tracing/tracing.service';

const makeHost = (url = '/api/test', traceId?: string) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const req: any = {
    url,
    method: 'GET',
    headers: traceId ? { [TRACE_ID_HEADER]: traceId } : {},
  };
  const res: any = { status, json };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    res,
  } as any;
};

const getPayload = (host: any): ErrorPayload =>
  host.res.status.mock.results[0].value.json.mock.calls[0][0];

describe('HttpExceptionFilter (#366)', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => { filter = new HttpExceptionFilter(); });

  it('maps NotFoundException to standard ErrorPayload', () => {
    const host = makeHost('/api/items');
    filter.catch(new NotFoundException('Item not found'), host);
    const p = getPayload(host);
    expect(p.statusCode).toBe(404);
    expect(p.error).toBe('NOT_FOUND');
    expect(p.message).toBe('Item not found');
    expect(p.path).toBe('/api/items');
    expect(p.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('maps UnauthorizedException to 401', () => {
    const host = makeHost('/api/secure');
    filter.catch(new UnauthorizedException(), host);
    const p = getPayload(host);
    expect(p.statusCode).toBe(401);
    expect(host.res.status).toHaveBeenCalledWith(401);
  });

  it('includes traceId when x-trace-id header is present', () => {
    const host = makeHost('/api/trace', 'trace-abc');
    filter.catch(new BadRequestException('bad input'), host);
    expect(getPayload(host).traceId).toBe('trace-abc');
  });

  it('omits traceId when header is absent', () => {
    const host = makeHost('/api/no-trace');
    filter.catch(new BadRequestException('bad'), host);
    expect(getPayload(host).traceId).toBeUndefined();
  });

  it('handles array message from validation pipe', () => {
    const host = makeHost('/api/validate');
    filter.catch(
      new BadRequestException({ message: ['field is required', 'must be string'], error: 'Bad Request' }),
      host,
    );
    const p = getPayload(host);
    expect(p.statusCode).toBe(400);
    expect(Array.isArray(p.message)).toBe(true);
    expect(p.message).toContain('field is required');
  });

  it('handles HttpException with plain string body', () => {
    const host = makeHost('/api/plain');
    filter.catch(new HttpException('plain error', HttpStatus.CONFLICT), host);
    const p = getPayload(host);
    expect(p.statusCode).toBe(409);
    expect(p.message).toBe('plain error');
  });

  it('payload always contains all required fields', () => {
    const host = makeHost('/api/check');
    filter.catch(new BadRequestException('check'), host);
    expect(getPayload(host)).toMatchObject({
      statusCode: expect.any(Number),
      error: expect.any(String),
      message: expect.anything(),
      path: expect.any(String),
      timestamp: expect.any(String),
    });
  });
});
