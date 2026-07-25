import { Global, Module } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { CorrelationModule } from '../correlation/correlation.module';

/**
 * Global logger module.
 * Imports CorrelationModule so LoggerService can inject CorrelationIdStore
 * and stamp every log line with the current request's correlation ID.
 */
@Global()
@Module({
  imports: [CorrelationModule],
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
