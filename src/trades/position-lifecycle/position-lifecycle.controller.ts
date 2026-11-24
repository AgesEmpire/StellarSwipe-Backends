import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PositionLifecycleEventType } from './position-lifecycle-event.entity';
import { LifecycleEventView, PositionLifecycleService, PositionTimelineView } from './position-lifecycle.service';

const TIMEZONE_NOTE =
  'All timestamps are absolute instants serialized as ISO 8601 in UTC with a "Z" suffix and millisecond precision ' +
  '(e.g. 2026-11-23T12:00:00.000Z). occurredAt is when the transition happened; recordedAt is when it was persisted. ' +
  'Query bounds accept any ISO 8601 offset and are converted to UTC. Events flagged inferred=true were back-filled ' +
  'for positions opened before lifecycle tracking existed.';

interface AuthedRequest {
  user?: { id?: string; sub?: string; roles?: string[] };
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be an ISO 8601 date`);
  return d;
}

/** Historical position lifecycle timestamps (#1534). */
@ApiTags('portfolio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('portfolio/positions')
export class PositionLifecycleController {
  constructor(private readonly lifecycle: PositionLifecycleService) {}

  @Get('lifecycle')
  @ApiOperation({ summary: 'Position transitions for a user within [from, to)', description: TIMEZONE_NOTE })
  @ApiQuery({ name: 'userId', required: false, description: 'Defaults to the caller' })
  @ApiQuery({ name: 'from', required: false, description: 'Inclusive lower bound (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'Exclusive upper bound (ISO 8601)' })
  @ApiQuery({ name: 'types', required: false, description: `Comma-separated: ${Object.values(PositionLifecycleEventType).join(', ')}` })
  history(
    @Req() req: AuthedRequest,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('types') types?: string,
  ): Promise<LifecycleEventView[]> {
    const actor = { id: String(req.user?.id ?? req.user?.sub ?? ''), roles: req.user?.roles };
    const parsedTypes = types
      ? types.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;
    const valid = Object.values(PositionLifecycleEventType) as string[];
    if (parsedTypes?.some((t) => !valid.includes(t))) {
      throw new BadRequestException(`types must be among: ${valid.join(', ')}`);
    }
    return this.lifecycle.listHistory(
      userId || actor.id,
      { from: parseDate(from, 'from'), to: parseDate(to, 'to'), types: parsedTypes as PositionLifecycleEventType[] },
      actor,
    );
  }

  @Get(':positionId/lifecycle')
  @ApiOperation({ summary: 'Full lifecycle timeline of one position, grouped into open/close cycles', description: TIMEZONE_NOTE })
  timeline(
    @Param('positionId', ParseUUIDPipe) positionId: string,
    @Req() req: AuthedRequest,
  ): Promise<PositionTimelineView> {
    return this.lifecycle.getTimeline(positionId, {
      id: String(req.user?.id ?? req.user?.sub ?? ''),
      roles: req.user?.roles,
    });
  }
}
