import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { User } from '../../../users/entities/user.entity';
import { CliCommand } from '../../interfaces/cli-command.interface';
import { progressBar } from '../../utils/progress-bar';

@Injectable()
export class ExportUserDataCommand implements CliCommand {
  name = 'users:export';
  description = 'Export user data to JSON. Usage: users:export [--output=<file>] [--active]';

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async run(args: string[]): Promise<void> {
    const outputFile =
      args.find((a) => a.startsWith('--output='))?.split('=')[1] ??
      `users-export-${Date.now()}.json`;
    const activeOnly = args.includes('--active');

    const qb = this.userRepo.createQueryBuilder('u');
    if (activeOnly) qb.andWhere('u.isActive = true');

    const total = await qb.getCount();
    console.log(`Exporting ${total} users...`);

    const batchSize = 100;
    const results: object[] = [];

    for (let offset = 0; offset < total; offset += batchSize) {
      const batch = await qb.skip(offset).take(batchSize).getMany();
      results.push(
        ...batch.map(({ id, username, email, isActive, createdAt, walletAddress }) => ({
          id,
          username,
          email,
          isActive,
          walletAddress,
          createdAt,
        })),
      );
      process.stdout.write(`\r${progressBar(Math.min(offset + batchSize, total), total)}`);
    }

    const outPath = path.resolve(outputFile);
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\n✓ Exported ${results.length} users to ${outPath}`);
  }
}
