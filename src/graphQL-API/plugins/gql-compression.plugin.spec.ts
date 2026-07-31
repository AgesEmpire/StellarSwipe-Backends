import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GqlCompressionPlugin } from './gql-compression.plugin';

describe('GqlCompressionPlugin', () => {
  let plugin: GqlCompressionPlugin;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'GRAPHQL_COMPRESSION_MIN_BYTES') return 100;
      return undefined;
    }),
  };

  const buildResponseContext = (data: unknown, errors: unknown[] = []) => {
    const headers = new Map<string, string>();
    return {
      response: {
        http: {
          headers: {
            set: (key: string, value: string) => headers.set(key, value),
          },
        },
        body: {
          kind: 'single' as const,
          singleResult: { data, errors: errors.length ? errors : undefined },
        },
      },
      headers,
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GqlCompressionPlugin,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    plugin = module.get<GqlCompressionPlugin>(GqlCompressionPlugin);
  });

  it('marks large responses as compression-eligible (compressed path)', async () => {
    const debugSpy = jest.spyOn(plugin['logger'], 'debug');
    const requestContext: any = { context: {}, request: { operationName: 'GetReport' } };
    const listener = await plugin.requestDidStart(requestContext);

    const largeData = { items: Array.from({ length: 50 }, (_, i) => ({ id: i, value: 'x'.repeat(20) })) };
    const { response, headers } = buildResponseContext(largeData);

    await listener.willSendResponse!({ response } as any);

    expect(headers.get('Vary')).toBe('Accept-Encoding');
    expect(headers.get('x-graphql-response-bytes')).toBeDefined();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('GetReport produced a'),
    );
  });

  it('does not mark small responses as compression-eligible (uncompressed path)', async () => {
    const debugSpy = jest.spyOn(plugin['logger'], 'debug');
    const requestContext: any = { context: {}, request: { operationName: 'GetUser' } };
    const listener = await plugin.requestDidStart(requestContext);

    const smallData = { id: 1, name: 'a' };
    const { response, headers } = buildResponseContext(smallData);

    await listener.willSendResponse!({ response } as any);

    expect(headers.get('Vary')).toBe('Accept-Encoding');
    expect(headers.get('x-graphql-response-bytes')).toBeUndefined();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('still sets Vary for a caching pipeline even when the response has no data', async () => {
    const requestContext: any = { context: {}, request: { operationName: 'GetUser' } };
    const listener = await plugin.requestDidStart(requestContext);

    const { response, headers } = buildResponseContext(undefined);
    await listener.willSendResponse!({ response } as any);

    expect(headers.get('Vary')).toBeUndefined();
  });

  it('does not log a debug line for a large response that contains errors', async () => {
    const debugSpy = jest.spyOn(plugin['logger'], 'debug');
    const requestContext: any = { context: {}, request: { operationName: 'GetReport' } };
    const listener = await plugin.requestDidStart(requestContext);

    const largeData = { items: Array.from({ length: 50 }, (_, i) => ({ id: i, value: 'x'.repeat(20) })) };
    const { response, headers } = buildResponseContext(largeData, [{ message: 'partial failure' }]);

    await listener.willSendResponse!({ response } as any);

    expect(headers.get('x-graphql-response-bytes')).toBeDefined();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('skips incremental/@defer multi-part responses', async () => {
    const requestContext: any = { context: {}, request: { operationName: 'GetReport' } };
    const listener = await plugin.requestDidStart(requestContext);

    const headers = new Map<string, string>();
    const response: any = {
      http: { headers: { set: (k: string, v: string) => headers.set(k, v) } },
      body: { kind: 'incremental' },
    };

    await listener.willSendResponse!({ response } as any);

    expect(headers.size).toBe(0);
  });
});
