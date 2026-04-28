import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal, SignalStatus } from '../../../signals/entities/signal.entity';
import { CliCommand } from '../../interfaces/cli-command.interface';
import { formatTable } from '../../utils/table-formatter';

@Injectable()
export class ModerateSignalCommand implements CliCommand {
  name = 'signals:moderate';
  description = 'List active signals for review. Usage: signals:moderate [--provider=<id>] [--limit=<n>]';

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
  ) {}

  async run(args: string[]): Promise<void> {
    const providerId = args.find((a) => a.startsWith('--provider='))?.split('=')[1];
    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '20', 10);

    const qb = this.signalRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.provider', 'p')
      .where('s.status = :status', { status: SignalStatus.ACTIVE });

    if (providerId) qb.andWhere('s.providerId = :providerId', { providerId });
    qb.take(limit).orderBy('s.createdAt', 'DESC');

    const signals = await qb.getMany();

    if (!signals.length) {
      console.log('No active signals found.');
      return;
    }

    console.log(
      formatTable(
        ['ID', 'Provider', 'Pair', 'Type', 'Status', 'Created'],
        signals.map((s) => [
          s.id,
          s.provider?.username ?? s.providerId,
          s.getAssetPair(),
          s.type,
          s.status,
          s.createdAt.toISOString().split('T')[0],
        ]),
      ),
    );
    console.log(`\nTotal: ${signals.length}`);
  }
}
