import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { MaxCallDepthService, MaxCallDepthValidationResult } from './max-call-depth.service';

const mockConfigService = {
  get: jest.fn(),
};

describe('MaxCallDepthService', () => {
  let service: MaxCallDepthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaxCallDepthService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(MaxCallDepthService);
  });

  describe('extractCallDepthFromSimulation', () => {
    it('returns depth 0 for empty simulation', () => {
      const result = service.extractCallDepthFromSimulation({});
      expect(result.depth).toBe(0);
      expect(result.contractInvocations).toEqual([]);
    });

    it('extracts depth from auth entries with subInvocations', () => {
      const simulation = {
        result: {
          auth: [
            {
              rootInvocation: {
                subInvocations: [
                  { subInvocations: [] },
                  { subInvocations: [{ subInvocations: [] }] },
                ],
              },
            },
          ],
        },
      };
      const result = service.extractCallDepthFromSimulation(simulation);
      expect(result.depth).toBe(2);
    });

    it('handles missing result gracefully', () => {
      const result = service.extractCallDepthFromSimulation({ transactionData: {} });
      expect(result.depth).toBe(0);
    });

    it('calculates footprint depth from transactionData', () => {
      const simulation = {
        result: {
          transactionData: {
            resources: {
              footprint: {
                readOnly: [1, 2, 3],
                readWrite: [4, 5],
              },
            },
          },
        },
      };
      const result = service.extractCallDepthFromSimulation(simulation);
      expect(result.depth).toBe(3);
    });
  });

  describe('validateDepth', () => {
    it('returns valid when actual depth is within limit', () => {
      const result = service.validateDepth(3, 5, 'reject', 'test-endpoint');
      expect(result).toEqual<MaxCallDepthValidationResult>({
        valid: true,
        actualDepth: 3,
        declaredMax: 5,
      });
    });

    it('returns invalid when actual depth exceeds limit in reject mode', () => {
      expect(() => service.validateDepth(6, 5, 'reject', 'test-endpoint')).toThrow(ConflictException);
    });

    it('returns invalid but does not throw in warn mode', () => {
      const result = service.validateDepth(6, 5, 'warn', 'test-endpoint');
      expect(result.valid).toBe(false);
      expect(result.actualDepth).toBe(6);
      expect(result.declaredMax).toBe(5);
      expect(result.message).toContain('exceeds maximum');
    });
  });

  describe('getMaxDepth', () => {
    it('returns endpoint-specific config when set', () => {
      mockConfigService.get.mockReturnValue(10);
      const result = service.getMaxDepth('custom-endpoint');
      expect(result).toBe(10);
      expect(mockConfigService.get).toHaveBeenCalledWith('trade.maxCallDepth.custom-endpoint');
    });

    it('falls back to default when endpoint config not set', () => {
      mockConfigService.get.mockReturnValue(undefined);
      const result = service.getMaxDepth('unknown-endpoint');
      expect(result).toBe(5);
      expect(mockConfigService.get).toHaveBeenCalledWith('trade.maxCallDepth.default', 5);
    });
  });

  describe('getViolationPolicy', () => {
    it('returns endpoint-specific policy when set', () => {
      mockConfigService.get.mockReturnValue('warn');
      const result = service.getViolationPolicy('custom-endpoint');
      expect(result).toBe('warn');
    });

    it('returns global default when endpoint policy not set', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'trade.maxCallDepthPolicy.test-endpoint') return undefined;
        return 'reject';
      });
      const result = service.getViolationPolicy('test-endpoint');
      expect(result).toBe('reject');
    });

    it('returns reject as fallback for invalid policy value', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'trade.maxCallDepthPolicy.test') return 'invalid';
        return undefined;
      });
      const result = service.getViolationPolicy('test');
      expect(result).toBe('reject');
    });
  });
});