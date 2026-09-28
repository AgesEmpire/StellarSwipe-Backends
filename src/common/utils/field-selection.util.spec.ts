import { applySparseFieldset } from './field-selection.util';
import { BadRequestException } from '@nestjs/common';

describe('applySparseFieldset', () => {
  it('should preserve full response if fields is undefined', () => {
    const payload = { a: 1, b: 2 };
    expect(applySparseFieldset(payload, undefined)).toEqual(payload);
  });

  it('should select top-level object fields', () => {
    const payload = { a: 1, b: 2, c: 3 };
    expect(applySparseFieldset(payload, 'a,c')).toEqual({ a: 1, c: 3 });
  });

  it('should select nested object fields', () => {
    const payload = { user: { id: 'u1', name: 'Alice' }, status: 'active' };
    expect(applySparseFieldset(payload, 'user.id,status')).toEqual({ user: { id: 'u1' }, status: 'active' });
  });

  it('should select fields inside response arrays when top-level field names match', () => {
    const response = {
      signals: [
        { id: '1', pair: 'XLM/USDC', provider: { id: 'p1' } },
        { id: '2', pair: 'BTC/USD', provider: { id: 'p2' } },
      ],
      hasMore: false,
    };

    expect(applySparseFieldset(response, 'id,pair')).toEqual({
      signals: [
        { id: '1', pair: 'XLM/USDC' },
        { id: '2', pair: 'BTC/USD' },
      ],
      hasMore: false,
    });
  });

  it('should select nested item fields inside response arrays', () => {
    const response = {
      signals: [
        { id: '1', pair: 'XLM/USDC', provider: { id: 'p1', name: 'Alpha' } },
        { id: '2', pair: 'BTC/USD', provider: { id: 'p2', name: 'Beta' } },
      ],
      hasMore: true,
    };

    expect(applySparseFieldset(response, 'provider.id')).toEqual({
      signals: [
        { provider: { id: 'p1' } },
        { provider: { id: 'p2' } },
      ],
      hasMore: true,
    });
  });

  it('should throw if requested field does not exist', () => {
    expect(() => applySparseFieldset({ a: 1 }, 'a,b')).toThrow(BadRequestException);
  });
});
