jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { PermanentError } from '../common/retry';
import {
  UnsupportedPayloadVersionError,
  VersionedPayloadSchema,
} from './payload-versioning';
import { PRIORITY_JOB_SCHEMA } from './priority-queue.service';

interface OrderPayload {
  schemaVersion: number;
  orderId: string;
  amount: { value: string; asset: string };
}

// v1: { orderId, amount: '10' }          (implicit XLM, no schemaVersion)
// v2: { orderId, amount: '10', asset }   (asset made explicit)
// v3: { orderId, amount: { value, asset } }
const orderSchema = new VersionedPayloadSchema<OrderPayload>('order', 3, {
  1: (p) => ({ ...p, asset: 'XLM' }),
  2: ({ amount, asset, ...rest }) => ({
    ...rest,
    amount: { value: amount, asset },
  }),
});

describe('VersionedPayloadSchema', () => {
  it('passes current-version payloads through unchanged', () => {
    const payload = {
      schemaVersion: 3,
      orderId: 'o1',
      amount: { value: '10', asset: 'USDC' },
    };
    expect(orderSchema.upgrade(payload)).toEqual(payload);
  });

  it('migrates an unversioned (pre-versioning) payload through every step', () => {
    expect(orderSchema.upgrade({ orderId: 'o1', amount: '10' })).toEqual({
      schemaVersion: 3,
      orderId: 'o1',
      amount: { value: '10', asset: 'XLM' },
    });
  });

  it('migrates from an intermediate version', () => {
    expect(
      orderSchema.upgrade({
        schemaVersion: 2,
        orderId: 'o1',
        amount: '5',
        asset: 'USDC',
      }),
    ).toEqual({
      schemaVersion: 3,
      orderId: 'o1',
      amount: { value: '5', asset: 'USDC' },
    });
  });

  it('does not mutate the stored payload', () => {
    const stored = { orderId: 'o1', amount: '10' };
    orderSchema.upgrade(stored);
    expect(stored).toEqual({ orderId: 'o1', amount: '10' });
  });

  it.each([
    ['newer than this build', { schemaVersion: 4 }],
    ['zero', { schemaVersion: 0 }],
    ['non-integer', { schemaVersion: 1.5 }],
    ['non-numeric', { schemaVersion: '2' }],
    ['not an object', 'garbage'],
    ['missing', null],
  ])(
    'rejects a payload whose version is %s as a permanent failure',
    (_label, payload) => {
      let error: unknown;
      try {
        orderSchema.upgrade(payload);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(UnsupportedPayloadVersionError);
      expect(error).toBeInstanceOf(PermanentError);
    },
  );

  it('rejects a version with no migration path', () => {
    const gappy = new VersionedPayloadSchema<OrderPayload>('order', 3, {
      2: (p) => p,
    });
    expect(() => gappy.upgrade({ orderId: 'o1' })).toThrow(
      UnsupportedPayloadVersionError,
    );
  });
});

describe('PRIORITY_JOB_SCHEMA', () => {
  const v2 = {
    schemaVersion: 2,
    type: 'notify',
    payload: { userId: 'u1' },
    priority: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr-1',
  };

  it('accepts current payloads', () => {
    expect(PRIORITY_JOB_SCHEMA.upgrade(v2)).toEqual(v2);
  });

  it('upgrades v1 payloads, keeping an existing correlation ID', () => {
    const { schemaVersion, ...v1 } = v2;
    expect(PRIORITY_JOB_SCHEMA.upgrade(v1)).toEqual(v2);
  });

  it('assigns a correlation ID to v1 payloads created before they existed', () => {
    const { schemaVersion, correlationId, ...v1 } = v2;
    const upgraded = PRIORITY_JOB_SCHEMA.upgrade(v1);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.correlationId).toEqual(expect.any(String));
    expect(upgraded.correlationId.length).toBeGreaterThan(0);
  });
});
