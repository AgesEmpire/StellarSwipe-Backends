import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DocsController } from './docs.controller';
import { DocGeneratorService } from './doc-generator.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const SAMPLE_DOCUMENT = {
  openapi: '3.0.0',
  info: { title: 'StellarSwipe API', version: '2.0.0' },
  tags: [{ name: 'trades' }, { name: 'signals' }],
  paths: {
    '/api/v2/trades/execute': {
      post: {
        summary: 'Execute a trade',
        tags: ['trades'],
        operationId: 'TradesController_executeTrade',
        requestBody: {},
        responses: { '201': { description: 'Trade created' } },
      },
    },
    '/api/v2/signals': {
      get: {
        summary: 'List signals',
        tags: ['signals'],
        operationId: 'SignalsController_list',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  components: {
    schemas: {
      ExecuteTradeDto: {
        type: 'object',
        properties: { amount: { type: 'number' } },
      },
      TradeResultDto: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  },
};

function buildController(document: object | null = SAMPLE_DOCUMENT) {
  const docGeneratorService = {
    getCachedDocument: jest.fn().mockReturnValue(document),
  } as unknown as DocGeneratorService;

  return { controller: new DocsController(docGeneratorService), docGeneratorService };
}

describe('DocsController', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [DocsController],
      providers: [
        {
          provide: DocGeneratorService,
          useValue: { getCachedDocument: jest.fn().mockReturnValue(SAMPLE_DOCUMENT) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
  });

  describe('getApiInfo', () => {
    it('returns title, version, endpointCount, tagCount, and tags', () => {
      const { controller } = buildController();
      const result = controller.getApiInfo();
      expect(result.title).toBe('StellarSwipe API');
      expect(result.version).toBe('2.0.0');
      expect(result.endpointCount).toBe(2);
      expect(result.tagCount).toBe(2);
      expect(result.tags).toContain('trades');
      expect(result.tags).toContain('signals');
      expect(result.generatedAt).toBeDefined();
    });

    it('throws NotFoundException when document is null', () => {
      const { controller } = buildController(null);
      expect(() => controller.getApiInfo()).toThrow(NotFoundException);
    });
  });

  describe('getOpenApiJson', () => {
    it('returns the full OpenAPI document', () => {
      const { controller } = buildController();
      const result = controller.getOpenApiJson();
      expect((result as Record<string, unknown>)['openapi']).toBe('3.0.0');
    });

    it('throws NotFoundException when document is null', () => {
      const { controller } = buildController(null);
      expect(() => controller.getOpenApiJson()).toThrow(NotFoundException);
    });
  });

  describe('getEndpoints', () => {
    it('returns all endpoints when no tag filter is applied', () => {
      const { controller } = buildController();
      const endpoints = controller.getEndpoints();
      expect(endpoints).toHaveLength(2);
      expect(endpoints.some((e) => e.method === 'POST' && e.path.includes('trades'))).toBe(true);
      expect(endpoints.some((e) => e.method === 'GET' && e.path.includes('signals'))).toBe(true);
    });

    it('filters endpoints by tag (case-insensitive)', () => {
      const { controller } = buildController();
      const result = controller.getEndpoints('TRADES');
      expect(result).toHaveLength(1);
      expect(result[0].tags).toContain('trades');
    });

    it('returns empty array when tag has no matches', () => {
      const { controller } = buildController();
      const result = controller.getEndpoints('nonexistent');
      expect(result).toHaveLength(0);
    });

    it('throws NotFoundException when document is null', () => {
      const { controller } = buildController(null);
      expect(() => controller.getEndpoints()).toThrow(NotFoundException);
    });
  });

  describe('getSchemas', () => {
    it('returns all schemas with count when no name is provided', () => {
      const { controller } = buildController();
      const result = controller.getSchemas() as Record<string, unknown>;
      expect(result['count']).toBe(2);
      expect(result['schemas']).toHaveProperty('ExecuteTradeDto');
      expect(result['schemas']).toHaveProperty('TradeResultDto');
    });

    it('returns a single schema when name is provided', () => {
      const { controller } = buildController();
      const result = controller.getSchemas('ExecuteTradeDto') as Record<string, unknown>;
      expect(result['ExecuteTradeDto']).toBeDefined();
    });

    it('throws NotFoundException for an unknown schema name', () => {
      const { controller } = buildController();
      expect(() => controller.getSchemas('UnknownSchema')).toThrow(NotFoundException);
    });

    it('throws NotFoundException when document is null', () => {
      const { controller } = buildController(null);
      expect(() => controller.getSchemas()).toThrow(NotFoundException);
    });
  });
});
