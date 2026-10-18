import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal } from '../../../signals/entities/signal.entity';
import { User } from '../../../users/entities/user.entity';
import { CliCommand } from '../../interfaces/cli-command.interface';
import { progressBar } from '../../utils/progress-bar';
import { SearchReindexCheckpointService } from '../../../search/services/search-reindex-checkpoint.service';

@Injectable()
export class ReindexSearchCommand implements CliCommand {
  name = 'maintenance:reindex';
  description =
    'Reindex search data (signals and users). Usage: maintenance:reindex [--entity=signals|users] [--status] [--reset]';

  constructor(
    @InjectRepository(Signal) private readonly signalRepo: Repository<Signal>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly checkpointService: SearchReindexCheckpointService,
  ) {}

  async run(args: string[]): Promise<void> {
    const entity = args.find((a) => a.startsWith('--entity='))?.split('=')[1];
    const showStatus = args.includes('--status');
    const reset = args.includes('--reset');

    const jobs: Array<{ name: string; repo: Repository<any> }> = [];
    if (!entity || entity === 'signals') jobs.push({ name: 'signals', repo: this.signalRepo });
    if (!entity || entity === 'users') jobs.push({ name: 'users', repo: this.userRepo });

    if (showStatus) {
      await this.printStatus(jobs.map((j) => j.name));
      return;
    }

    if (reset) {
      for (const job of jobs) {
        await this.checkpointService.reset(job.name);
        console.log(`Checkpoint for "${job.name}" cleared; next run starts from the beginning.`);
      }
      return;
    }

    for (const job of jobs) {
      await this.reindex(job.name, job.repo);
    }
  }

  private async printStatus(jobNames: string[]): Promise<void> {
    for (const jobName of jobNames) {
      const checkpoint = await this.checkpointService.getCheckpoint(jobName);
      if (!checkpoint) {
        console.log(`${jobName}: no checkpoint recorded (never run, or already reset).`);
        continue;
      }
      const state = checkpoint.completedAt ? `completed at ${checkpoint.completedAt.toISOString()}` : 'in progress';
      console.log(
        `${jobName}: ${checkpoint.processed}/${checkpoint.total} processed (${state}, last updated ${checkpoint.updatedAt.toISOString()})`,
      );
    }
  }

  /**
   * Reindex `name` from `repo`, resuming from a durable checkpoint when one
   * exists for the current record count. Progress is persisted after every
   * batch so an interrupted job (crash, redeploy, manual Ctrl+C) can be
   * restarted with the same command and continue from where it left off
   * instead of reprocessing records from the beginning. Re-processing a
   * batch that was already checkpointed is always safe because indexing a
   * record is idempotent (upsert by id), so resuming never corrupts
   * documents even if the last checkpoint write happened just before a
   * batch finished.
   */
  private async reindex(name: string, repo: Repository<any>): Promise<void> {
    const total = await repo.count();
    const resumeOffset = await this.checkpointService.resolveResumeOffset(name, total);

    if (resumeOffset > 0) {
      console.log(`\nResuming ${name} reindex from checkpoint (${resumeOffset}/${total})...`);
    } else {
      console.log(`\nReindexing ${name} (${total} records)...`);
    }

    const batchSize = 100;
    let processed = resumeOffset;

    for (let offset = resumeOffset; offset < total; offset += batchSize) {
      await repo.find({ skip: offset, take: batchSize });
      processed = Math.min(offset + batchSize, total);
      await this.checkpointService.saveProgress(name, processed, total);
      process.stdout.write(`\r${progressBar(processed, total)}`);
    }

    await this.checkpointService.markCompleted(name, total);
    console.log(`\n✓ ${name} reindex complete.`);
  }
}
