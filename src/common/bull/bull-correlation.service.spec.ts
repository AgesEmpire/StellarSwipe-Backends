import { Test, TestingModule } from '@nestjs/testing';
import { BullCorrelationService } from './bull-correlation.service';
import { CorrelationIdStore } from '../correlation/correlation-id.store';

describe('BullCorrelationService', () => {
  let service: BullCorrelationService;
  let correlationIdStore: jest.Mocked<CorrelationIdStore>;

  beforeEach(async () => {
    const mockCorrelationIdStore = {
      getCorrelationId: jest.fn(),
      getContext: jest.fn(),
      run: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BullCorrelationService,
        {
          provide: CorrelationIdStore,
          useValue: mockCorrelationIdStore,
        },
      ],
    }).compile();

    service = module.get<BullCorrelationService>(BullCorrelationService);
    correlationIdStore = module.get(CorrelationIdStore) as jest.Mocked<CorrelationIdStore>;
  });

  describe('captureCorrelationId', () => {
    it('should return existing correlation ID from store when in HTTP context', () => {
      const existingId = '550e8400-e29b-41d4-a716-446655440000';
      correlationIdStore.getCorrelationId.mockReturnValue(existingId);

      const result = service.captureCorrelationId();

      expect(result).toBe(existingId);
      expect(correlationIdStore.getCorrelationId).toHaveBeenCalled();
    });

    it('should generate new correlation ID when outside HTTP context', () => {
      correlationIdStore.getCorrelationId.mockReturnValue(undefined);

      const result = service.captureCorrelationId();

      expect(result).toBeDefined();
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(correlationIdStore.getCorrelationId).toHaveBeenCalled();
    });

    it('should generate unique IDs for each call outside HTTP context', () => {
      correlationIdStore.getCorrelationId.mockReturnValue(undefined);

      const id1 = service.captureCorrelationId();
      const id2 = service.captureCorrelationId();

      expect(id1).not.toBe(id2);
    });
  });

  describe('getJobCorrelationId', () => {
    it('should return correlation ID from job data if present', () => {
      const correlationId = '550e8400-e29b-41d4-a716-446655440000';
      const jobData = { correlationId, entityId: 'abc-123' };

      const result = service.getJobCorrelationId(jobData);

      expect(result).toBe(correlationId);
    });

    it('should generate fallback ID if correlationId field missing', () => {
      const jobData = { entityId: 'abc-123' };

      const result = service.getJobCorrelationId(jobData);

      expect(result).toBeDefined();
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should generate fallback ID if correlationId is not a string', () => {
      const jobData = { correlationId: 123 as any };

      const result = service.getJobCorrelationId(jobData);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should handle null or undefined job data', () => {
      const result1 = service.getJobCorrelationId(null as any);
      const result2 = service.getJobCorrelationId(undefined as any);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(typeof result1).toBe('string');
      expect(typeof result2).toBe('string');
    });

    it('should generate unique fallback IDs', () => {
      const jobData = { entityId: 'abc-123' };

      const id1 = service.getJobCorrelationId(jobData);
      const id2 = service.getJobCorrelationId(jobData);

      expect(id1).not.toBe(id2);
    });
  });

  describe('integration scenarios', () => {
    it('should maintain correlation ID through request->job->processing flow', () => {
      const requestCorrelationId = '550e8400-e29b-41d4-a716-446655440000';
      correlationIdStore.getCorrelationId.mockReturnValue(requestCorrelationId);

      // Step 1: Capture during job enqueue
      const capturedId = service.captureCorrelationId();
      expect(capturedId).toBe(requestCorrelationId);

      // Step 2: Extract during job processing
      const jobData = { entityId: 'abc-123', correlationId: capturedId };
      const processingId = service.getJobCorrelationId(jobData);

      expect(processingId).toBe(requestCorrelationId);
    });

    it('should generate correlation ID for out-of-request jobs and maintain it', () => {
      correlationIdStore.getCorrelationId.mockReturnValue(undefined);

      // Step 1: Generate during job enqueue (outside HTTP)
      const generatedId = service.captureCorrelationId();

      // Step 2: Extract during job processing
      const jobData = { entityId: 'abc-123', correlationId: generatedId };
      const processingId = service.getJobCorrelationId(jobData);

      expect(processingId).toBe(generatedId);
    });
  });
});
