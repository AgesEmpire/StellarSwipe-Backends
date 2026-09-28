import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { StripePaymentService } from './stripe-payment.service';
import { PaymentAuditService } from '../../payment-audit.service';

describe('StripePaymentService', () => {
  let service: StripePaymentService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        'stripe.apiKey': 'sk_test_mock_key',
        'stripe.webhookSecret': 'whsec_mock_secret',
      };
      return config[key];
    }),
  };

  const mockPaymentAuditService = {
    logPaymentCreated: jest.fn(),
    logPaymentConfirmed: jest.fn(),
    logPaymentFailed: jest.fn(),
    logPaymentRefunded: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripePaymentService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PaymentAuditService,
          useValue: mockPaymentAuditService,
        },
      ],
    }).compile();

    service = module.get<StripePaymentService>(StripePaymentService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize with config', () => {
    expect(configService.get).toHaveBeenCalledWith('stripe.apiKey');
  });

  describe('createPaymentIntent', () => {
    it('should throw error when Stripe not configured', async () => {
      await expect(
        service.createPaymentIntent(100, 'USD'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmPayment', () => {
    it('should throw error when Stripe not configured', async () => {
      await expect(
        service.confirmPayment('pi_mock_id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('retrievePayment', () => {
    it('should throw error when Stripe not configured', async () => {
      await expect(
        service.retrievePayment('pi_mock_id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refundPayment', () => {
    it('should throw error when Stripe not configured', async () => {
      await expect(
        service.refundPayment('pi_mock_id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleWebhook', () => {
    it('should throw error when Stripe not configured', async () => {
      await expect(
        service.handleWebhook('mock_signature', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('webhook audit logging', () => {
    it('records a PAYMENT_CONFIRMED audit event on payment success', async () => {
      await (service as any).handlePaymentSuccess({
        id: 'pi_1',
        amount: 100,
        currency: 'usd',
        status: 'succeeded',
        metadata: { userId: 'user-1' },
      });

      expect(mockPaymentAuditService.logPaymentConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          paymentId: 'pi_1',
          amount: 100,
          currency: 'usd',
          gateway: 'stripe',
        }),
      );
    });

    it('records a PAYMENT_FAILED audit event on payment failure', async () => {
      await (service as any).handlePaymentFailure({
        id: 'pi_2',
        amount: 200,
        currency: 'usd',
        status: 'failed',
      });

      expect(mockPaymentAuditService.logPaymentFailed).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 'pi_2' }),
        expect.any(String),
      );
    });

    it('records a PAYMENT_REFUNDED audit event on refund', async () => {
      await (service as any).handleRefund({
        id: 'ch_1',
        amount: 50,
        currency: 'usd',
        status: 'refunded',
      });

      expect(mockPaymentAuditService.logPaymentRefunded).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 'ch_1', amount: 50 }),
      );
    });
  });

  describe('createCustomer', () => {
    it('should throw error when Stripe not configured', async () => {
      await expect(
        service.createCustomer('test@example.com'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listPaymentMethods', () => {
    it('should throw error when Stripe not configured', async () => {
      await expect(
        service.listPaymentMethods('cus_mock_id'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
