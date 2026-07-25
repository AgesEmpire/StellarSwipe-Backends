import { Module } from '@nestjs/common';
import { IdempotentStartupCheck } from './idempotent-startup.check';

@Module({
  providers: [IdempotentStartupCheck],
})
export class IdempotentModule {}
