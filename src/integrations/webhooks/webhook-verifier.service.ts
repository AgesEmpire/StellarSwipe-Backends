import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HmacAlgorithm,
  verifyHmacSignature,
} from './utils/signature-validator';

export interface WebhookVerificationOptions {
  rawBody: Buffer | string | undefined;
  parsedBody?: unknown;
  signatureHeader?: string;
  providerKeyName?: string;
  algorithm?: HmacAlgorithm;
}

@Injectable()
export class WebhookVerifierService {
  private readonly logger = new Logger(WebhookVerifierService.name);

  constructor(private readonly config: ConfigService) {}

  validate(
    rawBody: string,
    signatureHeader?: string,
    providerKeyName = 'WEBHOOK_SIGNING_KEY',
    algorithm: HmacAlgorithm = 'sha256',
  ): boolean {
    const secret =
      this.config.get<string>(providerKeyName) ||
      this.config.get<string>('WEBHOOK_SIGNING_KEY') ||
      '';
    const ok = verifyHmacSignature(
      rawBody,
      signatureHeader || '',
      secret,
      algorithm,
    );

    if (!ok) {
      this.logger.warn(`Invalid webhook signature for ${providerKeyName}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }

  validateRequest(options: WebhookVerificationOptions): string {
    const rawBody = this.getRawBody(options.rawBody, options.parsedBody);

    this.validate(
      rawBody,
      options.signatureHeader,
      options.providerKeyName,
      options.algorithm,
    );

    return rawBody;
  }

  private getRawBody(rawBody: Buffer | string | undefined, parsedBody?: unknown): string {
    if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
    if (typeof rawBody === 'string') return rawBody;
    return JSON.stringify(parsedBody ?? {});
  }
}
