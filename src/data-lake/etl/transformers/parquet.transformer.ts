import { Injectable } from '@nestjs/common';
import { ExtractedRecord } from '../extractors/base.extractor';

export interface ParquetField {
  name: string;
  type: string;
  nullable: boolean;
}

export interface ParquetSchema {
  name: string;
  fields: ParquetField[];
}

export interface ParquetRecord {
  schema: ParquetSchema;
  partitionKey: string;
  data: Record<string, unknown>[];
  recordCount: number;
  sizeBytes: number;
  format: 'PARQUET';
  compression: 'SNAPPY';
}

@Injectable()
export class ParquetTransformer {
  transform(
    sourceName: string,
    records: ExtractedRecord[],
    partitionDate: Date,
  ): ParquetRecord {
    const schema = this.inferSchema(sourceName, records);
    const partitionKey = this.buildPartitionKey(sourceName, partitionDate);
    const data = records.map((r) => ({
      _id: r.id,
      _timestamp: r.timestamp.toISOString(),
      ...r.data,
    }));
    const serialized = JSON.stringify(data);

    return {
      schema,
      partitionKey,
      data,
      recordCount: records.length,
      sizeBytes: Buffer.byteLength(serialized, 'utf8'),
      format: 'PARQUET',
      compression: 'SNAPPY',
    };
  }

  buildPartitionKey(sourceName: string, date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${sourceName}/year=${year}/month=${month}/day=${day}`;
  }

  private inferSchema(sourceName: string, records: ExtractedRecord[]): ParquetSchema {
    const fields: ParquetField[] = [
      { name: '_id', type: 'STRING', nullable: false },
      { name: '_timestamp', type: 'TIMESTAMP', nullable: false },
    ];

    if (records.length > 0) {
      for (const [key, value] of Object.entries(records[0].data)) {
        fields.push({
          name: key,
          type: this.inferType(value),
          nullable: true,
        });
      }
    }

    return { name: sourceName, fields };
  }

  private inferType(value: unknown): string {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'INT64' : 'DOUBLE';
    }
    if (typeof value === 'boolean') {
      return 'BOOLEAN';
    }
    if (value instanceof Date) {
      return 'TIMESTAMP';
    }
    if (typeof value === 'object' && value !== null) {
      return 'JSON';
    }
    return 'STRING';
  }
}
