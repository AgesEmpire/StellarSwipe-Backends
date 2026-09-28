jest.mock('uuid', () => ({ v4: () => 'mock-uuid-v4' }));

import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import {
  CorrelationIdStore,
  CORRELATION_ID_HEADER,
} from '../correlation/correlation-id.store';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;
  let correlationIdStore: CorrelationIdStore;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CorrelationIdMiddleware, CorrelationIdStore],
    }).compile();

    middleware = module.get<CorrelationIdMiddleware>(CorrelationIdMiddleware);
    correlationIdStore = module.get<CorrelationIdStore>(CorrelationIdStore);

    mockRequest = {
      headers: {},
      path: '/api/v1/signals',
      method: 'GET',
    };
    mockResponse = {
      setHeader: jest.fn(),
    };
    nextFunction = jest.fn();
  });

  it('generates a correlation ID when none is supplied', () => {
    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockRequest.headers![CORRELATION_ID_HEADER]).toBe('mock-uuid-v4');
  });

  it('reuses a caller-supplied correlation ID header', () => {
    mockRequest.headers![CORRELATION_ID_HEADER] = 'caller-supplied-id';

    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockRequest.headers![CORRELATION_ID_HEADER]).toBe('caller-supplied-id');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      'caller-supplied-id',
    );
  });

  it('echoes the correlation ID back on the response', () => {
    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      expect.any(String),
    );
  });

  it('stores the correlation context for the duration of the request', () => {
    let observed: string | undefined;
    nextFunction.mockImplementation(() => {
      observed = correlationIdStore.getCorrelationId();
    });

    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(observed).toBeDefined();
    expect(observed).toBe(mockRequest.headers![CORRELATION_ID_HEADER]);
  });

  it('is not readable once the request has finished', () => {
    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(correlationIdStore.getCorrelationId()).toBeUndefined();
  });

  it('calls next() to continue the request chain', () => {
    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalledTimes(1);
  });
});
