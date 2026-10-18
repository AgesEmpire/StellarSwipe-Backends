import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Req,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SignalIndexerService } from './indexers/signal-indexer.service';
import { ProviderIndexerService } from './indexers/provider-indexer.service';
import { ContentIndexerService } from './indexers/content-indexer.service';
import { SearchAnalyticsService } from './services/search-analytics.service';
import { BulkIndexResult } from './utils/bulk-index-result.util';
import {
  SearchQueryDto,
  AutocompleteQueryDto,
} from './dto/search-query.dto';
import {
  SearchResultDto,
  AutocompleteResultDto,
} from './dto/search-result.dto';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly signalIndexerService: SignalIndexerService,
    private readonly providerIndexerService: ProviderIndexerService,
    private readonly contentIndexerService: ContentIndexerService,
    private readonly searchAnalyticsService: SearchAnalyticsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Search across signals, providers, and content' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Search results',
    type: SearchResultDto,
  })
  async search(
    @Body() searchQuery: SearchQueryDto,
    @Req() req?: any,
  ): Promise<SearchResultDto> {
    const userId = req?.user?.id || null;
    return this.searchService.search(searchQuery, userId);
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Get autocomplete suggestions' })
  @ApiQuery({ name: 'prefix', type: String, example: 'bull' })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 5 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Autocomplete suggestions',
    type: AutocompleteResultDto,
  })
  async autocomplete(
    @Query() query: AutocompleteQueryDto,
  ): Promise<AutocompleteResultDto> {
    return this.searchService.autocomplete(query);
  }

  @Post('reindex/signals')
  @ApiOperation({ summary: 'Reindex all signals' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Per-document signal reindex outcome (partial failures are reported, not swallowed)',
  })
  async reindexSignals(): Promise<{ message: string } & BulkIndexResult> {
    const result = await this.signalIndexerService.reindexAll();
    return { message: this.describeReindexOutcome(result), ...result };
  }

  @Post('reindex/providers')
  @ApiOperation({ summary: 'Reindex all providers' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Per-document provider reindex outcome (partial failures are reported, not swallowed)',
  })
  async reindexProviders(): Promise<{ message: string } & BulkIndexResult> {
    const result = await this.providerIndexerService.reindexAll();
    return { message: this.describeReindexOutcome(result), ...result };
  }

  @Post('reindex/content')
  @ApiOperation({ summary: 'Reindex all content' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Per-document content reindex outcome (partial failures are reported, not swallowed)',
  })
  async reindexContent(): Promise<{ message: string } & BulkIndexResult> {
    const result = await this.contentIndexerService.reindexAll();
    return { message: this.describeReindexOutcome(result), ...result };
  }

  private describeReindexOutcome(result: BulkIndexResult): string {
    if (result.failed.length === 0) {
      return `Reindexed ${result.succeeded.length}/${result.total} document(s) successfully`;
    }
    return `Reindexed ${result.succeeded.length}/${result.total} document(s); ${result.failed.length} failed`;
  }

  @Get('analytics/popular')
  @ApiOperation({ summary: 'Get popular search queries' })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Popular search queries',
  })
  async getPopularQueries(
    @Query('limit') limit = 10,
  ): Promise<{ queries: any[] }> {
    const queries = await this.searchAnalyticsService.getPopularQueries(limit);
    return { queries };
  }

  @Get('analytics/failed')
  @ApiOperation({ summary: 'Get failed search queries (zero results)' })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Failed search queries',
  })
  async getFailedQueries(
    @Query('limit') limit = 10,
  ): Promise<{ queries: any[] }> {
    const queries = await this.searchAnalyticsService.getFailedQueries(limit);
    return { queries };
  }

  @Get('analytics/summary')
  @ApiOperation({ summary: 'Get search analytics summary' })
  @ApiQuery({ name: 'startDate', type: String, example: '2026-01-01' })
  @ApiQuery({ name: 'endDate', type: String, example: '2026-01-31' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Search analytics summary',
  })
  async getSearchAnalytics(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<any> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return this.searchAnalyticsService.getSearchAnalytics(start, end);
  }
}
