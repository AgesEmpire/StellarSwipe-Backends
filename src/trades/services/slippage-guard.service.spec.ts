import { Test, TestingModule } from '@nestjs/testing';
import { SlippageGuardService } from './slippage-guard.service';
import { ConfigService } from '../../config/config.service';
import { StellarConfigService } from '../../config/stellar.service';
import { HorizonBulkheadService } from '../../stellar/bulkhead/horizon-bulkhead.service';
import { SlippageExceededException } from '../exceptions/slippage-exceeded.exception';
import { Keypair } from '@stellar/stellar-base';

describe('SlippageGuardService', () => {
  let service: SlippageGuardService;
  let bulkheadService: jest.Mocked<HorizonBulkheadService>;

  beforeEach(async () => {
    bulkheadService = {
      read: jest.fn(),
      write: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlippageGuardService,
        {
          provide: ConfigService,
          useValue: {
            slippageToleranceBps: 50,
          },
        },
        {
          provide: StellarConfigService,
          useValue: {
            horizonUrl: 'http://localhost:8000',
            networkPassphrase: 'Test SDF Network ; September 2015',
          },
        },
        {
          provide: HorizonBulkheadService,
          useValue: bulkheadService,
        },
      ],
    }).compile();

    service = module.get<SlippageGuardService>(SlippageGuardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifySlippage', () => {
    const mockOrderbook = (bestPrice: string) => {
      bulkheadService.read.mockResolvedValueOnce({
        bids: [{ price: bestPrice, amount: '100' }],
      });
    };

    const mockIssuer = Keypair.random().publicKey();

    it('Within Tolerance: Execution proceeds normally', async () => {
      // Reference price = 0.15000000
      // Live price = 0.15060000
      // Deviation = 0.0006 / 0.1500 = 0.004 = 40 bps
      // 40 bps <= 50 bps limit
      mockOrderbook('0.15060000');

      await expect(
        service.verifySlippage('XLM', `USDC:${mockIssuer}`, 0.15),
      ).resolves.not.toThrow();
    });

    it('At Exact Boundary: Execution is permitted exactly at the limit', async () => {
      // Reference price = 0.15000000
      // Live price = 0.15075000
      // Deviation = 0.00075 / 0.1500 = 0.005 = 50 bps
      // 50 bps <= 50 bps limit
      mockOrderbook('0.15075000');

      await expect(
        service.verifySlippage('XLM', `USDC:${mockIssuer}`, 0.15),
      ).resolves.not.toThrow();
    });

    it('Exceeding Tolerance: Execution is blocked and throws custom exception', async () => {
      // Reference price = 0.15000000
      // Live price = 0.15090000
      // Deviation = 0.0009 / 0.1500 = 0.006 = 60 bps
      // 60 bps > 50 bps limit
      mockOrderbook('0.15090000');

      await expect(
        service.verifySlippage('XLM', `USDC:${mockIssuer}`, 0.15),
      ).rejects.toThrow(SlippageExceededException);
    });

    it('uses override bps when provided', async () => {
      // Limit overridden to 20 bps
      // Deviation = 40 bps
      // 40 bps > 20 bps limit
      mockOrderbook('0.15060000');

      await expect(
        service.verifySlippage('XLM', `USDC:${mockIssuer}`, 0.15, 20),
      ).rejects.toThrow(SlippageExceededException);
    });
  });
});
