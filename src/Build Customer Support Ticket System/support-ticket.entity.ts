export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  PENDING_CUSTOMER = 'pending_customer',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum TicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum TicketCategory {
  BILLING = 'billing',
  TECHNICAL = 'technical',
  ACCOUNT = 'account',
  GENERAL = 'general',
  BUG_REPORT = 'bug_report',
  FEATURE_REQUEST = 'feature_request',
}

export const SLA_HOURS: Record<TicketPriority, number> = {
  [TicketPriority.CRITICAL]: 1,
  [TicketPriority.HIGH]: 4,
  [TicketPriority.MEDIUM]: 24,
  [TicketPriority.LOW]: 72,
};

export const AUTO_RESPONSES: Record<TicketCategory, string> = {
  [TicketCategory.BILLING]:
    'Thank you for contacting billing support. We have received your request and will review your account within 24 hours. For urgent billing issues, please include your invoice number.',
  [TicketCategory.TECHNICAL]:
    'Thank you for reporting a technical issue. Our engineering team has been notified. Please include any error messages or screenshots to help us resolve your issue faster.',
  [TicketCategory.ACCOUNT]:
    'Thank you for reaching out about your account. For security purposes, please verify your identity when our agent contacts you.',
  [TicketCategory.GENERAL]:
    'Thank you for contacting support. We have received your message and will respond within our standard SLA window.',
  [TicketCategory.BUG_REPORT]:
    'Thank you for reporting this bug. Your report helps us improve our product. Our QA team will investigate and keep you updated on the fix progress.',
  [TicketCategory.FEATURE_REQUEST]:
    'Thank you for your feature suggestion! We review all requests and consider them for our product roadmap. We will update you if this feature is planned.',
};

export interface TicketNote {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  isInternal: boolean;
  createdAt: Date;
}

export class SupportTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;

  customerId: string;
  customerEmail: string;
  customerName: string;

  assignedAgentId?: string;
  assignedAgentName?: string;

  notes: TicketNote[];
  tags: string[];

  autoResponseSent: boolean;
  autoResponseMessage?: string;

  slaHours: number;
  slaDeadline: Date;
  slaBreached: boolean;

  resolvedAt?: Date;
  closedAt?: Date;
  firstResponseAt?: Date;

  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<SupportTicket>) {
    Object.assign(this, partial);
  }
}
