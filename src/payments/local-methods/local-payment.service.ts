import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocalPayment } from './entities/local-payment.entity';
import { PaymentConfig } from './entities/payment-config.entity';
import { RegionalRouter } from './utils/regional-router';
import { LocalPaymentRequest, LocalPaymentStatus } from './providers/base-local.provider';

@Injectable()
export class LocalPaymentService {
  private readonly logger = new Logger(LocalPaymentService.name);

  constructor(
    @InjectRepository(LocalPayment)
    private readonly paymentRepo: Repository<LocalPayment>,
    @InjectRepository(PaymentConfig)
    private readonly configRepo: Repository<PaymentConfig>,
    private readonly router: RegionalRouter,
  ) {}

  async initiatePayment(
    country: string,
    currency: string,
    request: LocalPaymentRequest,
  ): Promise<LocalPayment> {
    const provider = this.router.resolveProvider(country, currency);

    const response = await provider.initiatePayment(request);

    const payment = this.paymentRepo.create({
      userId: request.userId,
      provider: provider.providerName,
      amount: String(request.amount),
      currency,
      country: country.toUpperCase(),
      status: response.status,
      externalRef: response.externalRef,
      checkoutUrl: response.checkoutUrl,
      phoneNumber: request.phoneNumber,
      metadata: response.metadata,
    });

    return this.paymentRepo.save(payment);
  }

  async getPaymentStatus(paymentId: string): Promise<LocalPayment> {
    const payment = await this.paymentRepo.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

    if (payment.status === LocalPaymentStatus.PENDING || payment.status === LocalPaymentStatus.PROCESSING) {
      const provider = this.router.resolveByName(payment.provider);
      const statusResponse = await provider.getPaymentStatus(payment.externalRef);
      payment.status = statusResponse.status;
      if (statusResponse.completedAt) payment.completedAt = statusResponse.completedAt;
      await this.paymentRepo.save(payment);
    }

    return payment;
  }

  async getUserPayments(userId: string): Promise<LocalPayment[]> {
    return this.paymentRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  getAvailableProviders(country: string) {
    return this.router.getAvailableProviders(country).map((p) => ({
      name: p.providerName,
      currencies: p.supportedCurrencies,
    }));
  }

  listAllProviders() {
    return this.router.listAll();
  }

  async getConfig(provider: string, country: string): Promise<PaymentConfig | null> {
    return this.configRepo.findOne({ where: { provider, country: country.toUpperCase() } });
  }
}
