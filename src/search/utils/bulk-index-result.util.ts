/**
 * Per-document outcome of a bulk indexing operation.
 */
export interface BulkIndexFailure {
  id: string;
  error: string;
}

/**
 * Aggregate result of a bulk indexing operation, accounting for every
 * document that was submitted rather than treating a partially failed
 * batch as fully successful.
 */
export interface BulkIndexResult {
  total: number;
  succeeded: string[];
  failed: BulkIndexFailure[];
}

/**
 * Minimal shape of an Elasticsearch bulk() response action result item,
 * e.g. `{ index: { _id, status, error } }`.
 */
interface BulkResponseActionResult {
  _id?: string;
  status?: number;
  error?: { type?: string; reason?: string } | null;
}

interface BulkResponseItem {
  index?: BulkResponseActionResult;
  create?: BulkResponseActionResult;
  update?: BulkResponseActionResult;
  delete?: BulkResponseActionResult;
}

interface BulkResponseLike {
  items?: BulkResponseItem[];
}

/**
 * Parse an Elasticsearch `bulk()` response against the ordered list of
 * document ids submitted in the request body (one action+document pair per
 * id, in the same order), producing a per-document success/failure outcome.
 *
 * Every id supplied is accounted for: it ends up in exactly one of
 * `succeeded` or `failed`, even if the response is missing an item for it
 * (e.g. a malformed/short response) or the request failed outright before
 * a response body was ever produced.
 */
export function parseBulkResponse(
  ids: string[],
  response: BulkResponseLike | null | undefined,
): BulkIndexResult {
  const items = response?.items ?? [];
  const succeeded: string[] = [];
  const failed: BulkIndexFailure[] = [];

  ids.forEach((id, index) => {
    const item = items[index];
    const action = item ? item.index ?? item.create ?? item.update ?? item.delete : undefined;

    if (!action) {
      failed.push({ id, error: 'No bulk response item returned for this document' });
      return;
    }

    if (action.error) {
      failed.push({
        id,
        error: action.error.reason || action.error.type || 'Unknown bulk indexing error',
      });
      return;
    }

    succeeded.push(id);
  });

  return { total: ids.length, succeeded, failed };
}

/**
 * Build a result where every id is marked as failed with the same error,
 * used when the bulk request itself throws (e.g. network error) and no
 * per-document response was ever received.
 */
export function failAllWithError(ids: string[], error: unknown): BulkIndexResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    total: ids.length,
    succeeded: [],
    failed: ids.map((id) => ({ id, error: message })),
  };
}
