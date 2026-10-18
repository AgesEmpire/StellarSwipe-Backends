import { BadRequestException } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchSortType } from './dto/search-query.dto';

describe('SearchService', () => {
  function buildService() {
    const elasticsearchService: any = {
      search: jest.fn().mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {},
      }),
    };
    const searchAnalyticsService: any = {
      trackSearchQuery: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SearchService(elasticsearchService, searchAnalyticsService);
    return { service, elasticsearchService };
  }

  it('rejects an unsupported filter field before querying Elasticsearch', async () => {
    const { service, elasticsearchService } = buildService();

    await expect(
      service.search({
        query: 'bullish',
        filters: { unsupportedField: ['x'] } as any,
        page: 1,
        limit: 20,
        sort: SearchSortType.RELEVANCE,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(elasticsearchService.search).not.toHaveBeenCalled();
  });

  it('builds and executes a query for valid filters', async () => {
    const { service, elasticsearchService } = buildService();

    const result = await service.search({
      query: 'bullish',
      filters: { assetPair: ['USDC/XLM'] },
      page: 1,
      limit: 20,
      sort: SearchSortType.RELEVANCE,
    });

    expect(elasticsearchService.search).toHaveBeenCalled();
    expect(result.total).toBe(0);
  });
});
