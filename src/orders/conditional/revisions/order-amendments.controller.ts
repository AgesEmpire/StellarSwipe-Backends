import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { UpdateConditionalOrderDto } from '../dto/create-conditional-order.dto';
import { ConditionalOrderRevision } from './conditional-order-revision.entity';
import { AmendOrderResult, OrderAmendmentService, OrderStateAtRevision } from './order-amendment.service';

interface AuthedRequest {
  user?: { id?: string; sub?: string; roles?: string[] };
}

function actorFrom(req: AuthedRequest) {
  return { id: String(req.user?.id ?? req.user?.sub ?? ''), roles: req.user?.roles };
}

/**
 * Amendment + revision-history endpoints for conditional orders (#1529).
 * PATCH /orders/conditional/:id is routed through the same amendment path.
 */
@ApiTags('Conditional Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders/conditional')
export class OrderAmendmentsController {
  constructor(private readonly amendments: OrderAmendmentService) {}

  @Post(':id/amendments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Amend a conditional order and record a revision',
    description:
      'Requires a reason. Rejected amendments (wrong status, stale expectedVersion, no effective change) return an error and create no revision.',
  })
  @ApiParam({ name: 'id', description: 'Conditional order UUID' })
  amend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConditionalOrderDto,
    @Req() req: AuthedRequest,
  ): Promise<AmendOrderResult> {
    return this.amendments.amend(id, dto, actorFrom(req));
  }

  @Get(':id/revisions')
  @ApiOperation({ summary: 'List accepted amendments of an order, oldest first (timestamps are UTC ISO 8601)' })
  listRevisions(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<ConditionalOrderRevision[]> {
    return this.amendments.listRevisions(id, actorFrom(req));
  }

  @Get(':id/revisions/:revision')
  @ApiOperation({ summary: 'Reconstruct the order values as of a revision (0 = as created)' })
  getRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revision', ParseIntPipe) revision: number,
    @Req() req: AuthedRequest,
  ): Promise<OrderStateAtRevision> {
    return this.amendments.getStateAtRevision(id, revision, actorFrom(req));
  }
}
