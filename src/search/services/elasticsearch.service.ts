import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService as NestElasticsearchService } from '@nestjs/elasticsearch';
import { Client } from '@elastic/elasticsearch';
import {
  SIGNALS_INDEX_MAPPING,
  PROVIDERS_INDEX_MAPPING,
  CONTENT_INDEX_MAPPING,
} from './elasticsearch-mappings.constants';

export { IndexMapping } from './index-mapping.interface';

@Injectable()
export class ElasticsearchConfigService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchConfigService.name);
  private client: Client;

  constructor(
    private readonly elasticsearchService: NestElasticsearchService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.client = this.elasticsearchService as unknown as Client;
    await this.initializeIndices();
  }

  private async initializeIndices() {
    try {
      await this.createSignalsIndex();
      await this.createProvidersIndex();
      await this.createContentIndex();
      this.logger.log('Elasticsearch indices initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Elasticsearch indices', error);
    }
  }

  private async createSignalsIndex() {
    const indexName = 'signals';
    const exists = await this.client.indices.exists({ index: indexName });

    if (!exists) {
      await this.client.indices.create({
        index: indexName,
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 1,
            analysis: {
              analyzer: {
                english_analyzer: {
                  type: 'english',
                },
              },
            },
          },
          mappings: SIGNALS_INDEX_MAPPING,
        },
      });
      this.logger.log(`Created index: ${indexName}`);
    }
  }

  private async createProvidersIndex() {
    const indexName = 'providers';
    const exists = await this.client.indices.exists({ index: indexName });

    if (!exists) {
      await this.client.indices.create({
        index: indexName,
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 1,
          },
          mappings: PROVIDERS_INDEX_MAPPING,
        },
      });
      this.logger.log(`Created index: ${indexName}`);
    }
  }

  private async createContentIndex() {
    const indexName = 'content';
    const exists = await this.client.indices.exists({ index: indexName });

    if (!exists) {
      await this.client.indices.create({
        index: indexName,
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 1,
          },
          mappings: CONTENT_INDEX_MAPPING,
        },
      });
      this.logger.log(`Created index: ${indexName}`);
    }
  }

  async search(params: any) {
    return this.client.search(params);
  }

  async index(params: any) {
    return this.client.index(params);
  }

  async bulk(params: any) {
    return this.client.bulk(params);
  }

  async delete(params: any) {
    return this.client.delete(params);
  }

  async update(params: any) {
    return this.client.update(params);
  }

  getClient(): Client {
    return this.client;
  }
}
