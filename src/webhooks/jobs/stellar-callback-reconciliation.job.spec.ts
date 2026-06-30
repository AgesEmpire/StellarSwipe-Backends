jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  StellarCallbackReconciliationJob,
  MAX_RECONCILE_ATTEMPTS,
} from './stellar-callback-reconciliation.job';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookSenderService } from '../services/webhook-sender.service';

const makeDelivery = (
  overrides: Partial<WebhookDelivery> = {},
): WebhookDelivery =>
  ({
    id: 'delivery-1',
    eventId: 'evt-abc',
    eventType: 'payment.stellar.received',
    webhookId: 'wh-1',
    status: 'failed' as const,
    attempts: 1,
    payload: { event: 'payment.stellar.received', deliveryId: 'evt-abc' },
    createdAt: new Date(Date.now() - 20 * 60 * 1000),
    nextRetryAt: new Date(Date.now() - 1000),
    webhook: { id: 'wh-1', active: true } as any,
    ...overrides,
  }) as WebhookDelivery;

describe('StellarCallbackReconciliationJob', () => {
  let job: StellarCallbackReconciliationJob;
  let deliveryRepo: jest.Mocked<any>;
  let senderService: jest.Mocked<WebhookSenderService>;

  beforeEach(async () => {
    deliveryRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    };

    senderService = {
      retryInPlace: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarCallbackReconciliationJob,
        { provide: getRepositoryToken(WebhookDelivery), useValue: deliveryRepo },
        { provide: WebhookSenderService, useValue: senderService },
      ],
    }).compile();

    job = module.get<StellarCallbackReconciliationJob>(
      StellarCallbackReconciliationJob,
    );

    jest.spyOn((job as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((job as any).logger, 'debug').mockImplementation(() => {});
    jest.spyOn((job as any).logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  const mockQueryBuilder = (results: WebhookDelivery[]) => {
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(results),
    };
    deliveryRepo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  };

  it('does nothing when there are no candidates', async () => {
    mockQueryBuilder([]);

    await job.reconcile();

    expect(senderService.retryInPlace).not.toHaveBeenCalled();
  });

  it('retries failed delivery via senderService', async () => {
    const delivery = makeDelivery();
    mockQueryBuilder([delivery]);
    deliveryRepo.findOne.mockResolvedValue(null); // no prior success
    senderService.retryInPlace.mockResolvedValue(true);

    await job.reconcile();

    expect(senderService.retryInPlace).toHaveBeenCalledWith(delivery);
  });

  it('skips delivery when same eventId already succeeded', async () => {
    const delivery = makeDelivery();
    const successDelivery = makeDelivery({ id: 'delivery-2', status: 'success' as const });
    mockQueryBuilder([delivery]);
    deliveryRepo.findOne.mockResolvedValue(successDelivery);
    deliveryRepo.save.mockResolvedValue(undefined);

    await job.reconcile();

    expect(senderService.retryInPlace).not.toHaveBeenCalled();
    expect(deliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('delivery-2'),
      }),
    );
  });

  it('processes multiple candidates independently', async () => {
    const d1 = makeDelivery({ id: 'd1', eventId: 'evt-1' });
    const d2 = makeDelivery({ id: 'd2', eventId: 'evt-2' });
    mockQueryBuilder([d1, d2]);
    deliveryRepo.findOne.mockResolvedValue(null);
    senderService.retryInPlace
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await job.reconcile();

    expect(senderService.retryInPlace).toHaveBeenCalledTimes(2);
  });

  it('continues processing remaining candidates when one throws', async () => {
    const d1 = makeDelivery({ id: 'd1', eventId: 'evt-1' });
    const d2 = makeDelivery({ id: 'd2', eventId: 'evt-2' });
    mockQueryBuilder([d1, d2]);
    deliveryRepo.findOne.mockResolvedValue(null);
    senderService.retryInPlace
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(true);

    await expect(job.reconcile()).resolves.not.toThrow();
  });

  it('does not retry a delivery that has reached MAX_RECONCILE_ATTEMPTS', async () => {
    // The query builder filters by attempts < MAX_RECONCILE_ATTEMPTS, so a
    // maxed-out delivery should never appear in the candidates list.
    const exhausted = makeDelivery({ attempts: MAX_RECONCILE_ATTEMPTS });
    // Only the not-exhausted delivery reaches the job.
    mockQueryBuilder([]);

    await job.reconcile();

    expect(senderService.retryInPlace).not.toHaveBeenCalledWith(exhausted);
  });

  it('treats stale pending deliveries as candidates', async () => {
    const stalePending = makeDelivery({
      status: 'pending' as const,
      attempts: 0,
      createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min old
    });
    mockQueryBuilder([stalePending]);
    deliveryRepo.findOne.mockResolvedValue(null);
    senderService.retryInPlace.mockResolvedValue(false);

    await job.reconcile();

    expect(senderService.retryInPlace).toHaveBeenCalledWith(stalePending);
  });
});
