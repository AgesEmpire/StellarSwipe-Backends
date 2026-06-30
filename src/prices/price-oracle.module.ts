import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PriceOracleService } from './price-oracle.service';
import { PriceOracleController } from './price-oracle.controller';
import { PriceHistory } from './entities/price-history.entity';
import { SdexPriceProvider } from './providers/sdex-price.provider';
import { CoinGeckoPriceProvider } from './providers/coingecko-price.provider';
import { StellarExpertPriceProvider } from './providers/stellar-expert-price.provider';
import {
  PRICE_ORACLE_OPTIONS,
  PRICE_ORACLE_PROVIDER,
  PriceOracleModuleAsyncOptions,
  PriceOracleModuleOptions,
  PriceOracleProvider,
  PriceOracleStrategy,
} from './interfaces/price-oracle-provider.interface';

/**
 * Maps a configured strategy to its concrete provider implementation.
 * Register new strategies here only - consumers stay untouched.
 */
const STRATEGY_PROVIDERS: Record<
  PriceOracleStrategy,
  Type<PriceOracleProvider>
> = {
  [PriceOracleStrategy.SDEX]: SdexPriceProvider,
  [PriceOracleStrategy.COINGECKO]: CoinGeckoPriceProvider,
  [PriceOracleStrategy.STELLAR_EXPERT]: StellarExpertPriceProvider,
};

function resolveStrategyProvider(
  strategy: PriceOracleStrategy,
): Type<PriceOracleProvider> {
  const provider = STRATEGY_PROVIDERS[strategy];
  if (!provider) {
    throw new Error(`Unknown price oracle strategy: ${strategy}`);
  }
  return provider;
}

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceHistory]),
    HttpModule,
    CacheModule.register({
      ttl: 60000, // 60 seconds
      max: 100,
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
  ],
  controllers: [PriceOracleController],
  providers: [
    PriceOracleService,
    SdexPriceProvider,
    CoinGeckoPriceProvider,
    StellarExpertPriceProvider,
  ],
  exports: [PriceOracleService],
})
export class PriceOracleModule {
  /**
   * Register the module with a statically configured oracle strategy.
   * Consumers inject `PRICE_ORACLE_PROVIDER`; switching the active
   * implementation is a single config change here.
   */
  static forRoot(options: PriceOracleModuleOptions): DynamicModule {
    const strategyProvider: Provider = {
      provide: PRICE_ORACLE_PROVIDER,
      useExisting: resolveStrategyProvider(options.strategy),
    };

    return {
      module: PriceOracleModule,
      providers: [strategyProvider],
      exports: [PRICE_ORACLE_PROVIDER],
    };
  }

  /**
   * Register the module with an asynchronously resolved strategy
   * (e.g. read from ConfigService at runtime).
   */
  static forRootAsync(options: PriceOracleModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: PRICE_ORACLE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    const strategyProvider: Provider = {
      provide: PRICE_ORACLE_PROVIDER,
      useFactory: (
        opts: PriceOracleModuleOptions,
        sdex: SdexPriceProvider,
        coingecko: CoinGeckoPriceProvider,
        stellarExpert: StellarExpertPriceProvider,
      ): PriceOracleProvider => {
        const instances: Record<PriceOracleStrategy, PriceOracleProvider> = {
          [PriceOracleStrategy.SDEX]: sdex,
          [PriceOracleStrategy.COINGECKO]: coingecko,
          [PriceOracleStrategy.STELLAR_EXPERT]: stellarExpert,
        };
        // Validate the strategy then return the matching instance.
        resolveStrategyProvider(opts.strategy);
        return instances[opts.strategy];
      },
      inject: [
        PRICE_ORACLE_OPTIONS,
        SdexPriceProvider,
        CoinGeckoPriceProvider,
        StellarExpertPriceProvider,
      ],
    };

    return {
      module: PriceOracleModule,
      imports: options.imports || [],
      providers: [optionsProvider, strategyProvider],
      exports: [PRICE_ORACLE_PROVIDER],
    };
  }
}
