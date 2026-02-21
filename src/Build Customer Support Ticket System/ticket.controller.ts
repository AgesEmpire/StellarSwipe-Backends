import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TicketService } from './ticket.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  AddNoteDto,
  FilterTicketsDto,
} from './dto/create-ticket.dto';
import { TicketStatus } from './entities/support-ticket.entity';

@Controller('support/tickets')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  // ─── Customer endpoints ──────────────────────

  /** POST /support/tickets — Create a new support ticket */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTicketDto) {
    return this.ticketService.create(dto);
  }

  /** GET /support/tickets — List / filter tickets */
  @Get()
  findAll(@Query() filter: FilterTicketsDto) {
    return this.ticketService.findAll(filter);
  }

  /** GET /support/tickets/:id — Get single ticket */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ticketService.findOne(id);
  }

  // ─── Agent endpoints ─────────────────────────

  /** GET /support/tickets/dashboard/overview — Agent dashboard summary */
  @Get('dashboard/overview')
  getDashboard(@Query('agentId') agentId?: string) {
    return this.ticketService.getAgentDashboard(agentId);
  }

  /** PATCH /support/tickets/:id — Update ticket metadata (priority, category, tags) */
  @Patch(':id')
  updateTicket(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.ticketService.updateTicket(id, dto);
  }

  /** PATCH /support/tickets/:id/status — Change ticket status */
  @Patch(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body('status') status: TicketStatus,
  ) {
    return this.ticketService.changeStatus(id, status);
  }

  /** PATCH /support/tickets/:id/assign — Assign to an agent */
  @Patch(':id/assign')
  assignAgent(
    @Param('id') id: string,
    @Body('agentId') agentId: string,
    @Body('agentName') agentName: string,
  ) {
    return this.ticketService.assignAgent(id, agentId, agentName);
  }

  /** POST /support/tickets/:id/notes — Add a note / reply */
  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  addNote(@Param('id') id: string, @Body() dto: AddNoteDto) {
    return this.ticketService.addNote(id, dto);
  }
}
