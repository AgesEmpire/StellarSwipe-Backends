import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { verifyHmacSHA256 } from './utils/signature-validator';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WebhookVerifierService {
  private readonly logger = new Logger(WebhookVerifierService.name);
  constructor(private readonly config: ConfigService) {}

  validate(rawBody: string, signatureHeader?: string, providerKeyName = 'WEBHOOK_SIGNING_KEY'): boolean {
    const secret = this.config.get<string>(providerKeyName) || '';
    const ok = verifyHmacSHA256(rawBody, signatureHeader || '', secret);
    if (!ok) {
      this.logger.warn('Invalid webhook signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}
