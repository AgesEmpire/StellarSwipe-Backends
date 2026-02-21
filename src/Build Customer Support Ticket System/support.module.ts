import { Module } from '@nestjs/common';
import { TicketController } from './tickets/ticket.controller';
import { TicketService } from './tickets/ticket.service';

@Module({
  controllers: [TicketController],
  providers: [TicketService],
  exports: [TicketService],
})
export class SupportModule {}
