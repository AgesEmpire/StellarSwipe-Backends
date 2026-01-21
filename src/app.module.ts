import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { stellarConfig } from './config/stellar.config';
import { databaseConfig, redisConfig } from './config/database.config';
import { appConfig } from './config/app.config';
import { StellarConfigService } from './config/stellar.service';
import { BetaModule } from './beta/beta.module';
import { TradesModule } from './trades/trades.module';

@Module({
  imports: [
    // Configuration Module - loads environment variables
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, stellarConfig, databaseConfig, redisConfig],
      envFilePath: '.env',
      cache: true,
    }),
    // Database Module
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.database'),
        synchronize: configService.get<boolean>('database.synchronize'),
        logging: configService.get<boolean>('database.logging'),
        entities: ['dist/**/*.entity{.ts,.js}'],
        migrations: ['dist/migrations/*{.ts,.js}'],
        subscribers: ['dist/subscribers/*{.ts,.js}'],
        ssl: configService.get<boolean>('database.ssl'),
      }),
    }),
    // Feature Modules
    BetaModule,
    TradesModule,
  ],
  providers: [StellarConfigService],
  exports: [StellarConfigService],
})
export class AppModule {}
