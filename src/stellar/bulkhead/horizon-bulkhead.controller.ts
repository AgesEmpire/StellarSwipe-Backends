import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HorizonBulkheadService } from './horizon-bulkhead.service';
import { BulkheadMetrics } from './bulkhead';

/**
 * Exposes per-category Horizon bulkhead metrics (queue depth, active count and
 * rejection totals) for observability dashboards / health scraping.
 */
@ApiTags('stellar')
@Controller('stellar/horizon/bulkhead')
export class HorizonBulkheadController {
  constructor(private readonly bulkhead: HorizonBulkheadService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Current Horizon bulkhead metrics per call category' })
  @ApiResponse({
    status: 200,
    description: 'Queue depth, active count and rejection totals per category',
  })
  getMetrics(): { categories: BulkheadMetrics[] } {
    return { categories: this.bulkhead.getAllMetrics() };
  }
}
