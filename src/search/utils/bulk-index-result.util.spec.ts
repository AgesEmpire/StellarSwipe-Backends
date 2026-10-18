import { failAllWithError, parseBulkResponse } from './bulk-index-result.util';

describe('parseBulkResponse', () => {
  it('reports every document as succeeded when the bulk response has no errors', () => {
    const ids = ['a', 'b', 'c'];
    const response = {
      items: [
        { index: { _id: 'a', status: 201 } },
        { index: { _id: 'b', status: 201 } },
        { index: { _id: 'c', status: 200 } },
      ],
    };

    const result = parseBulkResponse(ids, response);

    expect(result.total).toBe(3);
    expect(result.succeeded).toEqual(['a', 'b', 'c']);
    expect(result.failed).toEqual([]);
  });

  it('does not treat a partially failed batch as fully successful', () => {
    const ids = ['a', 'b', 'c'];
    const response = {
      items: [
        { index: { _id: 'a', status: 201 } },
        { index: { _id: 'b', status: 400, error: { type: 'mapper_parsing_exception', reason: 'bad field' } } },
        { index: { _id: 'c', status: 201 } },
      ],
    };

    const result = parseBulkResponse(ids, response);

    expect(result.total).toBe(3);
    expect(result.succeeded).toEqual(['a', 'c']);
    expect(result.failed).toEqual([{ id: 'b', error: 'bad field' }]);
  });

  it('accounts for documents with no corresponding response item', () => {
    const ids = ['a', 'b'];
    const response = { items: [{ index: { _id: 'a', status: 201 } }] };

    const result = parseBulkResponse(ids, response);

    expect(result.succeeded).toEqual(['a']);
    expect(result.failed).toEqual([
      { id: 'b', error: 'No bulk response item returned for this document' },
    ]);
  });

  it('accounts for every document when the response is empty or missing', () => {
    expect(parseBulkResponse(['a', 'b'], undefined).failed).toHaveLength(2);
    expect(parseBulkResponse(['a', 'b'], {}).failed).toHaveLength(2);
    expect(parseBulkResponse([], undefined)).toEqual({ total: 0, succeeded: [], failed: [] });
  });

  it('falls back to the action type when no reason is present', () => {
    const response = { items: [{ index: { _id: 'a', error: { type: 'timeout_exception' } } }] };
    const result = parseBulkResponse(['a'], response);
    expect(result.failed).toEqual([{ id: 'a', error: 'timeout_exception' }]);
  });
});

describe('failAllWithError', () => {
  it('marks every submitted id as failed with the thrown error message', () => {
    const result = failAllWithError(['a', 'b'], new Error('connection refused'));
    expect(result).toEqual({
      total: 2,
      succeeded: [],
      failed: [
        { id: 'a', error: 'connection refused' },
        { id: 'b', error: 'connection refused' },
      ],
    });
  });

  it('stringifies non-Error values', () => {
    const result = failAllWithError(['a'], 'boom');
    expect(result.failed).toEqual([{ id: 'a', error: 'boom' }]);
  });
});
