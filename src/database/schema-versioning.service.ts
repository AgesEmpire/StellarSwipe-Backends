import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SchemaVersion } from './schema-version.entity';

@Injectable()
export class SchemaVersioningService {
  private readonly logger = new Logger(SchemaVersioningService.name);

  constructor(
    @InjectRepository(SchemaVersion)
    private readonly schemaVersionRepo: Repository<SchemaVersion>,
  ) {}

  async register(
    entityName: string,
    version: number,
    options: {
      description?: string;
      isCompatible?: boolean;
      migrationName?: string;
    } = {},
  ): Promise<SchemaVersion> {
    const existing = await this.schemaVersionRepo.findOne({
      where: { entityName, version },
    });

    if (existing) {
      this.logger.debug(
        `Schema version ${version} for ${entityName} already registered`,
      );
      return existing;
    }

    const entry = this.schemaVersionRepo.create({
      entityName,
      version,
      description: options.description ?? null,
      isCompatible: options.isCompatible ?? true,
      migrationName: options.migrationName ?? null,
    });

    const saved = await this.schemaVersionRepo.save(entry);
    this.logger.log(
      `Registered schema version ${version} for entity "${entityName}"`,
    );
    return saved;
  }

  async getCurrentVersion(entityName: string): Promise<number | null> {
    const row = await this.schemaVersionRepo.findOne({
      where: { entityName },
      order: { version: 'DESC' },
    });
    return row?.version ?? null;
  }

  async getHistory(entityName: string): Promise<SchemaVersion[]> {
    return this.schemaVersionRepo.find({
      where: { entityName },
      order: { version: 'ASC' },
    });
  }

  async isCompatible(entityName: string, version: number): Promise<boolean> {
    const row = await this.schemaVersionRepo.findOne({
      where: { entityName, version },
    });
    return row?.isCompatible ?? false;
  }

  async checkCompatibility(
    entityName: string,
    requiredVersion: number,
  ): Promise<{ compatible: boolean; currentVersion: number | null }> {
    const currentVersion = await this.getCurrentVersion(entityName);

    if (currentVersion === null) {
      return { compatible: false, currentVersion: null };
    }

    const compatible =
      currentVersion >= requiredVersion &&
      (await this.isCompatible(entityName, currentVersion));

    return { compatible, currentVersion };
  }
}
