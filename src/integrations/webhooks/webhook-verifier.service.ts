import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  WebhookSignatureAlgorithm,
  verifyWebhookSignature,
} from './utils/signature-validator';

@Injectable()
export class WebhookVerifierService {
  constructor(private readonly configService: ConfigService) {}

  verifySignature(
    provider: string,
    payload: Buffer | string,
    signature?: string | string[],
    algorithm: WebhookSignatureAlgorithm = 'sha256',
  ): boolean {
    const signingKey = this.getSigningKey(provider);

    return verifyWebhookSignature({
      payload,
      secret: signingKey,
      signature,
      algorithm,
    });
  }

  assertValidSignature(
    provider: string,
    payload: Buffer | string,
    signature?: string | string[],
    algorithm: WebhookSignatureAlgorithm = 'sha256',
  ): void {
    if (!this.verifySignature(provider, payload, signature, algorithm)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  private getSigningKey(provider: string): string | undefined {
    const normalizedProvider = provider.trim();
    const envProvider = normalizedProvider
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toUpperCase();

    return (
      this.configService.get<string>(
        `webhooks.signingKeys.${normalizedProvider}`,
      ) ??
      this.configService.get<string>(`WEBHOOK_${envProvider}_SIGNING_KEY`) ??
      this.configService.get<string>('WEBHOOK_SIGNING_KEY')
    );
  }
}
