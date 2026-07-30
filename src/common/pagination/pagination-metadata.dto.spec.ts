import { buildPaginationMeta, buildPaginatedResult, PaginationMetaDto, PaginatedResultDto } from './pagination-metadata.dto';

describe('PaginationMetaDto', () => {
  describe('buildPaginationMeta', () => {
    it('computes totalPages when not provided', () => {
      const meta = buildPaginationMeta({ page: 1, limit: 20, total: 100 });
      expect(meta.totalPages).toBe(5);
      expect(meta.page).toBe(1);
      expect(meta.limit).toBe(20);
      expect(meta.total).toBe(100);
    });

    it('sets hasNext=true when page < totalPages', () => {
      const meta = buildPaginationMeta({ page: 1, limit: 10, total: 50 });
      expect(meta.hasNext).toBe(true);
      expect(meta.hasPrev).toBe(false);
    });

    it('sets hasNext=false on the last page', () => {
      const meta = buildPaginationMeta({ page: 5, limit: 10, total: 50 });
      expect(meta.hasNext).toBe(false);
      expect(meta.hasPrev).toBe(true);
    });

    it('sets hasPrev=true when page > 1', () => {
      const meta = buildPaginationMeta({ page: 3, limit: 10, total: 50 });
      expect(meta.hasPrev).toBe(true);
      expect(meta.hasNext).toBe(true);
    });

    it('handles empty result set (total=0)', () => {
      const meta = buildPaginationMeta({ page: 1, limit: 20, total: 0 });
      expect(meta.totalPages).toBe(0);
      expect(meta.hasNext).toBe(false);
      expect(meta.hasPrev).toBe(false);
    });

    it('accepts explicit totalPages override', () => {
      const meta = buildPaginationMeta({ page: 1, limit: 20, total: 100, totalPages: 3 });
      expect(meta.totalPages).toBe(3);
      expect(meta.hasNext).toBe(true);
    });

    it('accepts nextCursor for cursor-based pagination', () => {
      const meta = buildPaginationMeta({
        page: 1,
        limit: 20,
        total: 100,
        nextCursor: 'eyJvZmZzZXQiOjIwfQ==',
      });
      expect(meta.nextCursor).toBe('eyJvZmZzZXQiOjIwfQ==');
    });

    it('defaults page to 1 when not provided', () => {
      const meta = buildPaginationMeta({ limit: 20, total: 50 });
      expect(meta.page).toBe(1);
    });

    it('defaults nextCursor to null when not provided', () => {
      const meta = buildPaginationMeta({ limit: 20, total: 50 });
      expect(meta.nextCursor).toBeNull();
    });

    it('includes links when provided', () => {
      const links = {
        self: '/api/v1/items?page=1&limit=20',
        first: '/api/v1/items?page=1&limit=20',
        last: '/api/v1/items?page=3&limit=20',
        next: '/api/v1/items?page=2&limit=20',
        prev: null,
      };
      const meta = buildPaginationMeta({ page: 1, limit: 20, total: 60, links });
      expect(meta.links).toEqual(links);
    });
  });

  describe('buildPaginatedResult', () => {
    it('wraps data and pagination into a standard shape', () => {
      const data = [{ id: '1' }, { id: '2' }];
      const result = buildPaginatedResult(data, { page: 1, limit: 10, total: 2 });

      expect(result.data).toEqual(data);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.hasNext).toBe(false);
    });

    it('preserves the data array reference', () => {
      const data = [{ id: '1' }];
      const result = buildPaginatedResult(data, { limit: 10, total: 1 });
      expect(result.data).toBe(data);
    });

    it('handles empty data array', () => {
      const result = buildPaginatedResult([], { page: 1, limit: 20, total: 0 });
      expect(result.data).toEqual([]);
      expect(result.pagination.totalPages).toBe(0);
    });
  });

  describe('type compliance', () => {
    it('PaginatedResultDto has correct shape', () => {
      const instance = new PaginatedResultDto<string>();
      instance.data = ['a', 'b'];
      instance.pagination = buildPaginationMeta({ limit: 10, total: 2 });

      expect(instance.data).toEqual(['a', 'b']);
      expect(instance.pagination.total).toBe(2);
    });

    it('PaginationMetaDto has correct shape', () => {
      const instance = new PaginationMetaDto();
      instance.limit = 20;
      instance.total = 100;
      instance.hasNext = true;
      instance.hasPrev = false;

      expect(instance.limit).toBe(20);
      expect(instance.total).toBe(100);
      expect(instance.hasNext).toBe(true);
      expect(instance.hasPrev).toBe(false);
    });
  });
});
