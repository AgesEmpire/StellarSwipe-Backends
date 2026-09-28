import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LocalPaymentService } from './local-payment.service';
import { LocalPayment } from './entities/local-payment.entity';
import { PaymentConfig } from './entities/payment-config.entity';
import { RegionalRouter } from './utils/regional-router';
import { LocalPaymentStatus } from './providers/base-local.provider';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn((dto) => dto),
});

const mockRouter = {
  resolveProvider: jest.fn(),
  resolveByName: jest.fn(),
  getAvailableProviders: jest.fn(),
  listAll: jest.fn(),
};

describe('LocalPaymentService', () => {
  let service: LocalPaymentService;

  const mockProvider = {
    providerName: 'mpesa',
    supportedCurrencies: ['KES'],
    supportedCountries: ['KE'],
    initiatePayment: jest.fn(),
    getPaymentStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalPaymentService,
        { provide: getRepositoryToken(LocalPayment), useFactory: mockRepo },
        { provide: getRepositoryToken(PaymentConfig), useFactory: mockRepo },
        { provide: RegionalRouter, useValue: mockRouter },
      ],
    }).compile();

    service = module.get<LocalPaymentService>(LocalPaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initiate an M-Pesa payment', async () => {
    mockRouter.resolveProvider.mockReturnValue(mockProvider);
    mockProvider.initiatePayment.mockResolvedValue({
      transactionId: 'MP-123',
      externalRef: 'MP-123',
      status: LocalPaymentStatus.PENDING,
      amount: 1000,
      currency: 'KES',
    });

    const paymentRepo = service['paymentRepo'];
    jest.spyOn(paymentRepo, 'save').mockResolvedValue({ id: 'uuid-1' } as any);

    const result = await service.initiatePayment('KE', 'KES', {
      userId: 'user-1',
      amount: 1000,
      currency: 'KES',
      phoneNumber: '+254712345678',
    });

    expect(mockProvider.initiatePayment).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should return available providers for a country', () => {
    mockRouter.getAvailableProviders.mockReturnValue([mockProvider]);
    const providers = service.getAvailableProviders('KE');
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('mpesa');
  });

  it('should throw NotFoundException for unknown payment', async () => {
    const paymentRepo = service['paymentRepo'];
    jest.spyOn(paymentRepo, 'findOne').mockResolvedValue(null);

    await expect(service.getPaymentStatus('unknown-id')).rejects.toThrow('Payment unknown-id not found');
  });
});
