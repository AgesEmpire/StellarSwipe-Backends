import { ConfigService } from '@nestjs/config';
import { DuplicateDetectorService } from './duplicate-detector.service';
import { calculatePayloadFingerprint } from './utils/hash-calculator';

describe('DuplicateDetectorService', () => {
  let service: DuplicateDetectorService;

  beforeEach(() => {
    service = new DuplicateDetectorService({
      get: jest.fn().mockReturnValue(1_000),
    } as unknown as ConfigService);
  });

  it('computes stable fingerprints for equivalent payloads', () => {
    const left = calculatePayloadFingerprint({
      amount: '25.00',
      destination: 'GDEST',
      memo: { type: 'text', value: 'settlement' },
    });
    const right = calculatePayloadFingerprint({
      memo: { value: 'settlement', type: 'text' },
      destination: 'GDEST',
      amount: '25.00',
    });

    expect(left).toBe(right);
  });

  it('accepts the first transaction submission', () => {
    const result = service.checkTransaction({
      transactionId: 'tx-1',
      accountId: 'acct-1',
      payload: { amount: '10', destination: 'GDEST' },
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('rejects duplicate transactions inside the configured window', () => {
    const now = new Date('2026-05-29T10:00:00.000Z');
    const payload = { amount: '10', destination: 'GDEST' };

    service.checkTransaction({ transactionId: 'tx-1', accountId: 'acct-1', payload }, now);
    const duplicate = service.checkTransaction(
      { transactionId: 'tx-2', accountId: 'acct-1', payload },
      new Date('2026-05-29T10:00:00.500Z'),
    );

    expect(duplicate.accepted).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.reason).toContain('Duplicate transaction payload');
  });

  it('accepts the same payload after the detection window expires', () => {
    const payload = { amount: '10', destination: 'GDEST' };

    service.checkTransaction(
      { transactionId: 'tx-1', accountId: 'acct-1', payload },
      new Date('2026-05-29T10:00:00.000Z'),
    );
    const result = service.checkTransaction(
      { transactionId: 'tx-2', accountId: 'acct-1', payload },
      new Date('2026-05-29T10:00:01.001Z'),
    );

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
  });

  it('does not treat identical payloads from different accounts as duplicates', () => {
    const payload = { amount: '10', destination: 'GDEST' };
    const now = new Date('2026-05-29T10:00:00.000Z');

    service.checkTransaction({ transactionId: 'tx-1', accountId: 'acct-1', payload }, now);
    const result = service.checkTransaction({ transactionId: 'tx-2', accountId: 'acct-2', payload }, now);

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
  });
});
