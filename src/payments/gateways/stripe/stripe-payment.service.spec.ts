import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { StripePaymentService } from './stripe-payment.service';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripePaymentService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
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
