/**
 * TenantDataSourceFactory
 *
 * Lazily builds and caches one TypeORM `DataSource` per tenant schema,
 * cloning the application's default connection options and overriding the
 * `schema`. Connections are created on first use and reused for the lifetime
 * of the process so request-scoped consumers stay cheap.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

@Injectable()
export class TenantDataSourceFactory implements OnModuleDestroy {
  private readonly logger = new Logger(TenantDataSourceFactory.name);
  private readonly dataSources = new Map<string, DataSource>();

  constructor(
    @InjectDataSource()
    private readonly defaultDataSource: DataSource,
  ) {}

  /**
   * Returns an initialized DataSource bound to the given tenant schema,
   * creating and caching it on first use.
   */
  async getDataSource(schema: string): Promise<DataSource> {
    const existing = this.dataSources.get(schema);
    if (existing) {
      if (!existing.isInitialized) {
        await existing.initialize();
      }
      return existing;
    }

    const options = {
      ...this.defaultDataSource.options,
      name: `tenant_${schema}`,
      schema,
    } as DataSourceOptions;

    const dataSource = new DataSource(options);
    await dataSource.initialize();
    this.dataSources.set(schema, dataSource);
    this.logger.log(`Initialized tenant DataSource for schema "${schema}"`);

    return dataSource;
  }

  async onModuleDestroy(): Promise<void> {
    for (const dataSource of this.dataSources.values()) {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    }
    this.dataSources.clear();
  }
}
