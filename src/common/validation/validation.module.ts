import { Module, Global } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { CustomValidationPipe } from '../pipes/validation.pipe';
import { SanitizationPipe } from '../pipes/sanitization.pipe';

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
  ],
  exports: [CustomValidationPipe, SanitizationPipe],
})
export class ValidationModule {}