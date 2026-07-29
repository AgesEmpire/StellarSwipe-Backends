import { successEnvelope, errorEnvelope } from './response-envelope';

describe('response envelope', () => {
  it('wraps success payloads consistently', () => {
    const res = successEnvelope({ id: 1 });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ id: 1 });
    expect(typeof res.timestamp).toBe('string');
  });

  it('wraps error payloads consistently', () => {
    const res = errorEnvelope('NOT_FOUND', 'Resource not found');
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
    expect(res.error.message).toBe('Resource not found');
    expect(typeof res.timestamp).toBe('string');
  });

  it('includes optional meta and details when provided', () => {
    const success = successEnvelope({ id: 1 }, { page: 1 });
    expect(success.meta).toEqual({ page: 1 });

    const error = errorEnvelope('BAD_REQUEST', 'Invalid input', { field: 'email' });
    expect(error.error.details).toEqual({ field: 'email' });
  });
});
