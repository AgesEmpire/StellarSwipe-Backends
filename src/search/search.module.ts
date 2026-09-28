import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ElasticsearchConfigService } from './services/elasticsearch.service';
import { SearchAnalyticsService } from './services/search-analytics.service';
import { SignalIndexerService } from './indexers/signal-indexer.service';
import { ProviderIndexerService } from './indexers/provider-indexer.service';
import { ContentIndexerService } from './indexers/content-indexer.service';
import { Signal } from '../signals/entities/signal.entity';
import { User } from '../users/entities/user.entity';
import { ProviderContent } from '../content/entities/provider-content.entity';
import {
  SearchQuery,
  SearchAnalytics,
} from './entities/search-analytics.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Signal,
      User,
      ProviderContent,
      SearchQuery,
      SearchAnalytics,
    ]),
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        node: configService.get<string>('ELASTICSEARCH_NODE', 'http://localhost:9200'),
        auth: {
          username: configService.get<string>('ELASTICSEARCH_USERNAME', 'elastic'),
          password: configService.get<string>('ELASTICSEARCH_PASSWORD', 'changeme'),
        },
        maxRetries: 3,
        requestTimeout: 60000,
        sniffOnStart: false,
      }),
      inject: [ConfigService],
    }),
    FeatureFlagsModule,
  ],
  controllers: [SearchController],
  providers: [
    SearchService,
    ElasticsearchConfigService,
    SearchAnalyticsService,
    SignalIndexerService,
    ProviderIndexerService,
    ContentIndexerService,
  ],
  exports: [
    SearchService,
    SignalIndexerService,
    ProviderIndexerService,
    ContentIndexerService,
    SearchAnalyticsService,
  ],
})
export class SearchModule {}
