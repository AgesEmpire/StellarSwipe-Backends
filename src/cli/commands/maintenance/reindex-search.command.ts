import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal } from '../../../signals/entities/signal.entity';
import { User } from '../../../users/entities/user.entity';
import { CliCommand } from '../../interfaces/cli-command.interface';
import { progressBar } from '../../utils/progress-bar';

@Injectable()
export class ReindexSearchCommand implements CliCommand {
  name = 'maintenance:reindex';
  description = 'Reindex search data (signals and users). Usage: maintenance:reindex [--entity=signals|users]';

  constructor(
    @InjectRepository(Signal) private readonly signalRepo: Repository<Signal>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async run(args: string[]): Promise<void> {
    const entity = args.find((a) => a.startsWith('--entity='))?.split('=')[1];

    if (!entity || entity === 'signals') {
      await this.reindex('signals', this.signalRepo);
    }
    if (!entity || entity === 'users') {
      await this.reindex('users', this.userRepo);
    }
  }

  private async reindex(name: string, repo: Repository<any>): Promise<void> {
    const total = await repo.count();
    console.log(`\nReindexing ${name} (${total} records)...`);

    const batchSize = 100;
    let processed = 0;

    for (let offset = 0; offset < total; offset += batchSize) {
      await repo.find({ skip: offset, take: batchSize });
      processed = Math.min(offset + batchSize, total);
      process.stdout.write(`\r${progressBar(processed, total)}`);
    }

    console.log(`\n✓ ${name} reindex complete.`);
  }
}
