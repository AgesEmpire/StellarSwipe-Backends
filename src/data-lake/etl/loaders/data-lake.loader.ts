import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ParquetRecord } from '../transformers/parquet.transformer';

export interface LoadResult {
  partitionKey: string;
  filePath: string;
  recordCount: number;
  sizeBytes: number;
  writtenAt: Date;
}

export interface RetentionPolicy {
  sourceName: string;
  retentionDays: number;
}

@Injectable()
export class DataLakeLoader {
  private readonly logger = new Logger(DataLakeLoader.name);
  readonly basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? process.env.DATA_LAKE_PATH ?? '/tmp/data-lake';
  }

  async load(parquetRecord: ParquetRecord): Promise<LoadResult> {
    const dirPath = path.join(this.basePath, parquetRecord.partitionKey);
    const fileName = `data_${Date.now()}.parquet.json`;
    const filePath = path.join(dirPath, fileName);
    const content = JSON.stringify(
      { schema: parquetRecord.schema, data: parquetRecord.data },
      null,
      2,
    );

    await this.ensureDirectory(dirPath);
    await this.writeFile(filePath, content);

    this.logger.log(
      `Loaded ${parquetRecord.recordCount} records to ${filePath}`,
    );

    return {
      partitionKey: parquetRecord.partitionKey,
      filePath,
      recordCount: parquetRecord.recordCount,
      sizeBytes: parquetRecord.sizeBytes,
      writtenAt: new Date(),
    };
  }

  async applyRetentionPolicy(policy: RetentionPolicy): Promise<number> {
    const sourcePath = path.join(this.basePath, policy.sourceName);

    if (!this.directoryExists(sourcePath)) {
      return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

    let deletedCount = 0;
    const yearDirs = this.listDirectory(sourcePath);

    for (const yearDir of yearDirs) {
      if (!yearDir.startsWith('year=')) continue;
      const year = parseInt(yearDir.replace('year=', ''), 10);

      const yearPath = path.join(sourcePath, yearDir);
      const monthDirs = this.listDirectory(yearPath);

      for (const monthDir of monthDirs) {
        if (!monthDir.startsWith('month=')) continue;
        const month = parseInt(monthDir.replace('month=', ''), 10);

        const monthPath = path.join(yearPath, monthDir);
        const dayDirs = this.listDirectory(monthPath);

        for (const dayDir of dayDirs) {
          if (!dayDir.startsWith('day=')) continue;
          const day = parseInt(dayDir.replace('day=', ''), 10);
          const partitionDate = new Date(year, month - 1, day);

          if (partitionDate < cutoffDate) {
            const partitionPath = path.join(monthPath, dayDir);
            this.removeDirectory(partitionPath);
            deletedCount++;
            this.logger.log(`Deleted expired partition: ${partitionPath}`);
          }
        }
      }
    }

    return deletedCount;
  }

  getPartitionPath(partitionKey: string): string {
    return path.join(this.basePath, partitionKey);
  }

  protected ensureDirectory(dirPath: string): Promise<void> {
    fs.mkdirSync(dirPath, { recursive: true });
    return Promise.resolve();
  }

  protected writeFile(filePath: string, content: string): Promise<void> {
    fs.writeFileSync(filePath, content, 'utf8');
    return Promise.resolve();
  }

  protected directoryExists(dirPath: string): boolean {
    return fs.existsSync(dirPath);
  }

  protected listDirectory(dirPath: string): string[] {
    try {
      return fs.readdirSync(dirPath);
    } catch {
      return [];
    }
  }

  protected removeDirectory(dirPath: string): void {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}
