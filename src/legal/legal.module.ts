import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentManagerService } from './document-manager.service';
import { LegalController } from './legal.controller';
import { LegalDocument } from './entities/legal-document.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { UserAcceptance } from './entities/user-acceptance.entity';
import { VersionManagerService } from './services/version-manager.service';
import { AcceptanceTrackerService } from './services/acceptance-tracker.service';
import { DocumentGenerator } from './utils/document-generator';
import { DiffGenerator } from './utils/diff-generator';

@Module({
  imports: [TypeOrmModule.forFeature([LegalDocument, DocumentVersion, UserAcceptance])],
  controllers: [LegalController],
  providers: [
    DocumentManagerService,
    VersionManagerService,
    AcceptanceTrackerService,
    DocumentGenerator,
    DiffGenerator,
  ],
  exports: [DocumentManagerService, AcceptanceTrackerService],
})
export class LegalModule {}
