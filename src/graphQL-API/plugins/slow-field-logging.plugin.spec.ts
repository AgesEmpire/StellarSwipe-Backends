import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SlowFieldLoggingPlugin } from './slow-field-logging.plugin';

describe('SlowFieldLoggingPlugin', () => {
  let plugin: SlowFieldLoggingPlugin;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'GRAPHQL_SLOW_FIELD_THRESHOLD_MS') return 100;
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlowFieldLoggingPlugin,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    plugin = module.get<SlowFieldLoggingPlugin>(SlowFieldLoggingPlugin);
    configService = module.get(ConfigService);
  });

  describe('requestDidStart', () => {
    it('should warn for slow field resolution exceeding threshold', async () => {
      const warnSpy = jest.spyOn(plugin['logger'], 'warn');
      const requestContext: any = { context: {} };

      const listener = await plugin.requestDidStart(requestContext);

      const mockInfo = {
        parentType: { name: 'Query' },
        fieldName: 'users',
      };

      const fieldContext = { info: mockInfo };

      // Simulate slow resolution
      const result = await listener.willResolveField!(fieldContext);
      if (typeof result === 'function') {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await result(null, { data: 'test' });
      }

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Slow field resolution: Query.users'),
      );
    });

    it('should not warn for fast field resolution within threshold', async () => {
      const warnSpy = jest.spyOn(plugin['logger'], 'warn');
      const requestContext: any = { context: {} };

      const listener = await plugin.requestDidStart(requestContext);

      const mockInfo = {
        parentType: { name: 'Query' },
        fieldName: 'users',
      };

      const fieldContext = { info: mockInfo };

      const result = await listener.willResolveField!(fieldContext);
      if (typeof result === 'function') {
        await result(null, { data: 'test' });
      }

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
