import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { ProviderContent } from './entities/provider-content.entity';
import { ContentEngagement } from './entities/content-engagement.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProviderContent, ContentEngagement])],
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
