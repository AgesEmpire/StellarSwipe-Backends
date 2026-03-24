import { ParquetTransformer } from './parquet.transformer';
import { ExtractedRecord } from '../extractors/base.extractor';

describe('ParquetTransformer', () => {
  let transformer: ParquetTransformer;

  beforeEach(() => {
    transformer = new ParquetTransformer();
  });

  describe('buildPartitionKey', () => {
    it('should build a date-partitioned key', () => {
      const date = new Date('2024-03-15T00:00:00.000Z');
      const key = transformer.buildPartitionKey('user_events', date);
      expect(key).toBe('user_events/year=2024/month=03/day=15');
    });

    it('should pad month and day with zeros', () => {
      const date = new Date('2024-01-05T00:00:00.000Z');
      const key = transformer.buildPartitionKey('trades', date);
      expect(key).toBe('trades/year=2024/month=01/day=05');
    });

    it('should use UTC dates', () => {
      const date = new Date('2024-12-31T23:59:59.000Z');
      const key = transformer.buildPartitionKey('signals', date);
      expect(key).toBe('signals/year=2024/month=12/day=31');
    });
  });

  describe('transform', () => {
    const partitionDate = new Date('2024-03-15T00:00:00.000Z');

    it('should transform records into a ParquetRecord', () => {
      const records: ExtractedRecord[] = [
        {
          id: 'evt-1',
          timestamp: new Date('2024-03-15T10:00:00Z'),
          source: 'user_events',
          data: { userId: 'user-1', eventType: 'SWIPE_RIGHT' },
        },
      ];

      const result = transformer.transform('user_events', records, partitionDate);

      expect(result.format).toBe('PARQUET');
      expect(result.compression).toBe('SNAPPY');
      expect(result.recordCount).toBe(1);
      expect(result.partitionKey).toBe('user_events/year=2024/month=03/day=15');
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]._id).toBe('evt-1');
      expect(result.data[0]._timestamp).toBe('2024-03-15T10:00:00.000Z');
      expect(result.data[0].userId).toBe('user-1');
    });

    it('should return empty data array for empty records', () => {
      const result = transformer.transform('user_events', [], partitionDate);

      expect(result.recordCount).toBe(0);
      expect(result.data).toHaveLength(0);
      expect(result.schema.fields).toHaveLength(2); // only _id and _timestamp
    });

    it('should infer STRING type for string values', () => {
      const records: ExtractedRecord[] = [
        {
          id: 'r-1',
          timestamp: new Date(),
          source: 'test',
          data: { name: 'Alice' },
        },
      ];

      const result = transformer.transform('test', records, partitionDate);
      const nameField = result.schema.fields.find((f) => f.name === 'name');
      expect(nameField?.type).toBe('STRING');
    });

    it('should infer INT64 type for integer values', () => {
      const records: ExtractedRecord[] = [
        {
          id: 'r-1',
          timestamp: new Date(),
          source: 'test',
          data: { count: 42 },
        },
      ];

      const result = transformer.transform('test', records, partitionDate);
      const countField = result.schema.fields.find((f) => f.name === 'count');
      expect(countField?.type).toBe('INT64');
    });

    it('should infer DOUBLE type for float values', () => {
      const records: ExtractedRecord[] = [
        {
          id: 'r-1',
          timestamp: new Date(),
          source: 'test',
          data: { price: 1.23 },
        },
      ];

      const result = transformer.transform('test', records, partitionDate);
      const priceField = result.schema.fields.find((f) => f.name === 'price');
      expect(priceField?.type).toBe('DOUBLE');
    });

    it('should infer BOOLEAN type for boolean values', () => {
      const records: ExtractedRecord[] = [
        {
          id: 'r-1',
          timestamp: new Date(),
          source: 'test',
          data: { active: true },
        },
      ];

      const result = transformer.transform('test', records, partitionDate);
      const activeField = result.schema.fields.find((f) => f.name === 'active');
      expect(activeField?.type).toBe('BOOLEAN');
    });

    it('should infer TIMESTAMP type for Date values', () => {
      const records: ExtractedRecord[] = [
        {
          id: 'r-1',
          timestamp: new Date(),
          source: 'test',
          data: { createdAt: new Date() },
        },
      ];

      const result = transformer.transform('test', records, partitionDate);
      const dateField = result.schema.fields.find((f) => f.name === 'createdAt');
      expect(dateField?.type).toBe('TIMESTAMP');
    });

    it('should infer JSON type for object values', () => {
      const records: ExtractedRecord[] = [
        {
          id: 'r-1',
          timestamp: new Date(),
          source: 'test',
          data: { metadata: { key: 'value' } },
        },
      ];

      const result = transformer.transform('test', records, partitionDate);
      const metaField = result.schema.fields.find((f) => f.name === 'metadata');
      expect(metaField?.type).toBe('JSON');
    });

    it('should infer STRING for null values', () => {
      const records: ExtractedRecord[] = [
        {
          id: 'r-1',
          timestamp: new Date(),
          source: 'test',
          data: { optional: null },
        },
      ];

      const result = transformer.transform('test', records, partitionDate);
      const optionalField = result.schema.fields.find((f) => f.name === 'optional');
      expect(optionalField?.type).toBe('STRING');
    });

    it('should set schema name to sourceName', () => {
      const result = transformer.transform('trades', [], partitionDate);
      expect(result.schema.name).toBe('trades');
    });

    it('should include _id and _timestamp fields in schema', () => {
      const result = transformer.transform('test', [], partitionDate);
      const idField = result.schema.fields.find((f) => f.name === '_id');
      const tsField = result.schema.fields.find((f) => f.name === '_timestamp');

      expect(idField?.nullable).toBe(false);
      expect(tsField?.nullable).toBe(false);
    });

    it('should handle multiple records', () => {
      const records: ExtractedRecord[] = [
        { id: 'r-1', timestamp: new Date(), source: 'test', data: { x: 1 } },
        { id: 'r-2', timestamp: new Date(), source: 'test', data: { x: 2 } },
        { id: 'r-3', timestamp: new Date(), source: 'test', data: { x: 3 } },
      ];

      const result = transformer.transform('test', records, partitionDate);
      expect(result.recordCount).toBe(3);
      expect(result.data).toHaveLength(3);
    });
  });
});
