import { Module, Global } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { CustomValidationPipe } from '../pipes/validation.pipe';
import { SanitizationPipe } from '../pipes/sanitization.pipe';
import { ValidationStrategyService } from './validation-strategy.service';

@Global()
@Module({
  providers: [
    {
      provide: APP_PIPE,
      useClass: SanitizationPipe,
    },
    {
      provide: APP_PIPE,
      useClass: CustomValidationPipe,
    },
    CustomValidationPipe,
    SanitizationPipe,
    ValidationStrategyService,
  ],
  exports: [CustomValidationPipe, SanitizationPipe, ValidationStrategyService],
})
export class ValidationModule {}