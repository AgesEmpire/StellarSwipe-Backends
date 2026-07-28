import { Test, TestingModule } from '@nestjs/testing';
import { PaymentAuditService } from './payment-audit.service';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';

describe('PaymentAuditService', () => {
  let service: PaymentAuditService;
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentAuditService,
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<PaymentAuditService>(PaymentAuditService);
  });

  it('logs a PAYMENT_CREATED event with a standardized payload', async () => {
    await service.logPaymentCreated({
      userId: 'user-1',
      paymentId: 'pay-1',
      amount: 100,
      currency: 'USD',
      gateway: 'stripe',
    });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: AuditAction.PAYMENT_CREATED,
        resource: 'payment',
        resourceId: 'pay-1',
        status: AuditStatus.SUCCESS,
        metadata: expect.objectContaining({
          amount: 100,
          currency: 'USD',
          gateway: 'stripe',
        }),
      }),
    );
  });

  it('logs a PAYMENT_CONFIRMED event', async () => {
    await service.logPaymentConfirmed({ userId: 'user-1', paymentId: 'pay-1' });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PAYMENT_CONFIRMED,
        status: AuditStatus.SUCCESS,
        resourceId: 'pay-1',
      }),
    );
  });

  it('logs a PAYMENT_FAILED event with FAILURE status and error message', async () => {
    await service.logPaymentFailed({ userId: 'user-1', paymentId: 'pay-1' }, 'card declined');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PAYMENT_FAILED,
        status: AuditStatus.FAILURE,
        errorMessage: 'card declined',
      }),
    );
  });

  it('logs a PAYMENT_REFUNDED event', async () => {
    await service.logPaymentRefunded({ userId: 'user-1', paymentId: 'pay-1', amount: 50 });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PAYMENT_REFUNDED,
        status: AuditStatus.SUCCESS,
        metadata: expect.objectContaining({ amount: 50 }),
      }),
    );
  });

  it('never throws when the underlying audit write fails', async () => {
    auditService.log.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.logPaymentCreated({ paymentId: 'pay-1' }),
    ).resolves.toBeUndefined();
  });
});
