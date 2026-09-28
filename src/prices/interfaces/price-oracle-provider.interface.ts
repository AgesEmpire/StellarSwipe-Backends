import { PriceSourceResult } from '../dto/price-data.dto';

/**
 * Injection token used by consumers to obtain the active price oracle
 * provider, regardless of which strategy is configured.
 */
export const PRICE_ORACLE_PROVIDER = Symbol('PRICE_ORACLE_PROVIDER');

/**
 * Internal token holding the resolved module options.
 */
export const PRICE_ORACLE_OPTIONS = Symbol('PRICE_ORACLE_OPTIONS');

/**
 * Common contract every pluggable price oracle provider must satisfy.
 */
export interface PriceOracleProvider {
  getPrice(assetPair: string): Promise<PriceSourceResult>;
}

/**
 * Selectable oracle provider strategies. Adding a new strategy only
 * requires registering it in the module's strategy map.
 */
export enum PriceOracleStrategy {
  SDEX = 'sdex',
  COINGECKO = 'coingecko',
  STELLAR_EXPERT = 'stellar-expert',
}

export interface PriceOracleModuleOptions {
  strategy: PriceOracleStrategy;
}

export interface PriceOracleModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<PriceOracleModuleOptions> | PriceOracleModuleOptions;
}
