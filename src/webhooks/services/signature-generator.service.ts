import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export interface WebhookSecretState {
  secret: string;
  nextSecret?: string;
  rotationStartedAt?: Date;
  rotationFinalizesAt?: Date;
}

@Injectable()
export class SignatureGeneratorService {
  generateSignature(payload: object, secret: string): string {
    const message = JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
  }

  generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateDeliveryId(): string {
    return uuidv4();
  }

  verifySignature(payload: object, secret: string, signature: string): boolean {
    const expected = this.generateSignature(payload, secret);
    const signatureBuffer = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  }

  signWithWebhookSecret(payload: object, webhook: WebhookSecretState): string {
    return this.generateSignature(payload, webhook.secret);
  }

  verifyWebhookSignature(payload: object, webhook: WebhookSecretState, signature: string): boolean {
    const now = new Date();
    const isInRotationWindow = webhook.rotationStartedAt && webhook.rotationFinalizesAt &&
      now >= webhook.rotationStartedAt && now <= webhook.rotationFinalizesAt;

    if (this.verifySignature(payload, webhook.secret, signature)) {
      return true;
    }

    if (isInRotationWindow && webhook.nextSecret) {
      return this.verifySignature(payload, webhook.nextSecret, signature);
    }

    return false;
  }

  initiateRotation(webhook: WebhookSecretState, rotationWindowMs: number): WebhookSecretState {
    return {
      ...webhook,
      nextSecret: this.generateSecret(),
      rotationStartedAt: new Date(),
      rotationFinalizesAt: new Date(Date.now() + rotationWindowMs),
    };
  }

  finalizeRotation(webhook: WebhookSecretState): WebhookSecretState {
    return {
      secret: webhook.nextSecret || webhook.secret,
      nextSecret: undefined,
      rotationStartedAt: undefined,
      rotationFinalizesAt: undefined,
    };
  }
}
