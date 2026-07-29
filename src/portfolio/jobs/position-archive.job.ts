import { Injectable, OnModuleInit } from '@nestjs/common';
import { PositionArchiveService } from '../portfolio/services/position-archive.service';
import { JobSchedulerService } from '../../jobs/job-scheduler.service';

@Injectable()
export class PositionArchiveJob implements OnModuleInit {
  constructor(
    private readonly positionArchiveService: PositionArchiveService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'position.archive',
      cronEnvKey: 'CRON_POSITION_ARCHIVE',
      defaultCron: '0 3 * * *',
      handler: async () => {
        await this.runArchival();
      },
    });
  }

  async runArchival(): Promise<void> {
    const result = await this.positionArchiveService.archiveClosedPositions();
    const copiedResult = await this.positionArchiveService.archiveClosedCopiedPositions();
    console.log(
      `Position archival completed: ${result.archived} positions, ${copiedResult.archived} copied positions`,
    );

    return undefined;
  }
}