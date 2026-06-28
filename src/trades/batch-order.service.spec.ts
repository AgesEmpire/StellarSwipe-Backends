import { Test, TestingModule } from '@nestjs/testing';
import { BatchOrderService } from './batch-order.service';
import { TradesService } from './trades.service';
import { TradeSide } from './entities/trade.entity';
import { BatchOrderDto, BatchOrderItemDto } from './dto/batch-order.dto';
import { plainToInstance } from 'class-transformer';

const VALID_ITEM: BatchOrderItemDto = {
  userId: 'aab1c2d3-e4f5-6789-abcd-ef0123456789',
  signalId: 'bbc1c2d3-e4f5-6789-abcd-ef0123456780',
  side: TradeSide.BUY,
  amount: 100,
};

function makeDto(orders: Partial<BatchOrderItemDto>[]): BatchOrderDto {
  return plainToInstance(BatchOrderDto, { orders });
}

describe('BatchOrderService', () => {
  let service: BatchOrderService;
  let tradesService: jest.Mocked<TradesService>;

  beforeEach(async () => {
    tradesService = { executeTrade: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchOrderService,
        { provide: TradesService, useValue: tradesService },
      ],
    }).compile();

    service = module.get(BatchOrderService);
  });

  it('accepts all items when all are valid and execution succeeds', async () => {
    tradesService.executeTrade.mockResolvedValue({ id: 'trade-1' } as any);

    const dto = makeDto([VALID_ITEM, VALID_ITEM]);
    const result = await service.submitBatch(dto);

    expect(result.acceptedCount).toBe(2);
    expect(result.rejectedCount).toBe(0);
    expect(result.accepted[0].index).toBe(0);
    expect(result.accepted[1].index).toBe(1);
    expect(tradesService.executeTrade).toHaveBeenCalledTimes(2);
  });

  it('rejects all items when all are invalid', async () => {
    // Missing required fields: userId, signalId, side, amount
    const dto = makeDto([{}, {}]);
    const result = await service.submitBatch(dto);

    expect(result.rejectedCount).toBe(2);
    expect(result.acceptedCount).toBe(0);
    expect(tradesService.executeTrade).not.toHaveBeenCalled();
    // Each rejection should include specific field errors
    expect(result.rejected[0].errors.length).toBeGreaterThan(0);
    expect(result.rejected[1].errors.length).toBeGreaterThan(0);
  });

  it('handles mixed-validity batch: processes valid items, reports invalid by index', async () => {
    tradesService.executeTrade.mockResolvedValue({ id: 'trade-x' } as any);

    const dto = makeDto([
      VALID_ITEM,          // index 0 — valid
      {},                  // index 1 — invalid (missing fields)
      VALID_ITEM,          // index 2 — valid
      { side: 'INVALID' as any }, // index 3 — invalid enum
    ]);

    const result = await service.submitBatch(dto);

    expect(result.acceptedCount).toBe(2);
    expect(result.rejectedCount).toBe(2);

    const acceptedIndices = result.accepted.map((a) => a.index);
    expect(acceptedIndices).toEqual([0, 2]);

    const rejectedIndices = result.rejected.map((r) => r.index);
    expect(rejectedIndices).toContain(1);
    expect(rejectedIndices).toContain(3);
  });

  it('reports execution failures for valid items as rejections', async () => {
    tradesService.executeTrade
      .mockResolvedValueOnce({ id: 'trade-ok' } as any)
      .mockRejectedValueOnce(new Error('Insufficient balance'));

    const dto = makeDto([VALID_ITEM, VALID_ITEM]);
    const result = await service.submitBatch(dto);

    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.rejected[0].index).toBe(1);
    expect(result.rejected[0].errors[0]).toContain('Insufficient balance');
  });

  it('returns correct index references in accepted and rejected items', async () => {
    tradesService.executeTrade.mockResolvedValue({ id: 'trade-ok' } as any);

    const dto = makeDto([{}, VALID_ITEM, {}, VALID_ITEM]);
    const result = await service.submitBatch(dto);

    expect(result.accepted.map((a) => a.index)).toEqual([1, 3]);
    expect(result.rejected.map((r) => r.index)).toEqual([0, 2]);
  });
});
