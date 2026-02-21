import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  SupportTicket,
  TicketStatus,
  TicketPriority,
  TicketCategory,
  TicketNote,
  SLA_HOURS,
  AUTO_RESPONSES,
} from './entities/support-ticket.entity';
import {
  CreateTicketDto,
  UpdateTicketDto,
  AddNoteDto,
  FilterTicketsDto,
} from './dto/create-ticket.dto';
import {
  TicketResponseDto,
  AgentDashboardResponseDto,
  PaginatedTicketsResponseDto,
} from './dto/ticket-response.dto';

@Injectable()
export class TicketService {
  // In-memory store — swap for a real DB repository as needed
  private tickets: Map<string, SupportTicket> = new Map();
  private ticketCounter = 1;

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  private generateTicketNumber(): string {
    const num = String(this.ticketCounter++).padStart(6, '0');
    return `TKT-${num}`;
  }

  private computeSlaDeadline(priority: TicketPriority, from: Date): Date {
    const hours = SLA_HOURS[priority];
    return new Date(from.getTime() + hours * 60 * 60 * 1000);
  }

  private checkSlaBreached(ticket: SupportTicket): boolean {
    if ([TicketStatus.RESOLVED, TicketStatus.CLOSED].includes(ticket.status)) {
      return false;
    }
    return new Date() > ticket.slaDeadline;
  }

  private toDto(ticket: SupportTicket): TicketResponseDto {
    ticket.slaBreached = this.checkSlaBreached(ticket);
    return new TicketResponseDto(ticket as any);
  }

  private findOrFail(id: string): SupportTicket {
    const ticket = this.tickets.get(id);
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  create(dto: CreateTicketDto): TicketResponseDto {
    const now = new Date();
    const priority = dto.priority ?? TicketPriority.MEDIUM;
    const autoMessage = AUTO_RESPONSES[dto.category];

    const ticket: SupportTicket = {
      id: uuidv4(),
      ticketNumber: this.generateTicketNumber(),
      subject: dto.subject,
      description: dto.description,
      status: TicketStatus.OPEN,
      priority,
      category: dto.category,
      customerId: dto.customerId,
      customerEmail: dto.customerEmail,
      customerName: dto.customerName,
      notes: [],
      tags: dto.tags ?? [],
      autoResponseSent: true,
      autoResponseMessage: autoMessage,
      slaHours: SLA_HOURS[priority],
      slaDeadline: this.computeSlaDeadline(priority, now),
      slaBreached: false,
      createdAt: now,
      updatedAt: now,
    };

    this.tickets.set(ticket.id, ticket);
    return this.toDto(ticket);
  }

  findAll(filter: FilterTicketsDto): PaginatedTicketsResponseDto {
    let results = Array.from(this.tickets.values());

    if (filter.category) results = results.filter(t => t.category === filter.category);
    if (filter.priority) results = results.filter(t => t.priority === filter.priority);
    if (filter.assignedAgentId) results = results.filter(t => t.assignedAgentId === filter.assignedAgentId);
    if (filter.customerId) results = results.filter(t => t.customerId === filter.customerId);
    if (filter.slaBreached !== undefined) results = results.filter(t => this.checkSlaBreached(t) === filter.slaBreached);

    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const page = Number(filter.page ?? 1);
    const limit = Number(filter.limit ?? 20);
    const total = results.length;
    const sliced = results.slice((page - 1) * limit, page * limit);

    return {
      data: sliced.map(t => this.toDto(t)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  findOne(id: string): TicketResponseDto {
    return this.toDto(this.findOrFail(id));
  }

  updateTicket(id: string, dto: UpdateTicketDto): TicketResponseDto {
    const ticket = this.findOrFail(id);

    if (dto.priority && dto.priority !== ticket.priority) {
      ticket.priority = dto.priority;
      ticket.slaHours = SLA_HOURS[dto.priority];
      ticket.slaDeadline = this.computeSlaDeadline(dto.priority, ticket.createdAt);
    }

    if (dto.category) ticket.category = dto.category;
    if (dto.assignedAgentId !== undefined) ticket.assignedAgentId = dto.assignedAgentId;
    if (dto.assignedAgentName !== undefined) ticket.assignedAgentName = dto.assignedAgentName;
    if (dto.tags) ticket.tags = dto.tags;

    ticket.updatedAt = new Date();
    return this.toDto(ticket);
  }

  changeStatus(id: string, status: TicketStatus): TicketResponseDto {
    const ticket = this.findOrFail(id);
    const now = new Date();

    const allowedTransitions: Record<TicketStatus, TicketStatus[]> = {
      [TicketStatus.OPEN]: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
      [TicketStatus.IN_PROGRESS]: [TicketStatus.PENDING_CUSTOMER, TicketStatus.RESOLVED],
      [TicketStatus.PENDING_CUSTOMER]: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
      [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS],
      [TicketStatus.CLOSED]: [],
    };

    if (!allowedTransitions[ticket.status].includes(status)) {
      throw new BadRequestException(
        `Cannot transition from ${ticket.status} to ${status}`,
      );
    }

    ticket.status = status;
    if (status === TicketStatus.RESOLVED) ticket.resolvedAt = now;
    if (status === TicketStatus.CLOSED) ticket.closedAt = now;
    ticket.updatedAt = now;

    return this.toDto(ticket);
  }

  addNote(id: string, dto: AddNoteDto): TicketResponseDto {
    const ticket = this.findOrFail(id);
    const now = new Date();

    const note: TicketNote = {
      id: uuidv4(),
      content: dto.content,
      authorId: dto.authorId,
      authorName: dto.authorName,
      isInternal: dto.isInternal ?? false,
      createdAt: now,
    };

    ticket.notes.push(note);

    if (!ticket.firstResponseAt && !dto.isInternal) {
      ticket.firstResponseAt = now;
      // Move from OPEN → IN_PROGRESS on first agent response
      if (ticket.status === TicketStatus.OPEN) {
        ticket.status = TicketStatus.IN_PROGRESS;
      }
    }

    ticket.updatedAt = now;
    return this.toDto(ticket);
  }

  assignAgent(id: string, agentId: string, agentName: string): TicketResponseDto {
    const ticket = this.findOrFail(id);
    ticket.assignedAgentId = agentId;
    ticket.assignedAgentName = agentName;
    ticket.updatedAt = new Date();
    return this.toDto(ticket);
  }

  getAgentDashboard(agentId?: string): AgentDashboardResponseDto {
    const all = Array.from(this.tickets.values());

    const countByStatus = (s: TicketStatus) => all.filter(t => t.status === s).length;

    const breached = all.filter(t => this.checkSlaBreached(t));
    const critical = all.filter(t => t.priority === TicketPriority.CRITICAL && t.status !== TicketStatus.CLOSED);

    const recent = [...all]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10);

    return {
      totalOpen: countByStatus(TicketStatus.OPEN),
      totalInProgress: countByStatus(TicketStatus.IN_PROGRESS),
      totalPendingCustomer: countByStatus(TicketStatus.PENDING_CUSTOMER),
      totalResolved: countByStatus(TicketStatus.RESOLVED),
      totalClosed: countByStatus(TicketStatus.CLOSED),
      slaBreached: breached.length,
      criticalTickets: critical.length,
      myAssignedTickets: agentId ? all.filter(t => t.assignedAgentId === agentId).length : 0,
      unassignedTickets: all.filter(t => !t.assignedAgentId && t.status !== TicketStatus.CLOSED).length,
      recentTickets: recent.map(t => this.toDto(t)),
      slaBreachedTickets: breached.map(t => this.toDto(t)),
    };
  }
}
