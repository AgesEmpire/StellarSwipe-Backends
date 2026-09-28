import { Test, TestingModule } from '@nestjs/testing';
import { SorobanFeeTrackerService } from './soroban-fee-tracker.service';

describe('SorobanFeeTrackerService', () => {
  let service: SorobanFeeTrackerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SorobanFeeTrackerService],
    }).compile();

    service = module.get<SorobanFeeTrackerService>(SorobanFeeTrackerService);
  });

  describe('calculateFeeEstimate', () => {
    it('calculates delta when actual fee exceeds simulated fee', () => {
      const estimate = service.calculateFeeEstimate(
        '1000',
        '1500',
        'CONTRACT123',
        'swap',
        'TXH456',
      );

      expect(estimate.simulatedFee).toBe('1000');
      expect(estimate.actualFee).toBe('1500');
      expect(estimate.delta).toBe('500');
      expect(estimate.deltaPercentage).toBe(50);
      expect(estimate.contractId).toBe('CONTRACT123');
      expect(estimate.method).toBe('swap');
      expect(estimate.hash).toBe('TXH456');
    });

    it('calculates negative delta when actual fee is less than simulated fee', () => {
      const estimate = service.calculateFeeEstimate(
        '2000',
        '1200',
        'CONTRACT123',
        'transfer',
        'TXH789',
      );

      expect(estimate.simulatedFee).toBe('2000');
      expect(estimate.actualFee).toBe('1200');
      expect(estimate.delta).toBe('-800');
      expect(estimate.deltaPercentage).toBe(-40);
    });

    it('handles zero delta when fees match exactly', () => {
      const estimate = service.calculateFeeEstimate(
        '1500',
        '1500',
        'CONTRACT123',
        'invoke',
        'TXH111',
      );

      expect(estimate.delta).toBe('0');
      expect(estimate.deltaPercentage).toBe(0);
    });

    it('handles zero simulated fee gracefully', () => {
      const estimate = service.calculateFeeEstimate(
        '0',
        '1000',
        'CONTRACT123',
        'call',
        'TXH222',
      );

      expect(estimate.deltaPercentage).toBe(0);
    });

    it('sets timestamp to current time', () => {
      const beforeCall = new Date();
      const estimate = service.calculateFeeEstimate('1000', '1500');
      const afterCall = new Date();

      expect(estimate.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(estimate.timestamp.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });
  });

  describe('logFeeComparison', () => {
    it('logs fee comparison without throwing', () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');
      const estimate = service.calculateFeeEstimate(
        '1000',
        '1500',
        'CONTRACT123',
        'swap',
        'TXH456',
      );

      expect(() => service.logFeeComparison(estimate)).not.toThrow();
      expect(loggerSpy).toHaveBeenCalled();
    });

    it('logs fees with contract, method, and transaction hash', () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');
      const estimate = service.calculateFeeEstimate(
        '1000',
        '1500',
        'CONTRACT123',
        'swap',
        'TXHASH123',
      );

      service.logFeeComparison(estimate);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('CONTRACT123.swap'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('TXHASH123'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('1000 stroops'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('1500 stroops'),
      );
    });
  });
});
