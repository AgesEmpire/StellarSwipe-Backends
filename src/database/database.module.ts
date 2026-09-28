import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.name'),
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        synchronize: false,
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.checkMigrationCompatibility();
  }

  /**
   * Verifies that the database schema is compatible with the application's
   * expected migrations. Pending migrations are surfaced as a distinct
   * readiness failure so operators can differentiate them from a database
   * outage. Credentials are never included in the emitted error.
   */
  private async checkMigrationCompatibility(): Promise<void> {
    try {
      const pendingMigrations = await this.dataSource.showMigrations();

      if (pendingMigrations) {
        const executed = await this.dataSource.query(
          'SELECT name FROM migrations ORDER BY id ASC',
        );
        const executedNames = new Set(
          (executed as Array<{ name: string }>).map((row) => row.name),
        );
        const pending = this.dataSource.migrations
          .map((migration) => migration.name)
          .filter((name) => !executedNames.has(name));

        const detail = pending.length > 0 ? `: ${pending.join(', ')}` : '';
        throw new Error(
          `Database schema is incompatible: ${pending.length} pending migration(s)${detail}`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Database schema is incompatible')) {
        this.logger.error(error.message);
        throw error;
      }

      // Database outage or connectivity failure: surface a distinct readiness
      // failure without leaking connection credentials.
      this.logger.error(
        'Database readiness check failed: unable to reach the database',
      );
      throw new Error('Database readiness check failed: database unavailable');
    }
  }
}
