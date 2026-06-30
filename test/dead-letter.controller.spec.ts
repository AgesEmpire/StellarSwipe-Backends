import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DeadLetterController } from '../src/jobs/dead-letter.controller';
import { DeadLetterService } from '../src/jobs/dead-letter.service';

describe('DeadLetterController', () => {
  let controller: DeadLetterController;
  let service: Partial<Record<keyof DeadLetterService, jest.Mock>>;

  const makeDlqJob = (id: string | number, overrides: Partial<any> = {}) => ({
    id,
    data: {
      jobId: `orig-${id}`,
      queue: 'trade-execution',
      data: { tradeId: 42 },
      failedReason: 'Timeout',
      attemptsMade: 3,
      failedAt: '2026-06-01T00:00:00.000Z',
      ...overrides,
    },
  });

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      discard: jest.fn(),
      replay: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeadLetterController],
      providers: [{ provide: DeadLetterService, useValue: service }],
    }).compile();

    controller = module.get(DeadLetterController);
  });

  describe('list', () => {
    it('returns formatted dead-letter entries', async () => {
      service.list.mockResolvedValue([makeDlqJob('1'), makeDlqJob('2')]);

      const result = await controller.list();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '1',
        originalJobId: 'orig-1',
        queue: 'trade-execution',
        payload: { tradeId: 42 },
        failedReason: 'Timeout',
        attemptsMade: 3,
        failedAt: '2026-06-01T00:00:00.000Z',
      });
    });

    it('returns empty array when no entries exist', async () => {
      service.list.mockResolvedValue([]);
      const result = await controller.list();
      expect(result).toEqual([]);
    });
  });

  describe('retry', () => {
    it('returns success when entry exists', async () => {
      service.list.mockResolvedValue([makeDlqJob('5')]);

      const result = await controller.retry('5');

      expect(result.retried).toBe(true);
      expect(result.jobId).toBe('5');
      expect(result.originalQueue).toBe('trade-execution');
    });

    it('throws NotFoundException when entry does not exist', async () => {
      service.list.mockResolvedValue([]);
      await expect(controller.retry('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('discard', () => {
    it('calls service.discard and returns confirmation', async () => {
      service.discard.mockResolvedValue(undefined);

      const result = await controller.discard('7');

      expect(service.discard).toHaveBeenCalledWith('7');
      expect(result).toEqual({ discarded: true, jobId: '7' });
    });
  });
});
