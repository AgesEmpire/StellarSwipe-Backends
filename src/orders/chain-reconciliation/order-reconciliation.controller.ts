import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OPERATOR_ROLES } from '../../authorization/utils/assert-ownership.util';
import { PendingOrderReconciliationService } from './pending-order-reconciliation.service';
import { ReconciliationReviewStatus } from './order-reconciliation.entity';

export class RunReconciliationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minAgeMs?: number;
}

export class ResolveReconciliationReviewDto {
  @IsIn(['confirm', 'fail', 'dismiss'])
  decision!: 'confirm' | 'fail' | 'dismiss';

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}

interface AuthedRequest {
  user?: { id?: string; sub?: string; roles?: string[] };
}

function requireOperator(req: AuthedRequest): string {
  const roles = req.user?.roles ?? [];
  const id = String(req.user?.id ?? req.user?.sub ?? '');
  if (!id || !roles.some((r) => OPERATOR_ROLES.includes(r))) {
    throw new ForbiddenException('Operator role required');
  }
  return id;
}

/** Operator endpoints for pending-order chain reconciliation (#1531). */
@ApiTags('Order Reconciliation (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/orders/reconciliation')
export class OrderReconciliationController {
  constructor(private readonly reconciliation: PendingOrderReconciliationService) {}

  @Post('runs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run reconciliation now (safe to rerun)' })
  run(@Body() dto: RunReconciliationDto, @Req() req: AuthedRequest) {
    requireOperator(req);
    return this.reconciliation.reconcile({ limit: dto?.limit, minAgeMs: dto?.minAgeMs });
  }

  @Get('reviews')
  @ApiOperation({ summary: 'Ambiguous or contradictory chain results awaiting an operator' })
  listReviews(@Req() req: AuthedRequest, @Query('status') status?: ReconciliationReviewStatus) {
    requireOperator(req);
    return this.reconciliation.listReviews(
      status === ReconciliationReviewStatus.RESOLVED ? ReconciliationReviewStatus.RESOLVED : ReconciliationReviewStatus.OPEN,
    );
  }

  @Post('reviews/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a review: confirm, fail, or dismiss (recorded as evidence)' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReconciliationReviewDto,
    @Req() req: AuthedRequest,
  ) {
    const actorId = requireOperator(req);
    return this.reconciliation.resolveReview(id, dto, actorId);
  }

  @Get('evidence/:tradeId')
  @ApiOperation({ summary: 'Immutable evidence of every reconciliation state change for an order' })
  evidence(@Param('tradeId', ParseUUIDPipe) tradeId: string, @Req() req: AuthedRequest) {
    requireOperator(req);
    return this.reconciliation.listEvidence(tradeId);
  }
}
