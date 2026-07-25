export interface PaginationLinks {
  self: string;
  first: string;
  last: string | null;
  next: string | null;
  prev: string | null;
}

export interface PageState {
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Builds HATEOAS-style navigation links for paginated list responses.
 *
 * @param requestUrl  The full request URL (pathname + existing query string).
 * @param pageState   Current page, page size, and total page count.
 * @returns           Object with self/first/last/next/prev URLs. next/prev are
 *                    null when there is no adjacent page.
 */
export function buildPaginationLinks(requestUrl: string, pageState: PageState): PaginationLinks {
  // Parse pathname + query without requiring an absolute base URL.
  const [pathname, rawSearch = ''] = requestUrl.split('?');
  const params = new URLSearchParams(rawSearch);

  const buildLink = (page: number): string => {
    const p = new URLSearchParams(params);
    p.set('page', String(page));
    p.set('limit', String(pageState.limit));
    const qs = p.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const { page, totalPages } = pageState;

  return {
    self: buildLink(page),
    first: buildLink(1),
    last: totalPages > 0 ? buildLink(totalPages) : null,
    next: page < totalPages ? buildLink(page + 1) : null,
    prev: page > 1 ? buildLink(page - 1) : null,
  };
}
