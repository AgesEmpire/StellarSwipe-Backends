import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OptimisticLockVersionMismatchError } from 'typeorm';
import { PositionBalanceUpdaterService } from './position-balance-updater.service';
import { Position } from '../entities/position.entity';
import { TradeSide } from '../../trades/entities/trade.entity';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    userId: 'user-1',
    tradeId: 'trade-1',
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    side: TradeSide.BUY,
    amount: '100',
    entryPrice: '0.10',
    currentPrice: '0.11',
    unrealizedPnL: '1.00',
    isActive: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PositionBalanceUpdaterService', () => {
  let service: PositionBalanceUpdaterService;
  let mockFindOne: jest.Mock;
  let mockSave: jest.Mock;

  beforeEach(async () => {
    mockFindOne = jest.fn();
    mockSave = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionBalanceUpdaterService,
        {
          provide: getRepositoryToken(Position),
          useValue: { findOne: mockFindOne, save: mockSave },
        },
      ],
    }).compile();

    service = module.get(PositionBalanceUpdaterService);
  });

  it('updates balance successfully on first attempt', async () => {
    const pos = makePosition();
    mockFindOne.mockResolvedValue(pos);
    mockSave.mockResolvedValue({ ...pos, currentPrice: '0.12', version: 2 });

    const result = await service.updateBalance('pos-1', { currentPrice: '0.12' });

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(result.currentPrice).toBe('0.12');
  });

  it('retries on OptimisticLockVersionMismatchError and succeeds', async () => {
    const pos = makePosition();
    const lockError = new OptimisticLockVersionMismatchError('positions', 1, 2);

    mockFindOne.mockResolvedValue(pos);
    // First save fails with lock error, second succeeds
    mockSave
      .mockRejectedValueOnce(lockError)
      .mockResolvedValueOnce({ ...pos, amount: '200', version: 3 });

    const result = await service.updateBalance('pos-1', { amount: '200' });

    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(result.amount).toBe('200');
  });

  it('throws ConflictException after max retries', async () => {
    const pos = makePosition();
    const lockError = new OptimisticLockVersionMismatchError('positions', 1, 2);

    mockFindOne.mockResolvedValue(pos);
    mockSave.mockRejectedValue(lockError);

    await expect(service.updateBalance('pos-1', { amount: '999' })).rejects.toThrow(
      ConflictException,
    );
    expect(mockSave).toHaveBeenCalledTimes(3);
  });

  it('throws NotFoundException when position does not exist', async () => {
    mockFindOne.mockResolvedValue(null);

    await expect(service.updateBalance('missing', {})).rejects.toThrow(NotFoundException);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('re-throws non-lock errors immediately without retry', async () => {
    const pos = makePosition();
    const dbError = new Error('DB connection lost');

    mockFindOne.mockResolvedValue(pos);
    mockSave.mockRejectedValue(dbError);

    await expect(service.updateBalance('pos-1', { amount: '50' })).rejects.toThrow(
      'DB connection lost',
    );
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
