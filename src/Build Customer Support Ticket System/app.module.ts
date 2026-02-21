import { Module } from '@nestjs/common';
import { SupportModule } from './support/support.module';

@Module({
  imports: [SupportModule],
})
export class AppModule {}
