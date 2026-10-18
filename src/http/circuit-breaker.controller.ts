import { Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  CircuitBreakerService,
  CircuitState,
  CircuitAuditEntry,
} from './circuit-breaker.service';
import { AdminRoleGuard } from '../admin/guards/admin-role.guard';

export interface CircuitStatusDto {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  lastStateChangeAt: string | null;
}

export interface CircuitAuditEntryDto {
  circuit: string;
  action: string;
  actor: string;
  at: string;
  previousState: CircuitState;
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

  /**
   * #1375 — Operator-triggered recovery: closes a circuit immediately
   * instead of waiting for the automatic half-open probe cycle, once the
   * guarded dependency has been confirmed restored. Restricted to admins
   * (AdminRoleGuard) and recorded in the in-memory audit trail with the
   * authenticated actor's id, so every manual override is attributable.
   */
  @Post(':name/reset')
  @ApiOperation({ summary: 'Manually reset a circuit breaker to CLOSED (admin only, audited)' })
  resetCircuit(@Param('name') name: string, @Req() req: any): { name: string; state: CircuitState } {
    const actor = req.user?.id ?? req.user?.email ?? 'unknown';
    this.circuitBreakerService.reset(name, actor);
    return { name, state: this.circuitBreakerService.getState(name) };
  }

  /** #1375 — Audit trail for manual circuit actions (admin only). */
  @Get('audit-log')
  @ApiOperation({ summary: 'List the audit trail of manual circuit breaker actions (admin only)' })
  getAuditLog(): CircuitAuditEntryDto[] {
    return this.circuitBreakerService.getAuditLog().map((entry: CircuitAuditEntry) => ({
      circuit: entry.circuit,
      action: entry.action,
      actor: entry.actor,
      at: entry.at.toISOString(),
      previousState: entry.previousState,
    }));
  }
}
