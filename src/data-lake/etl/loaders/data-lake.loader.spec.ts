import * as fs from 'fs';
import { DataLakeLoader } from './data-lake.loader';
import { ParquetRecord } from '../transformers/parquet.transformer';

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  rmSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('DataLakeLoader', () => {
  let loader: DataLakeLoader;

  const mockParquetRecord: ParquetRecord = {
    schema: {
      name: 'user_events',
      fields: [
        { name: '_id', type: 'STRING', nullable: false },
        { name: '_timestamp', type: 'TIMESTAMP', nullable: false },
        { name: 'userId', type: 'STRING', nullable: true },
      ],
    },
    partitionKey: 'user_events/year=2024/month=03/day=15',
    data: [{ _id: 'evt-1', _timestamp: '2024-03-15T10:00:00Z', userId: 'u1' }],
    recordCount: 1,
    sizeBytes: 128,
    format: 'PARQUET',
    compression: 'SNAPPY',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    loader = new DataLakeLoader('/tmp/test-data-lake');
  });

  describe('constructor', () => {
    it('should use provided basePath', () => {
      const l = new DataLakeLoader('/custom/path');
      expect(l.basePath).toBe('/custom/path');
    });

    it('should use DATA_LAKE_PATH env var when no arg provided', () => {
      process.env.DATA_LAKE_PATH = '/env/path';
      const l = new DataLakeLoader();
      expect(l.basePath).toBe('/env/path');
      delete process.env.DATA_LAKE_PATH;
    });

    it('should fall back to /tmp/data-lake when no arg or env', () => {
      delete process.env.DATA_LAKE_PATH;
      const l = new DataLakeLoader();
      expect(l.basePath).toBe('/tmp/data-lake');
    });
  });

  describe('load', () => {
    it('should return a LoadResult with correct fields', async () => {
      const result = await loader.load(mockParquetRecord);

      expect(result.partitionKey).toBe('user_events/year=2024/month=03/day=15');
      expect(result.recordCount).toBe(1);
      expect(result.sizeBytes).toBe(128);
      expect(result.filePath).toContain('user_events/year=2024/month=03/day=15');
      expect(result.filePath).toContain('.parquet.json');
      expect(result.writtenAt).toBeInstanceOf(Date);
    });

    it('should call fs.mkdirSync to create the partition directory', async () => {
      await loader.load(mockParquetRecord);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('user_events/year=2024/month=03/day=15'),
        { recursive: true },
      );
    });

    it('should call fs.writeFileSync with JSON content', async () => {
      await loader.load(mockParquetRecord);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.parquet.json'),
        expect.stringContaining('"user_events"'),
        'utf8',
      );
    });

    it('should write content containing schema and data', async () => {
      await loader.load(mockParquetRecord);

      const [, content] = (mockFs.writeFileSync as jest.Mock).mock.calls[0];
      const parsed = JSON.parse(content);
      expect(parsed.schema.name).toBe('user_events');
      expect(parsed.data).toHaveLength(1);
    });
  });

  describe('getPartitionPath', () => {
    it('should join basePath with partitionKey', () => {
      const result = loader.getPartitionPath('trades/year=2024/month=01/day=01');
      expect(result).toContain('/tmp/test-data-lake');
      expect(result).toContain('trades/year=2024/month=01/day=01');
    });
  });

  describe('applyRetentionPolicy', () => {
    it('should return 0 when source directory does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await loader.applyRetentionPolicy({
        sourceName: 'user_events',
        retentionDays: 30,
      });

      expect(result).toBe(0);
    });

    it('should delete expired partitions', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith('user_events')) return ['year=2020'] as any;
        if (s.endsWith('year=2020')) return ['month=01'] as any;
        if (s.endsWith('month=01')) return ['day=15'] as any;
        return [] as any;
      });

      const result = await loader.applyRetentionPolicy({
        sourceName: 'user_events',
        retentionDays: 30,
      });

      expect(result).toBe(1);
      expect(mockFs.rmSync).toHaveBeenCalledTimes(1);
      expect(mockFs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('day=15'),
        { recursive: true, force: true },
      );
    });

    it('should not delete partitions within retention window', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const year = future.getUTCFullYear();
      const month = String(future.getUTCMonth() + 1).padStart(2, '0');
      const day = String(future.getUTCDate()).padStart(2, '0');

      mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith('user_events')) return [`year=${year}`] as any;
        if (s.endsWith(`year=${year}`)) return [`month=${month}`] as any;
        if (s.endsWith(`month=${month}`)) return [`day=${day}`] as any;
        return [] as any;
      });

      const result = await loader.applyRetentionPolicy({
        sourceName: 'user_events',
        retentionDays: 30,
      });

      expect(result).toBe(0);
      expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('should skip non year= directories', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['some_file.txt', '_metadata'] as any);

      const result = await loader.applyRetentionPolicy({
        sourceName: 'user_events',
        retentionDays: 30,
      });

      expect(result).toBe(0);
      expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('should skip non month= directories', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith('user_events')) return ['year=2020'] as any;
        if (s.endsWith('year=2020')) return ['not_a_month'] as any;
        return [] as any;
      });

      const result = await loader.applyRetentionPolicy({
        sourceName: 'user_events',
        retentionDays: 30,
      });

      expect(result).toBe(0);
      expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('should skip non day= directories', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith('user_events')) return ['year=2020'] as any;
        if (s.endsWith('year=2020')) return ['month=01'] as any;
        if (s.endsWith('month=01')) return ['not_a_day'] as any;
        return [] as any;
      });

      const result = await loader.applyRetentionPolicy({
        sourceName: 'user_events',
        retentionDays: 30,
      });

      expect(result).toBe(0);
      expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it('should delete multiple expired partitions across months', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith('user_events')) return ['year=2020'] as any;
        if (s.endsWith('year=2020')) return ['month=01'] as any;
        if (s.endsWith('month=01')) return ['day=01', 'day=02', 'day=03'] as any;
        return [] as any;
      });

      const result = await loader.applyRetentionPolicy({
        sourceName: 'user_events',
        retentionDays: 30,
      });

      expect(result).toBe(3);
      expect(mockFs.rmSync).toHaveBeenCalledTimes(3);
    });

    it('should handle readdirSync errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith('user_events')) return ['year=2020'] as any;
        if (s.endsWith('year=2020')) throw new Error('permission denied');
        return [] as any;
      });

      // Should not throw, returns 0 because month listing fails
      const result = await loader.applyRetentionPolicy({
        sourceName: 'user_events',
        retentionDays: 30,
      });

      expect(result).toBe(0);
    });
  });
});
