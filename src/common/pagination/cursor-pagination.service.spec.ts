import { Test, TestingModule } from '@nestjs/testing';
import { CursorPaginationService } from './cursor-pagination.service';

describe('CursorPaginationService', () => {
  let service: CursorPaginationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CursorPaginationService],
    }).compile();
    service = module.get<CursorPaginationService>(CursorPaginationService);
  });

  describe('cursor encoding/decoding', () => {
    it('should encode and decode a cursor round-trip', () => {
      const cursor = service.encodeCursor('2026-07-22T10:00:00Z', 'abc-123');
      const decoded = service.decodeCursor(cursor);
      expect(decoded).toEqual({ sortValue: '2026-07-22T10:00:00Z', id: 'abc-123' });
    });

    it('should encode and decode numeric sort values', () => {
      const cursor = service.encodeCursor(95.5, 'sig-456');
      const decoded = service.decodeCursor(cursor);
      expect(decoded).toEqual({ sortValue: 95.5, id: 'sig-456' });
    });

    it('should return null for invalid base64', () => {
      expect(service.decodeCursor('not-valid-base64!!!')).toBeNull();
    });

    it('should return null for undefined cursor', () => {
      expect(service.decodeCursor(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(service.decodeCursor('')).toBeNull();
    });
  });

  describe('normalizeOptions', () => {
    it('should use default limit of 20', () => {
      const result = service.normalizeOptions({});
      expect(result.limit).toBe(20);
      expect(result.after).toBeNull();
      expect(result.before).toBeNull();
    });

    it('should cap limit at 100', () => {
      const result = service.normalizeOptions({ limit: 500 });
      expect(result.limit).toBe(100);
    });

    it('should enforce minimum limit of 1', () => {
      const result = service.normalizeOptions({ limit: 0 });
      expect(result.limit).toBe(1);
    });

    it('should decode after cursor', () => {
      const cursor = service.encodeCursor('2026-07-22', 'id-1');
      const result = service.normalizeOptions({ after: cursor });
      expect(result.after).toEqual({ sortValue: '2026-07-22', id: 'id-1' });
    });
  });

  describe('buildPage', () => {
    interface TestEntity {
      id: string;
      createdAt: string;
      name: string;
    }

    const entities: TestEntity[] = [
      { id: '1', createdAt: '2026-07-22T10:00:00Z', name: 'First' },
      { id: '2', createdAt: '2026-07-22T09:00:00Z', name: 'Second' },
      { id: '3', createdAt: '2026-07-22T08:00:00Z', name: 'Third' },
    ];

    it('should build a page with hasNextPage=true when more data exists', () => {
      const page = service.buildPage(
        [...entities, { id: '4', createdAt: '2026-07-22T07:00:00Z', name: 'Fourth' }],
        3,
        (e) => e.createdAt,
        (e) => e.id,
      );
      expect(page.data).toHaveLength(3);
      expect(page.pageInfo.hasNextPage).toBe(true);
      expect(page.pageInfo.startCursor).toBeTruthy();
      expect(page.pageInfo.endCursor).toBeTruthy();
    });

    it('should build a page with hasNextPage=false when all data fits', () => {
      const page = service.buildPage(entities, 20, (e) => e.createdAt, (e) => e.id);
      expect(page.data).toHaveLength(3);
      expect(page.pageInfo.hasNextPage).toBe(false);
    });

    it('should handle empty data', () => {
      const page = service.buildPage([], 20, (e: any) => e.createdAt);
      expect(page.data).toHaveLength(0);
      expect(page.pageInfo.hasNextPage).toBe(false);
      expect(page.pageInfo.startCursor).toBeNull();
      expect(page.pageInfo.endCursor).toBeNull();
    });

    it('should include totalCount when provided', () => {
      const page = service.buildPage(entities, 20, (e) => e.createdAt, (e) => e.id, 'forward', 100);
      expect(page.pageInfo.totalCount).toBe(100);
    });
  });

  describe('buildLegacyPageInfo', () => {
    it('should build backward-compatible page info', () => {
      const data = [{ id: '1' }, { id: '2' }];
      const info = service.buildLegacyPageInfo(data, 50, 1, 20);
      expect(info).toEqual({
        page: 1,
        limit: 20,
        total: 50,
        totalPages: 3,
        hasNext: true,
        hasPrev: false,
      });
    });
  });
});
