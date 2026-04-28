import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { DocGeneratorService } from '../doc-generator.service';

export const DOC_REGEN_QUEUE = 'doc-regeneration';

@Processor(DOC_REGEN_QUEUE)
export class RegenerateDocsJob {
  private readonly logger = new Logger(RegenerateDocsJob.name);

  constructor(private readonly docGenerator: DocGeneratorService) {}

  @Process('regenerate')
  async handle(job: Job<{ reason?: string }>): Promise<void> {
    this.logger.log(`Regenerating docs. Reason: ${job.data.reason ?? 'scheduled'}`);
    try {
      await this.docGenerator.generateAll();
      this.logger.log('Documentation regenerated successfully.');
    } catch (err) {
      this.logger.error('Doc regeneration failed', (err as Error).stack);
      throw err;
    }
  }
}
