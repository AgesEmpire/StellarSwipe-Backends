import { Module } from '@nestjs/common';
import { SupportModule } from './support.module';

@Module({
  imports: [SupportModule],
})
export class AppModule {}
