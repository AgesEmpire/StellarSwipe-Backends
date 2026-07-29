import { Module } from '@nestjs/common';
import { ConditionalOrdersModule } from './conditional/conditional-orders.module';

@Module({
  imports: [ConditionalOrdersModule],
  exports: [ConditionalOrdersModule],
})
export class OrdersModule {}
