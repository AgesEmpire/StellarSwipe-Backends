import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import { PaymentAuditService } from './payment-audit.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let gatewayFactory: { getDefaultGateway: jest.Mock; getGateway: jest.Mock };
  let paymentAuditService: {
    logPaymentCreated: jest.Mock;
    logPaymentConfirmed: jest.Mock;
    logPaymentFailed: jest.Mock;
    logPaymentRefunded: jest.Mock;
  };
  let mockGateway: {
    createPayment: jest.Mock;
    confirmPayment: jest.Mock;
    refundPayment: jest.Mock;
  };

  const reqWithUser = (userId: string) => ({ user: { id: userId } }) as any;

  beforeEach(async () => {
    mockGateway = {
      createPayment: jest.fn(),
      confirmPayment: jest.fn(),
      refundPayment: jest.fn(),
    };

    gatewayFactory = {
      getDefaultGateway: jest.fn().mockReturnValue(mockGateway),
      getGateway: jest.fn().mockReturnValue(mockGateway),
    };

    paymentAuditService = {
      logPaymentCreated: jest.fn(),
      logPaymentConfirmed: jest.fn(),
      logPaymentFailed: jest.fn(),
      logPaymentRefunded: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentGatewayFactory, useValue: gatewayFactory },
        { provide: PaymentAuditService, useValue: paymentAuditService },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  describe('createPayment', () => {
    it('records a PAYMENT_CREATED audit event on success', async () => {
      mockGateway.createPayment.mockResolvedValue({ id: 'pay-1', status: 'pending' });

      await controller.createPayment(
        { amount: 10, currency: 'USD' } as any,
        reqWithUser('user-1'),
      );

      expect(paymentAuditService.logPaymentCreated).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', paymentId: 'pay-1', amount: 10, currency: 'USD' }),
      );
      expect(paymentAuditService.logPaymentFailed).not.toHaveBeenCalled();
    });

    it('records a PAYMENT_FAILED audit event and rethrows when gateway fails', async () => {
      mockGateway.createPayment.mockRejectedValue(new Error('gateway down'));

      await expect(
        controller.createPayment({ amount: 10, currency: 'USD' } as any, reqWithUser('user-1')),
      ).rejects.toThrow('gateway down');

      expect(paymentAuditService.logPaymentFailed).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', amount: 10, currency: 'USD' }),
        'gateway down',
      );
    });
  });

  describe('confirmPayment', () => {
    it('records a PAYMENT_CONFIRMED audit event', async () => {
      mockGateway.confirmPayment.mockResolvedValue({ success: true });

      await controller.confirmPayment('pay-1', reqWithUser('user-1'));

      expect(paymentAuditService.logPaymentConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', paymentId: 'pay-1' }),
      );
    });
  });

  describe('refundPayment', () => {
    it('records a PAYMENT_REFUNDED audit event', async () => {
      mockGateway.refundPayment.mockResolvedValue({ success: true });

      await controller.refundPayment('pay-1', 25, reqWithUser('user-1'));

      expect(paymentAuditService.logPaymentRefunded).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', paymentId: 'pay-1', amount: 25 }),
      );
    });
  });
});
