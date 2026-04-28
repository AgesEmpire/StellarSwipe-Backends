import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Signal, SignalStatus } from '../../../signals/entities/signal.entity';
import { User } from '../../../users/entities/user.entity';
import { CliCommand } from '../../interfaces/cli-command.interface';

@Injectable()
export class GenerateReportCommand implements CliCommand {
  name = 'analytics:report';
  description = 'Generate a summary analytics report. Usage: analytics:report [--output=<file>] [--from=<date>] [--to=<date>]';

  constructor(
    @InjectRepository(Signal) private readonly signalRepo: Repository<Signal>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async run(args: string[]): Promise<void> {
    const outputFile =
      args.find((a) => a.startsWith('--output='))?.split('=')[1] ??
      `report-${Date.now()}.json`;
    const from = args.find((a) => a.startsWith('--from='))?.split('=')[1];
    const to = args.find((a) => a.startsWith('--to='))?.split('=')[1];

    const signalQb = this.signalRepo.createQueryBuilder('s');
    const userQb = this.userRepo.createQueryBuilder('u');

    if (from) {
      signalQb.andWhere('s.createdAt >= :from', { from: new Date(from) });
      userQb.andWhere('u.createdAt >= :from', { from: new Date(from) });
    }
    if (to) {
      signalQb.andWhere('s.createdAt <= :to', { to: new Date(to) });
      userQb.andWhere('u.createdAt <= :to', { to: new Date(to) });
    }

    const [totalSignals, totalUsers, activeUsers] = await Promise.all([
      signalQb.getCount(),
      userQb.getCount(),
      this.userRepo.count({ where: { isActive: true } }),
    ]);

    const signalsByStatus = await this.signalRepo
      .createQueryBuilder('s')
      .select('s.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.status')
      .getRawMany();

    const report = {
      generatedAt: new Date().toISOString(),
      period: { from: from ?? 'all-time', to: to ?? 'now' },
      users: { total: totalUsers, active: activeUsers, inactive: totalUsers - activeUsers },
      signals: {
        total: totalSignals,
        byStatus: Object.fromEntries(
          signalsByStatus.map((r) => [r.status, parseInt(r.count, 10)]),
        ),
      },
    };

    const outPath = path.resolve(outputFile);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log('=== Analytics Report ===');
    console.log(`Users   : ${totalUsers} total, ${activeUsers} active`);
    console.log(`Signals : ${totalSignals} total`);
    signalsByStatus.forEach((r) => console.log(`  ${r.status}: ${r.count}`));
    console.log(`\n✓ Report saved to ${outPath}`);
  }
}
