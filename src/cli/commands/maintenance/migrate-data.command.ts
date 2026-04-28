import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CliCommand } from '../../interfaces/cli-command.interface';

@Injectable()
export class MigrateDataCommand implements CliCommand {
  name = 'maintenance:migrate';
  description = 'Run pending database migrations. Usage: maintenance:migrate [--revert]';

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run(args: string[]): Promise<void> {
    const revert = args.includes('--revert');

    if (revert) {
      console.log('Reverting last migration...');
      await this.dataSource.undoLastMigration();
      console.log('✓ Last migration reverted.');
    } else {
      console.log('Running pending migrations...');
      const migrations = await this.dataSource.runMigrations();
      if (!migrations.length) {
        console.log('No pending migrations.');
      } else {
        migrations.forEach((m) => console.log(`  ✓ ${m.name}`));
        console.log(`\n✓ ${migrations.length} migration(s) applied.`);
      }
    }
  }
}
