import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

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
}
