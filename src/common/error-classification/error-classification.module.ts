import { Global, Module } from '@nestjs/common';
import { ErrorClassificationService } from './error-classification.service';
import { BlockchainErrorMapper } from './blockchain-error-mapper.service';
import { LoggerModule } from '../logger';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [ErrorClassificationService, BlockchainErrorMapper],
  exports: [ErrorClassificationService, BlockchainErrorMapper],
})
export class ErrorClassificationModule {}