import { Module } from '@nestjs/common';
import { ImportValidationService } from './import-validation.service';

@Module({
  providers: [ImportValidationService],
  exports: [ImportValidationService],
})
export class ImportModule {}
