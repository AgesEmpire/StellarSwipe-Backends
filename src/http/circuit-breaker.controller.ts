import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CircuitBreakerService, CircuitState } from './circuit-breaker.service';
import { AdminRoleGuard } from '../admin/guards/admin-role.guard';

export interface CircuitStatusDto {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  lastStateChangeAt: string | null;
}

@ApiTags('Operations')
@ApiBearerAuth()
@UseGuards(AdminRoleGuard)
@Controller('admin/circuits')
export class CircuitBreakerController {
  constructor(private readonly circuitBreakerService: CircuitBreakerService) {}

  @Get()
  @ApiOperation({ summary: 'List all circuit breaker states (admin only)' })
  getCircuitStatuses(): CircuitStatusDto[] {
    const allStats = this.circuitBreakerService.getAllStats();
    return Object.entries(allStats).map(([name, stats]) => ({
      name,
      state: stats.state,
      failureCount: stats.failures,
      successCount: stats.successes,
      lastFailureAt: stats.lastFailureAt?.toISOString() ?? null,
      lastStateChangeAt: stats.openedAt?.toISOString() ?? null,
    }));
  }
}
