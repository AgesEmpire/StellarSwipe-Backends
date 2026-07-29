import { buildPaginationLinks } from './pagination-links.util';

describe('buildPaginationLinks', () => {
  const BASE = '/api/v1/signals/feed';

  describe('first page', () => {
    const links = buildPaginationLinks(BASE, { page: 1, limit: 20, totalPages: 5 });

    it('self points to page 1', () => expect(links.self).toContain('page=1'));
    it('first points to page 1', () => expect(links.first).toContain('page=1'));
    it('last points to page 5', () => expect(links.last).toContain('page=5'));
    it('next points to page 2', () => expect(links.next).toContain('page=2'));
    it('prev is null on the first page', () => expect(links.prev).toBeNull());
  });

  describe('middle page', () => {
    const links = buildPaginationLinks(BASE, { page: 3, limit: 20, totalPages: 5 });

    it('self points to page 3', () => expect(links.self).toContain('page=3'));
    it('next points to page 4', () => expect(links.next).toContain('page=4'));
    it('prev points to page 2', () => expect(links.prev).toContain('page=2'));
  });

  describe('last page', () => {
    const links = buildPaginationLinks(BASE, { page: 5, limit: 20, totalPages: 5 });

    it('next is null on the last page', () => expect(links.next).toBeNull());
    it('prev points to page 4', () => expect(links.prev).toContain('page=4'));
    it('last points to page 5', () => expect(links.last).toContain('page=5'));
  });

  describe('single page', () => {
    const links = buildPaginationLinks(BASE, { page: 1, limit: 20, totalPages: 1 });

    it('next is null', () => expect(links.next).toBeNull());
    it('prev is null', () => expect(links.prev).toBeNull());
    it('last points to page 1', () => expect(links.last).toContain('page=1'));
  });

  describe('empty result set (totalPages = 0)', () => {
    const links = buildPaginationLinks(BASE, { page: 1, limit: 20, totalPages: 0 });

    it('last is null when there are no pages', () => expect(links.last).toBeNull());
    it('next is null', () => expect(links.next).toBeNull());
  });

  describe('preserves existing query parameters', () => {
    const url = `${BASE}?asset=USDC%2FXLM&sortBy=recent`;
    const links = buildPaginationLinks(url, { page: 2, limit: 10, totalPages: 4 });

    it('self retains filter params', () => {
      expect(links.self).toContain('asset=USDC%2FXLM');
      expect(links.self).toContain('sortBy=recent');
    });

    it('next retains filter params', () => {
      expect(links.next).toContain('asset=USDC%2FXLM');
      expect(links.next).toContain('sortBy=recent');
      expect(links.next).toContain('page=3');
    });

    it('prev retains filter params', () => {
      expect(links.prev).toContain('asset=USDC%2FXLM');
      expect(links.prev).toContain('page=1');
    });
  });

  describe('embeds limit in every link', () => {
    const links = buildPaginationLinks(BASE, { page: 1, limit: 50, totalPages: 3 });

    it('self contains limit', () => expect(links.self).toContain('limit=50'));
    it('next contains limit', () => expect(links.next).toContain('limit=50'));
    it('first contains limit', () => expect(links.first).toContain('limit=50'));
  });
});
