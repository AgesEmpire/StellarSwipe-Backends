import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { TicketService } from './ticket.service';
import {
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from './support-ticket.entity';

describe('TicketService search', () => {
  let service: TicketService;

  const createTicket = (customerId: string, subject: string) =>
    service.create({
      subject,
      description: 'This is a test ticket description.',
      category: TicketCategory.GENERAL,
      priority: TicketPriority.MEDIUM,
      customerId,
      customerEmail: `${customerId}@example.com`,
      customerName: customerId,
    });

  beforeEach(() => {
    service = new TicketService();
  });

  it('combines requester, status, and date filters for an authorized agent', () => {
    const target = createTicket('requester-1', 'Target ticket');
    createTicket('requester-1', 'Open ticket');
    createTicket('requester-2', 'Other requester');
    service.changeStatus(target.id, TicketStatus.IN_PROGRESS);

    const results = service.search(
      {
        requesterId: 'requester-1',
        status: TicketStatus.IN_PROGRESS,
        createdAfter: new Date(Date.now() - 60_000).toISOString(),
        createdBefore: new Date(Date.now() + 60_000).toISOString(),
      },
      { requesterId: 'agent-1', roles: ['support_agent'] },
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(target.id);
    expect(results[0]).not.toHaveProperty('customerEmail');
    expect(results[0]).not.toHaveProperty('description');
  });

  it('restricts requesters to their own tickets before applying search filters', () => {
    const ownTicket = createTicket('requester-1', 'Own ticket');
    createTicket('requester-2', 'Private ticket');

    expect(
      service.search(
        { requesterId: 'requester-2' },
        { requesterId: 'requester-1' },
      ),
    ).toEqual([]);
    expect(
      service
        .search(
          { requesterId: 'requester-1' },
          { requesterId: 'requester-1' },
        )
        .map(ticket => ticket.id),
    ).toEqual([ownTicket.id]);
  });

  it('rejects missing identity and limits outside the documented bounds', () => {
    expect(() =>
      service.search({ requesterId: 'requester-1' }, undefined),
    ).toThrow(UnauthorizedException);
    expect(() =>
      service.search(
        { requesterId: 'requester-1', limit: 101 },
        { requesterId: 'requester-1' },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.search(
        { requesterId: 'requester-1', limit: 0 },
        { requesterId: 'requester-1' },
      ),
    ).toThrow(BadRequestException);
  });

  it('never returns more than the maximum of 100 summaries', () => {
    for (let index = 0; index < 105; index += 1) {
      createTicket('requester-1', `Ticket ${index}`);
    }

    expect(
      service.search(
        { requesterId: 'requester-1', limit: 100 },
        { requesterId: 'requester-1' },
      ),
    ).toHaveLength(100);
  });

  it('requires support staff to provide a requester filter for bounded lookup', () => {
    expect(() =>
      service.search(
        { requesterId: undefined },
        { requesterId: 'agent-1', roles: ['support_agent'] },
      ),
    ).toThrow(BadRequestException);
  });
});
