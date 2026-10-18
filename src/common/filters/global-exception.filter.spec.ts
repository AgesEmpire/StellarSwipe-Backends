import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { GlobalExceptionFilter } from './global-exception.filter';
import { StellarException } from '../exceptions/stellar-exception';
import { SorobanException } from '../exceptions/soroban-exception';
import * as correlation from '../correlation';

/**
 * #1378 — Include correlation identifiers in standardized API errors.
 *
 * GlobalExceptionFilter is the application's catch-all exception filter.
 * Previously it ended in a syntax error (an unterminated object literal
 * merged with a second, incompatible classifier-based implementation that
 * tried to send a second response), so none of this behavior was
 * reachable or testable. These tests cover the restored, single
 * response-send implementation and specifically the correlation ID
 * propagation: every error response must carry the same `correlationId`
 * that was attached to its structured log entry.
 */
describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let logger: { error: jest.Mock; warn: jest.Mock; setContext: jest.Mock };
  let sentry: { captureException: jest.Mock };

  beforeEach(() => {
    jest.restoreAllMocks();
    logger = { error: jest.fn(), warn: jest.fn(), setContext: jest.fn() };
    sentry = { captureException: jest.fn() };
    filter = new GlobalExceptionFilter(logger as any, sentry as any);
  });

  function mockHost(reqOverrides: Record<string, unknown> = {}) {
    const req: any = {
      url: '/trades/123',
      method: 'GET',
      headers: {},
      get: jest.fn(),
      ...reqOverrides,
    };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any;
  }

  it('sends exactly one response per exception (regression guard for the previous double-send bug)', () => {
    const host = mockHost();
    filter.catch(new BadRequestException('bad input'), host);
    const res = host.switchToHttp().getResponse();

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('includes the AsyncLocalStorage-backed correlation ID in both the response body and the log metadata', () => {
    jest.spyOn(correlation, 'getCorrelationId').mockReturnValue('corr-async-local-1');
    const host = mockHost();

    filter.catch(new BadRequestException('bad input'), host);

    const res = host.switchToHttp().getResponse();
    const body = res.json.mock.calls[0][0];
    expect(body.correlationId).toBe('corr-async-local-1');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ correlationId: 'corr-async-local-1' }),
    );
  });

  it('prefers request.correlationId (set by CorrelationIdMiddleware) over AsyncLocalStorage', () => {
    jest.spyOn(correlation, 'getCorrelationId').mockReturnValue('corr-async-local-2');
    const host = mockHost({ correlationId: 'corr-from-middleware' });

    filter.catch(new BadRequestException('bad input'), host);

    const body = host.switchToHttp().getResponse().json.mock.calls[0][0];
    expect(body.correlationId).toBe('corr-from-middleware');
  });

  it('falls back to the x-correlation-id request header when no context is available', () => {
    jest.spyOn(correlation, 'getCorrelationId').mockReturnValue(undefined);
    const host = mockHost({ headers: { 'x-correlation-id': 'corr-from-header' } });

    filter.catch(new BadRequestException('bad input'), host);

    const body = host.switchToHttp().getResponse().json.mock.calls[0][0];
    expect(body.correlationId).toBe('corr-from-header');
  });

  it('maps a generic HttpException to its status and includes path/timestamp', () => {
    const host = mockHost();
    filter.catch(new BadRequestException('bad input'), host);

    const res = host.switchToHttp().getResponse();
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = res.json.mock.calls[0][0];
    expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(body.path).toBe('/trades/123');
    expect(typeof body.timestamp).toBe('string');
  });

  it('tags StellarException responses/logs with StellarError and the underlying stellarError detail', () => {
    const ex = new StellarException('Horizon unavailable', HttpStatus.BAD_GATEWAY, { code: 'timeout' });
    const host = mockHost();

    filter.catch(ex, host);

    const body = host.switchToHttp().getResponse().json.mock.calls[0][0];
    expect(body.error).toBe('StellarError');
    expect(logger.error).toHaveBeenCalledWith(
      'Stellar blockchain error',
      ex,
      expect.objectContaining({ stellarError: { code: 'timeout' } }),
    );
  });

  it('tags SorobanException responses/logs with SorobanError and contract details', () => {
    const ex = new SorobanException('Contract call failed', 'C123', 'swap', { error: 'rpc_internal_error' });
    const host = mockHost();

    filter.catch(ex, host);

    const body = host.switchToHttp().getResponse().json.mock.calls[0][0];
    expect(body.error).toBe('SorobanError');
    expect(logger.error).toHaveBeenCalledWith(
      'Soroban contract error',
      ex,
      expect.objectContaining({ contractId: 'C123', sorobanError: { error: 'rpc_internal_error' } }),
    );
  });

  it('maps TypeORM EntityNotFoundError to 404 without leaking entity internals', () => {
    const ex = new EntityNotFoundError('UserEntity', { id: '1' });
    const host = mockHost();

    filter.catch(ex, host);

    const res = host.switchToHttp().getResponse();
    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Resource not found');
  });

  it('maps a unique-constraint QueryFailedError (23505) to 409 Conflict', () => {
    const ex = new QueryFailedError('INSERT ...', [], new Error('duplicate key'));
    (ex as any).driverError = { code: '23505' };
    const host = mockHost();

    filter.catch(ex, host);

    const res = host.switchToHttp().getResponse();
    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Resource already exists');
  });

  it('reports other QueryFailedErrors to Sentry with the correlation ID attached', () => {
    const ex = new QueryFailedError('SELECT ...', [], new Error('connection reset'));
    (ex as any).driverError = { code: '08006' };
    jest.spyOn(correlation, 'getCorrelationId').mockReturnValue('corr-db-error');
    const host = mockHost();

    filter.catch(ex, host);

    expect(sentry.captureException).toHaveBeenCalledWith(
      ex,
      expect.objectContaining({ correlationId: 'corr-db-error' }),
    );
  });

  it('never exposes the raw message of an unexpected 5xx error to the client', () => {
    const ex = new HttpException('Something internal leaked', HttpStatus.INTERNAL_SERVER_ERROR);
    const host = mockHost();

    filter.catch(ex, host);

    const body = host.switchToHttp().getResponse().json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
  });

  it('reports a totally unexpected (non-HttpException) error to Sentry and returns a generic 500', () => {
    jest.spyOn(correlation, 'getCorrelationId').mockReturnValue('corr-unexpected');
    const host = mockHost();

    filter.catch(new Error('kaboom'), host);

    const res = host.switchToHttp().getResponse();
    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(body.correlationId).toBe('corr-unexpected');
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ correlationId: 'corr-unexpected' }),
    );
  });

  it('redacts secret-looking substrings in the client-facing message', () => {
    const ex = new BadRequestException('token=abc123secretvalue is invalid');
    const host = mockHost();

    filter.catch(ex, host);

    const body = host.switchToHttp().getResponse().json.mock.calls[0][0];
    expect(body.message).toContain('[REDACTED]');
    expect(body.message).not.toContain('abc123secretvalue');
  });
});
