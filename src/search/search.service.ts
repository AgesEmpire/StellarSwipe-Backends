import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchConfigService } from './services/elasticsearch.service';
import { SearchAnalyticsService } from './services/search-analytics.service';
import {
  SearchQueryDto,
  SearchSortType,
  AutocompleteQueryDto,
} from './dto/search-query.dto';
import {
  SearchResultDto,
  SearchResultItem,
  SearchResultType,
  AutocompleteResultDto,
  SearchFacetBucket,
} from './dto/search-result.dto';
import { validateSearchFilters } from './utils/search-filter-validator';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly elasticsearchService: ElasticsearchConfigService,
    private readonly searchAnalyticsService: SearchAnalyticsService,
  ) {}

  async search(
    searchQuery: SearchQueryDto,
    userId: string | null = null,
  ): Promise<SearchResultDto> {
    const startTime = Date.now();

    try {
      const esQuery = this.buildElasticsearchQuery(searchQuery);
      const result = await this.elasticsearchService.search({
        index: ['signals', 'providers', 'content'],
        body: esQuery,
        from: (searchQuery.page - 1) * searchQuery.limit,
        size: searchQuery.limit,
      });

      const took = Date.now() - startTime;
      const total = result.hits.total.value || 0;

      await this.searchAnalyticsService.trackSearchQuery(
        searchQuery.query,
        userId,
        total,
        took,
      );

      return this.mapElasticsearchResponse(result, searchQuery, took);
    } catch (error) {
      this.logger.error('Search failed', error);
      throw error;
    }
  }

  async autocomplete(query: AutocompleteQueryDto): Promise<AutocompleteResultDto> {
    try {
      const result = await this.elasticsearchService.search({
        index: ['signals', 'providers', 'content'],
        body: {
          suggest: {
            signal_suggest: {
              prefix: query.prefix,
              completion: {
                field: 'suggest',
                size: query.limit,
                skip_duplicates: true,
              },
            },
          },
        },
      });

      const suggestions = this.extractAutocompleteSuggestions(result);
      return { suggestions };
    } catch (error) {
      this.logger.error('Autocomplete failed', error);
      return { suggestions: [] };
    }
  }

  private buildElasticsearchQuery(searchQuery: SearchQueryDto): any {
    const query: any = {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: searchQuery.query,
                fields: [
                  'rationale^3',
                  'title^3',
                  'assetPair^2',
                  'providerName^2',
                  'body',
                  'bio',
                  'username',
                  'displayName',
                ],
                fuzziness: 'AUTO',
                operator: 'or',
              },
            },
          ],
          filter: [],
        },
      },
      highlight: {
        fields: {
          rationale: {},
          title: {},
          body: {},
          bio: {},
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
      aggs: {
        assetPair: {
          terms: { field: 'assetPair', size: 20 },
        },
        action: {
          terms: { field: 'action', size: 10 },
        },
        contentType: {
          terms: { field: 'type', size: 10 },
        },
      },
    };

    const filters = validateSearchFilters(searchQuery.filters);

    if (filters) {
      if (filters.assetPair && filters.assetPair.length > 0) {
        query.query.bool.filter.push({
          terms: { assetPair: filters.assetPair },
        });
      }

      if (filters.action && filters.action.length > 0) {
        query.query.bool.filter.push({
          terms: { action: filters.action },
        });
      }

      if (filters.providerId && filters.providerId.length > 0) {
        query.query.bool.filter.push({
          terms: { providerId: filters.providerId },
        });
      }

      if (filters.dateRange) {
        query.query.bool.filter.push({
          range: {
            createdAt: {
              gte: filters.dateRange.from,
              lte: filters.dateRange.to,
            },
          },
        });
      }

      if (filters.minWinRate !== undefined) {
        query.query.bool.filter.push({
          range: {
            winRate: {
              gte: filters.minWinRate,
            },
          },
        });
      }
    }

    if (searchQuery.sort) {
      query.sort = this.buildSortQuery(searchQuery.sort);
    }

    return query;
  }

  private buildSortQuery(sortType: SearchSortType): any[] {
    switch (sortType) {
      case SearchSortType.RECENT:
        return [{ createdAt: { order: 'desc' } }, '_score'];
      case SearchSortType.WIN_RATE:
        return [{ winRate: { order: 'desc' } }, '_score'];
      case SearchSortType.RELEVANCE:
      default:
        return ['_score', { createdAt: { order: 'desc' } }];
    }
  }

  private mapElasticsearchResponse(
    result: any,
    searchQuery: SearchQueryDto,
    took: number,
  ): SearchResultDto {
    const results: SearchResultItem[] = result.hits.hits.map((hit: any) => {
      const type = this.determineResultType(hit._index);
      return {
        type,
        id: hit._source.id,
        assetPair: hit._source.assetPair,
        action: hit._source.action,
        rationale: hit._source.rationale,
        provider: hit._source.providerName,
        providerId: hit._source.providerId,
        name: hit._source.displayName || hit._source.username,
        bio: hit._source.bio,
        title: hit._source.title,
        body: hit._source.body,
        entryPrice: hit._source.entryPrice,
        winRate: hit._source.winRate,
        score: hit._score,
        createdAt: hit._source.createdAt,
        highlights: {
          rationale: hit.highlight?.rationale,
          title: hit.highlight?.title,
          body: hit.highlight?.body,
          bio: hit.highlight?.bio,
        },
      };
    });

    const facets = {
      assetPair: this.mapAggregationBuckets(result.aggregations?.assetPair),
      action: this.mapAggregationBuckets(result.aggregations?.action),
      contentType: this.mapAggregationBuckets(result.aggregations?.contentType),
    };

    return {
      query: searchQuery.query,
      total: result.hits.total.value || 0,
      results,
      facets,
      suggestions: [],
      page: searchQuery.page,
      limit: searchQuery.limit,
      took,
    };
  }

  private determineResultType(indexName: string): SearchResultType {
    if (indexName.includes('signal')) {
      return SearchResultType.SIGNAL;
    } else if (indexName.includes('provider')) {
      return SearchResultType.PROVIDER;
    } else {
      return SearchResultType.CONTENT;
    }
  }

  private mapAggregationBuckets(aggregation: any): SearchFacetBucket[] {
    if (!aggregation || !aggregation.buckets) {
      return [];
    }

    return aggregation.buckets.map((bucket: any) => ({
      key: bucket.key,
      count: bucket.doc_count,
    }));
  }

  private extractAutocompleteSuggestions(result: any): string[] {
    const suggestions = new Set<string>();

    if (result.suggest?.signal_suggest?.[0]?.options) {
      result.suggest.signal_suggest[0].options.forEach((option: any) => {
        suggestions.add(option.text);
      });
    }

    return Array.from(suggestions);
  }
}
