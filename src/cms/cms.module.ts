import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentManagerService } from './content-manager.service';
import { CmsController } from './cms.controller';
import { Content } from './entities/content.entity';
import { Translation } from './entities/translation.entity';
import { ContentVersion } from './entities/content-version.entity';
import { TranslationManagerService } from './services/translation-manager.service';
import { VersionControlService } from './services/version-control.service';
import { MarkdownProcessor } from './utils/markdown-processor';
import { TranslationValidator } from './utils/translation-validator';

@Module({
  imports: [TypeOrmModule.forFeature([Content, Translation, ContentVersion])],
  providers: [
    ContentManagerService,
    TranslationManagerService,
    VersionControlService,
    MarkdownProcessor,
    TranslationValidator,
  ],
  controllers: [CmsController],
  exports: [ContentManagerService, TranslationManagerService],
})
export class CmsModule {}
