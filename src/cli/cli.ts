import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { appConfig, sentryConfig } from '../config/app.config';
import { databaseConfig, redisConfig } from '../config/database.config';
import { redisCacheConfig } from '../config/redis.config';
import { jwtConfig } from '../config/jwt.config';
import { stellarConfig } from '../config/stellar.config';
import { xaiConfig } from '../config/xai.config';
import { connectionPoolConfig } from '../database/config/connection-pool.config';
import configuration from '../config/configuration';
import { configSchema } from '../config/schemas/config.schema';
import { CliModule } from './cli.module';
import { CliCommand } from './interfaces/cli-command.interface';
import { ListUsersCommand } from './commands/users/list-users.command';
import { SuspendUserCommand } from './commands/users/suspend-user.command';
import { ExportUserDataCommand } from './commands/users/export-user-data.command';
import { ModerateSignalCommand } from './commands/signals/moderate-signal.command';
import { FlagSignalCommand } from './commands/signals/flag-signal.command';
import { ClearCacheCommand } from './commands/maintenance/clear-cache.command';
import { MigrateDataCommand } from './commands/maintenance/migrate-data.command';
import { ReindexSearchCommand } from './commands/maintenance/reindex-search.command';
import { GenerateReportCommand } from './commands/analytics/generate-report.command';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig, sentryConfig, stellarConfig, databaseConfig,
        redisConfig, redisCacheConfig, jwtConfig, xaiConfig,
        connectionPoolConfig, configuration,
      ],
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
      validationSchema: configSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        type: 'postgres' as const,
        host: cs.get<string>('database.host'),
        port: cs.get<number>('database.port'),
        username: cs.get<string>('database.username'),
        password: cs.get<string>('database.password'),
        database: cs.get<string>('database.database'),
        synchronize: false,
        logging: false,
        entities: ['dist/**/*.entity{.ts,.js}'],
        migrations: ['dist/migrations/*{.ts,.js}'],
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        redis: {
          host: cs.get<string>('redis.host') ?? 'localhost',
          port: cs.get<number>('redis.port') ?? 6379,
          password: cs.get<string>('redis.password'),
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    CliModule,
  ],
})
class CliAppModule {}

const COMMANDS: (new (...args: any[]) => CliCommand)[] = [
  ListUsersCommand,
  SuspendUserCommand,
  ExportUserDataCommand,
  ModerateSignalCommand,
  FlagSignalCommand,
  ClearCacheCommand,
  MigrateDataCommand,
  ReindexSearchCommand,
  GenerateReportCommand,
];

async function bootstrap() {
  const [, , commandName, ...args] = process.argv;

  if (!commandName || commandName === '--help') {
    printHelp();
    process.exit(0);
  }

  const app = await NestFactory.createApplicationContext(CliAppModule, {
    logger: ['error', 'warn'],
  });

  const commandClass = COMMANDS.find((C) => {
    const instance = app.get(C, { strict: false });
    return instance?.name === commandName;
  });

  if (!commandClass) {
    console.error(`Unknown command: "${commandName}". Run with --help to see available commands.`);
    await app.close();
    process.exit(1);
  }

  const command = app.get<CliCommand>(commandClass);

  try {
    await command.run(args);
  } catch (err) {
    console.error(`Command failed: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    await app.close();
  }
}

function printHelp() {
  console.log('\nStellarSwipe Admin CLI\n');
  console.log('Usage: stellar-admin <command> [options]\n');
  console.log('Commands:');
  const descriptions: [string, string][] = [
    ['users:list', 'List users (--active, --search=<term>, --limit=<n>)'],
    ['users:suspend', 'Suspend/unsuspend a user (<userId> [--unsuspend] [--reason=<text>])'],
    ['users:export', 'Export user data to JSON (--output=<file>, --active)'],
    ['signals:moderate', 'List active signals (--provider=<id>, --limit=<n>)'],
    ['signals:flag', 'Flag or remove a signal (<signalId> [--remove] [--reason=<text>])'],
    ['maintenance:clear-cache', 'Clear cache (--key=<key> or all)'],
    ['maintenance:migrate', 'Run DB migrations (--revert)'],
    ['maintenance:reindex', 'Reindex search data (--entity=signals|users)'],
    ['analytics:report', 'Generate analytics report (--output=<file>, --from=<date>, --to=<date>)'],
  ];
  descriptions.forEach(([cmd, desc]) => console.log(`  ${cmd.padEnd(30)} ${desc}`));
  console.log('');
}

bootstrap();
