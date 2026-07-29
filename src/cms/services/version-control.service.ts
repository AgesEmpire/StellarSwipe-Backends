import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentVersion } from '../entities/content-version.entity';
import { Content } from '../entities/content.entity';

@Injectable()
export class VersionControlService {
  constructor(
    @InjectRepository(ContentVersion)
    private readonly versionRepo: Repository<ContentVersion>,
  ) {}

  async snapshot(content: Content, changedBy: string, changeNotes?: string): Promise<ContentVersion> {
    const latestVersion = await this.versionRepo.findOne({
      where: { contentId: content.id },
      order: { version: 'DESC' },
    });

    const nextVersion = (latestVersion?.version ?? 0) + 1;

    return this.versionRepo.save(
      this.versionRepo.create({
        contentId: content.id,
        version: nextVersion,
        title: content.title,
        body: content.body,
        changedBy,
        changeNotes,
      }),
    );
  }

  async getVersionHistory(contentId: string): Promise<ContentVersion[]> {
    return this.versionRepo.find({
      where: { contentId },
      order: { version: 'DESC' },
    });
  }

  async getVersion(contentId: string, version: number): Promise<ContentVersion | null> {
    return this.versionRepo.findOne({ where: { contentId, version } });
  }
}
