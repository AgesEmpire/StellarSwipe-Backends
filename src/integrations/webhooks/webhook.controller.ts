import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { WebhookVerifierService } from './webhook-verifier.service';

@Controller('integrations/webhooks')
export class WebhookController {
  constructor(private readonly verifier: WebhookVerifierService) {}

  @Post(':provider')
  async receiveWebhook(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ) {
    const signature = this.getSignatureHeader(headers);
    const payload = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));

    this.verifier.assertValidSignature(provider, payload, signature);

    return {
      received: true,
      provider,
    };
  }

  private getSignatureHeader(
    headers: Record<string, string | string[] | undefined>,
  ): string | string[] | undefined {
    return (
      headers['x-webhook-signature'] ??
      headers['x-signature'] ??
      headers['x-hub-signature-256'] ??
      headers['stripe-signature']
    );
  }
}
