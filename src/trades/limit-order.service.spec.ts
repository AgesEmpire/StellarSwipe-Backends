import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LimitOrderService } from './limit-order.service';
import { TradeSide, TradeStatus } from './entities/trade.entity';
import { SignalStatus } from '../signals/entities/signal.entity';

const mockSignal = {
  id: 'sig-1',
  status: SignalStatus.ACTIVE,
  expiresAt: new Date(Date.now() + 3_600_000),
  baseAsset: 'XLM',
  counterAsset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

const mockOrderbook = {
  midPrice: '0.15',
  lastUpdate: new Date(),
  bids: [],
  asks: [],
  spread: 0,
  assetPair: 'XLM:USDC',
};

const mockTrade = {
  id: 'trade-1',
  userId: 'user-1',
  signalId: 'sig-1',
  side: TradeSide.BUY,
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  entryPrice: '0.14',
  amount: '100',
  totalValue: '14',
  status: TradeStatus.PENDING,
  feeAmount: '0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeService = (overrides: Record<string, any> = {}) => {
  const signalRepo = {
    findOneBy: jest.fn().mockResolvedValue(mockSignal),
    ...overrides.signalRepo,
  };
  const tradeRepo = {
    create: jest.fn().mockReturnValue(mockTrade),
    save: jest.fn().mockResolvedValue(mockTrade),
    findOne: jest.fn().mockResolvedValue(mockTrade),
    ...overrides.tradeRepo,
  };
  const sdex = {
    getOrderbook: jest.fn().mockResolvedValue(mockOrderbook),
    ...overrides.sdex,
  };
  const soroban = {
    invokeContract: jest.fn().mockResolvedValue({ success: true, hash: 'abc123', feeCharged: '100' }),
    ...overrides.soroban,
  };
  const config = {
    get: jest.fn((key: string, def?: any) => {
      if (key === 'stellar.limitOrderContractId') return 'CONTRACT_ID';
      if (key === 'stellar.operatorSecret') return 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      return def;
    }),
    ...overrides.config,
  };

  return new LimitOrderService(
    signalRepo as any,
    tradeRepo as any,
    sdex as any,
    soroban as any,
    config as any,
  );
};

const baseDto = {
  userId: 'user-1',
  signalId: 'sig-1',
  side: TradeSide.BUY,
  amount: 100,
  limitPrice: 0.14,
  slippageTolerance: 1,
};

describe('LimitOrderService', () => {
  describe('place()', () => {
    it('throws NotFoundException when signal does not exist', async () => {
      const svc = makeService({ signalRepo: { findOneBy: jest.fn().mockResolvedValue(null) } });
      await expect(svc.place(baseDto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when signal is not active', async () => {
      const svc = makeService({
        signalRepo: { findOneBy: jest.fn().mockResolvedValue({ ...mockSignal, status: SignalStatus.CLOSED }) },
      });
      await expect(svc.place(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when signal has expired', async () => {
      const svc = makeService({
        signalRepo: {
          findOneBy: jest.fn().mockResolvedValue({ ...mockSignal, expiresAt: new Date(Date.now() - 1000) }),
        },
      });
      await expect(svc.place(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when market data is stale', async () => {
      const staleOrderbook = { ...mockOrderbook, lastUpdate: new Date(Date.now() - 120_000) };
      const svc = makeService({ sdex: { getOrderbook: jest.fn().mockResolvedValue(staleOrderbook) } });
      await expect(svc.place(baseDto)).rejects.toThrow(/stale/i);
    });

    it('throws BadRequestException when BUY limit price exceeds market + slippage', async () => {
      const svc = makeService();
      // market = 0.15, limit = 0.20 (33% above), tolerance = 1%
      await expect(svc.place({ ...baseDto, limitPrice: 0.20 })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when SELL limit price is below market - slippage', async () => {
      const svc = makeService();
      await expect(
        svc.place({ ...baseDto, side: TradeSide.SELL, limitPrice: 0.10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns pending status on successful Soroban submission', async () => {
      const svc = makeService();
      const result = await svc.place(baseDto);
      expect(result.status).toBe('pending');
      expect(result.transactionHash).toBe('abc123');
    });

    it('throws BadRequestException when Soroban call fails', async () => {
      const svc = makeService({
        soroban: {
          invokeContract: jest.fn().mockResolvedValue({ success: false, error: 'contract error' }),
        },
      });
      await expect(svc.place(baseDto)).rejects.toThrow(/contract error/i);
    });

    it('skips Soroban and returns pending when no contractId configured', async () => {
      const svc = makeService({
        config: {
          get: jest.fn((key: string, def?: any) => {
            if (key === 'stellar.limitOrderContractId') return '';
            return def;
          }),
        },
      });
      const result = await svc.place(baseDto);
      expect(result.status).toBe('pending');
    });
  });

  describe('getStatus()', () => {
    it('returns order status for existing trade', async () => {
      const svc = makeService();
      const result = await svc.getStatus('trade-1', 'user-1');
      expect(result.id).toBe('trade-1');
    });

    it('throws NotFoundException when trade not found', async () => {
      const svc = makeService({ tradeRepo: { findOne: jest.fn().mockResolvedValue(null) } });
      await expect(svc.getStatus('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
