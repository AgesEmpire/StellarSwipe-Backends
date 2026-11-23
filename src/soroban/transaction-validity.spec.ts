import {
  assertEnvelopeSubmittable,
  classifyTransactionValidity,
  DEFAULT_VALIDITY_WINDOW_LEDGERS,
  lastValidLedgerForWindow,
  lastValidLedgerFromBounds,
  TransactionEnvelopeExpiredException,
  TransactionValidityStatus,
  TX_ENVELOPE_EXPIRED,
} from './transaction-validity';

describe('transaction validity (#1511)', () => {
  const LAST_VALID = 1_000;

  describe('classifyTransactionValidity around the boundary', () => {
    it('is VALID just before the boundary (one ledger can still include it)', () => {
      const v = classifyTransactionValidity(LAST_VALID, LAST_VALID - 1);
      expect(v).toEqual({
        status: TransactionValidityStatus.VALID,
        latestLedger: LAST_VALID - 1,
        lastValidLedger: LAST_VALID,
        ledgersRemaining: 1,
      });
    });

    it('is EXPIRED at the boundary (last valid ledger already closed)', () => {
      const v = classifyTransactionValidity(LAST_VALID, LAST_VALID);
      expect(v.status).toBe(TransactionValidityStatus.EXPIRED);
      expect(v.ledgersRemaining).toBe(0);
    });

    it('is EXPIRED after the boundary and never reports negative remaining', () => {
      const v = classifyTransactionValidity(LAST_VALID, LAST_VALID + 5);
      expect(v.status).toBe(TransactionValidityStatus.EXPIRED);
      expect(v.ledgersRemaining).toBe(0);
    });

    it('is UNKNOWN when the boundary or latest ledger is unavailable', () => {
      expect(classifyTransactionValidity(null, 10).status).toBe(
        TransactionValidityStatus.UNKNOWN,
      );
      expect(classifyTransactionValidity(LAST_VALID, -1).status).toBe(
        TransactionValidityStatus.UNKNOWN,
      );
    });
  });

  describe('assertEnvelopeSubmittable', () => {
    it('allows submission just before the boundary', () => {
      expect(() =>
        assertEnvelopeSubmittable(LAST_VALID, LAST_VALID - 1),
      ).not.toThrow();
    });

    it.each([
      ['at', LAST_VALID],
      ['after', LAST_VALID + 1],
    ])('rejects %s the boundary with a stable error code', (_label, latest) => {
      let thrown: unknown;
      try {
        assertEnvelopeSubmittable(LAST_VALID, latest);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(TransactionEnvelopeExpiredException);
      const ex = thrown as TransactionEnvelopeExpiredException;
      expect(ex.getStatus()).toBe(422);
      expect(ex.getResponse()).toMatchObject({
        code: TX_ENVELOPE_EXPIRED,
        lastValidLedger: LAST_VALID,
        latestLedger: latest,
      });
    });

    it('lets UNKNOWN validity through (network remains the arbiter)', () => {
      expect(() => assertEnvelopeSubmittable(null, 50)).not.toThrow();
    });
  });

  describe('boundary derivation', () => {
    it('treats LedgerBounds.maxLedger as exclusive', () => {
      expect(lastValidLedgerFromBounds({ minLedger: 0, maxLedger: 1_001 })).toBe(1_000);
      expect(lastValidLedgerFromBounds({ minLedger: 0, maxLedger: 0 })).toBeNull();
      expect(lastValidLedgerFromBounds(undefined)).toBeNull();
    });

    it('derives the window from the latest ledger', () => {
      expect(lastValidLedgerForWindow(500)).toBe(500 + DEFAULT_VALIDITY_WINDOW_LEDGERS);
      expect(lastValidLedgerForWindow(-1)).toBeNull();
    });
  });
});
