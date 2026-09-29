import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxService } from './outbox.service';
import { OutboxController } from './outbox.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  controllers: [OutboxController],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
