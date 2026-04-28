import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { DocGeneratorService } from './doc-generator.service';
import { DOC_REGEN_QUEUE } from './jobs/regenerate-docs.job';
import { OpenAPIObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const mockDocument: OpenAPIObject = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0', description: 'Test' },
  paths: {
    '/signals': {
      get: {
        tags: ['Signals'],
        summary: 'List signals',
        parameters: [],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  components: { schemas: {} },
  servers: [{ url: 'http://localhost:3000' }],
  tags: [{ name: 'Signals' }],
};

describe('DocGeneratorService', () => {
  let service: DocGeneratorService;
  const mockQueue = { add: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocGeneratorService,
        { provide: getQueueToken(DOC_REGEN_QUEUE), useValue: mockQueue },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') } },
      ],
    }).compile();

    service = module.get<DocGeneratorService>(DocGeneratorService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw if document not set', async () => {
    await expect(service.generateAll()).rejects.toThrow('OpenAPI document not set');
  });

  it('should generate all docs after setDocument', async () => {
    service.setDocument(mockDocument);
    const result = await service.generateAll();

    expect(result.endpointCount).toBe(1);
    expect(result.tagCount).toBe(1);
    expect(result.openApiJson).toContain('Test API');
    expect(result.markdown).toContain('# Test API');
    expect(result.gettingStarted).toContain('Getting Started');
    expect(result.useCases).toContain('Use Cases');
  });

  it('should queue regeneration', async () => {
    await service.scheduleRegeneration('test');
    expect(mockQueue.add).toHaveBeenCalledWith('regenerate', { reason: 'test' }, expect.any(Object));
  });
});
