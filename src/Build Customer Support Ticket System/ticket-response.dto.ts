import { Exclude, Expose, Type } from 'class-transformer';
import {
  TicketStatus,
  TicketPriority,
  TicketCategory,
  TicketNote,
  SupportTicket,
} from '../entities/support-ticket.entity';

@Exclude()
export class TicketNoteResponseDto {
  @Expose() id: string;
  @Expose() content: string;
  @Expose() authorId: string;
  @Expose() authorName: string;
  @Expose() isInternal: boolean;
  @Expose() createdAt: Date;
}

@Exclude()
export class TicketResponseDto {
  @Expose() id: string;
  @Expose() ticketNumber: string;
  @Expose() subject: string;
  @Expose() description: string;
  @Expose() status: TicketStatus;
  @Expose() priority: TicketPriority;
  @Expose() category: TicketCategory;

  @Expose() customerId: string;
  @Expose() customerEmail: string;
  @Expose() customerName: string;

  @Expose() assignedAgentId?: string;
  @Expose() assignedAgentName?: string;

  @Expose()
  @Type(() => TicketNoteResponseDto)
  notes: TicketNote[];

  @Expose() tags: string[];

  @Expose() autoResponseSent: boolean;
  @Expose() autoResponseMessage?: string;

  @Expose() slaHours: number;
  @Expose() slaDeadline: Date;
  @Expose() slaBreached: boolean;

  @Expose() resolvedAt?: Date;
  @Expose() closedAt?: Date;
  @Expose() firstResponseAt?: Date;

  @Expose() createdAt: Date;
  @Expose() updatedAt: Date;

  constructor(partial: Partial<TicketResponseDto>) {
    Object.assign(this, partial);
  }
}

export class AgentDashboardResponseDto {
  totalOpen: number;
  totalInProgress: number;
  totalPendingCustomer: number;
  totalResolved: number;
  totalClosed: number;
  slaBreached: number;
  criticalTickets: number;
  myAssignedTickets: number;
  unassignedTickets: number;
  recentTickets: TicketResponseDto[];
  slaBreachedTickets: TicketResponseDto[];
}

export class PaginatedTicketsResponseDto {
  data: TicketResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
