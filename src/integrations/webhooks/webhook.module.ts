import { Module } from '@nestjs/common';

import { WebhookController } from './webhook.controller';
import { WebhookVerifierService } from './webhook-verifier.service';

@Module({
  controllers: [WebhookController],
  providers: [WebhookVerifierService],
  exports: [WebhookVerifierService],
})
export class IncomingWebhooksModule {}
