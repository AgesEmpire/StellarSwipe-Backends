import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  Request,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OwnershipGuard } from '../common/guards/ownership.guard';
import { TradeHistoryService, PaginatedTradeHistoryDto } from './trade-history.service';
import { AuditService, AuditLogPage } from '../audit-log/audit.service';
import { AuditAction } from '../audit-log/entities/audit-log.entity';

class TradeHistoryQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'executing', 'confirmed', 'completed', 'failed', 'cancelled', 'all'] })
  @IsOptional()
  @IsEnum(['pending', 'executing', 'confirmed', 'completed', 'failed', 'cancelled', 'all'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

class AuditTrailQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

@ApiTags('Trade History & Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trades')
export class TradeAuditController {
  constructor(
    private readonly tradeHistoryService: TradeHistoryService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * GET /trades/user/:userId/history
   * Paginated trade history with optional status and date-range filters.
   * Users may only query their own history.
   */
  @Get('user/:userId/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get paginated trade history for a user' })
  @ApiOkResponse({ description: 'Paginated trade history' })
  async getHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: TradeHistoryQueryDto,
    @Request() req: any,
  ): Promise<PaginatedTradeHistoryDto> {
    this.assertSelf(req, userId);
    return this.tradeHistoryService.getUserTradeHistory({ userId, ...query });
  }

  /**
   * GET /trades/user/:userId/audit-trail
   * Backend audit trail for a user's trade activity — includes risk gate
   * decisions, contract call outcomes, and status transitions.
   * Users may only query their own trail.
   */
  @Get('user/:userId/audit-trail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get audit trail for a user\'s trade activity' })
  @ApiOkResponse({ description: 'Paginated audit log entries for trade actions' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getAuditTrail(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: AuditTrailQueryDto,
    @Request() req: any,
  ): Promise<AuditLogPage> {
    this.assertSelf(req, userId);
    return this.auditService.query({
      userId,
      action: AuditAction.TRADE_EXECUTED,
      page: query.page,
      limit: query.limit,
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  // ---------------------------------------------------------------------------

  private assertSelf(req: any, targetUserId: string): void {
    const requestingUserId: string = req.user?.id ?? req.user?.sub;
    const isOwner = requestingUserId === targetUserId;
    if (!isOwner) {
      throw new ForbiddenException('You may only access your own trade data');
    }
  }
}
