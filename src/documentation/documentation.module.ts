import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DocGeneratorService } from './doc-generator.service';
import { RegenerateDocsJob, DOC_REGEN_QUEUE } from './jobs/regenerate-docs.job';
import { DocsController } from './docs.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    BullModule.registerQueue({ name: DOC_REGEN_QUEUE }),
  ],
  providers: [DocGeneratorService, RegenerateDocsJob],
  controllers: [DocsController],
  exports: [DocGeneratorService],
})
export class DocumentationModule {}
