import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesGuard } from '../authorization/guards/roles.guard';
import { Role } from '../authorization/entities/role.entity';
import { UserRole } from '../authorization/entities/user-role.entity';
import { TicketController } from './ticket.controller';
import { TicketService } from './ticket.service';

@Module({
  imports: [TypeOrmModule.forFeature([Role, UserRole])],
  controllers: [TicketController],
  providers: [TicketService, RolesGuard],
  exports: [TicketService],
})
export class SupportModule {}
