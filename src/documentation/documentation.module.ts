import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DocGeneratorService } from './doc-generator.service';
import { RegenerateDocsJob, DOC_REGEN_QUEUE } from './jobs/regenerate-docs.job';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: DOC_REGEN_QUEUE }),
  ],
  providers: [DocGeneratorService, RegenerateDocsJob],
  exports: [DocGeneratorService],
})
export class DocumentationModule {}
