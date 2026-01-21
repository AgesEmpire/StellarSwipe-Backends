import { Global, Module } from '@nestjs/common';
import { LoggerService } from './logger.service';

/**
 * Global logger module
 * Makes LoggerService available throughout the application
 */
@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
