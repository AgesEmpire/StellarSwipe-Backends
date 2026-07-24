import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { TradeDlqController } from './trade-dlq.controller';

describe('TradeDlqController', () => {
  let controller: TradeDlqController;
  const queueMock = {
    getFailedCount: jest.fn(),
    getFailed: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TradeDlqController],
      providers: [{ provide: getQueueToken('transactions'), useValue: queueMock }],
    }).compile();

    controller = module.get(TradeDlqController);
  });

  it('rejects non-admin callers', async () => {
    await expect(
      controller.getFailedJobs({ user: { id: 'u1', roles: ['trader'] } } as any, '10'),
    ).rejects.toThrow(ForbiddenException);
    expect(queueMock.getFailedCount).not.toHaveBeenCalled();
  });

  it('returns failed count and summarized recent jobs for admins', async () => {
    queueMock.getFailedCount.mockResolvedValue(2);
    queueMock.getFailed.mockResolvedValue([
      {
        id: 'j1',
        name: 'check-statuses',
        failedReason: 'RPC down',
        attemptsMade: 3,
        timestamp: 123,
        data: { foo: 'bar' },
      },
    ]);

    const result = await controller.getFailedJobs(
      { user: { id: 'admin1', roles: ['admin'] } } as any,
      '5',
    );

    expect(queueMock.getFailed).toHaveBeenCalledWith(0, 4);
    expect(result).toEqual({
      failedCount: 2,
      jobs: [
        {
          id: 'j1',
          name: 'check-statuses',
          failedReason: 'RPC down',
          attemptsMade: 3,
          timestamp: 123,
          data: { foo: 'bar' },
        },
      ],
    });
  });
});
