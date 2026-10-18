import { ArgumentsHost, RequestTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLError } from 'graphql';
import { GraphqlExceptionFilter } from './gql-exception.filter';

describe('GraphqlExceptionFilter', () => {
  const configService = { get: jest.fn().mockReturnValue('test') } as unknown as ConfigService;
  const host = {
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
    getType: () => 'graphql',
  } as unknown as ArgumentsHost;

  it('maps a RequestTimeoutException (issue #1385) to a consistent REQUEST_TIMEOUT error code', () => {
    const filter = new GraphqlExceptionFilter(configService);

    const result = filter.catch(
      new RequestTimeoutException('Resolver "Query.topProviders" exceeded its 2000ms execution budget'),
      host,
    ) as GraphQLError;

    expect(result).toBeInstanceOf(GraphQLError);
    expect(result.extensions?.code).toBe('REQUEST_TIMEOUT');
    expect(result.extensions?.status).toBe(408);
    expect(result.message).toContain('execution budget');
  });

  it('passes an already-structured GraphQLError through unchanged', () => {
    const filter = new GraphqlExceptionFilter(configService);
    const original = new GraphQLError('boom', { extensions: { code: 'CUSTOM' } });

    expect(filter.catch(original, host)).toBe(original);
  });
});
