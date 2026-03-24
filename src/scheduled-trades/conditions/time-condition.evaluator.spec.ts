import { TimeConditionEvaluator } from './time-condition.evaluator';
import { RecurrenceType } from '../entities/scheduled-trade.entity';

describe('TimeConditionEvaluator', () => {
  let evaluator: TimeConditionEvaluator;

  beforeEach(() => {
    evaluator = new TimeConditionEvaluator();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isTimeReached', () => {
    it('should return true when executeAt is in the past', () => {
      jest.useFakeTimers();
      const now = new Date('2026-03-24T12:00:00.000Z');
      jest.setSystemTime(now);

      const past = new Date('2026-03-24T11:00:00.000Z');
      expect(evaluator.isTimeReached(past)).toBe(true);
    });

    it('should return true when executeAt equals current time', () => {
      jest.useFakeTimers();
      const now = new Date('2026-03-24T12:00:00.000Z');
      jest.setSystemTime(now);

      expect(evaluator.isTimeReached(new Date(now))).toBe(true);
    });

    it('should return false when executeAt is in the future', () => {
      jest.useFakeTimers();
      const now = new Date('2026-03-24T12:00:00.000Z');
      jest.setSystemTime(now);

      const future = new Date('2026-03-24T13:00:00.000Z');
      expect(evaluator.isTimeReached(future)).toBe(false);
    });
  });

  describe('isRecurrenceTime', () => {
    // Use a fixed local time of 09:00 by working with timestamps
    let fixedNow: Date;
    let fixedHour: number;
    let fixedMinute: number;

    beforeEach(() => {
      // Build fixedNow before enabling fake timers
      const base = new Date();
      base.setHours(9, 0, 0, 0);
      fixedNow = base;
      fixedHour = base.getHours();    // always 9
      fixedMinute = base.getMinutes(); // always 0

      jest.useFakeTimers();
      jest.setSystemTime(fixedNow.getTime());
    });

    it('should return false when current hour/minute does not match recurTime', () => {
      expect(
        evaluator.isRecurrenceTime('10:30', RecurrenceType.DAILY),
      ).toBe(false);
    });

    it('should return true when time matches and no lastExecutedAt', () => {
      const recurTime = `${String(fixedHour).padStart(2, '0')}:${String(fixedMinute).padStart(2, '0')}`;
      expect(
        evaluator.isRecurrenceTime(recurTime, RecurrenceType.DAILY),
      ).toBe(true);
    });

    it('should return true for DAILY when last executed more than 24h ago', () => {
      const lastExecuted = new Date(fixedNow.getTime() - 25 * 60 * 60 * 1000);
      const recurTime = `${String(fixedHour).padStart(2, '0')}:${String(fixedMinute).padStart(2, '0')}`;
      expect(
        evaluator.isRecurrenceTime(recurTime, RecurrenceType.DAILY, lastExecuted),
      ).toBe(true);
    });

    it('should return false for DAILY when last executed less than 24h ago', () => {
      const lastExecuted = new Date(fixedNow.getTime() - 23 * 60 * 60 * 1000);
      const recurTime = `${String(fixedHour).padStart(2, '0')}:${String(fixedMinute).padStart(2, '0')}`;
      expect(
        evaluator.isRecurrenceTime(recurTime, RecurrenceType.DAILY, lastExecuted),
      ).toBe(false);
    });

    it('should return true for WEEKLY when last executed more than 7 days ago', () => {
      const lastExecuted = new Date(fixedNow.getTime() - 8 * 24 * 60 * 60 * 1000);
      const recurTime = `${String(fixedHour).padStart(2, '0')}:${String(fixedMinute).padStart(2, '0')}`;
      expect(
        evaluator.isRecurrenceTime(recurTime, RecurrenceType.WEEKLY, lastExecuted),
      ).toBe(true);
    });

    it('should return false for WEEKLY when last executed less than 7 days ago', () => {
      const lastExecuted = new Date(fixedNow.getTime() - 6 * 24 * 60 * 60 * 1000);
      const recurTime = `${String(fixedHour).padStart(2, '0')}:${String(fixedMinute).padStart(2, '0')}`;
      expect(
        evaluator.isRecurrenceTime(recurTime, RecurrenceType.WEEKLY, lastExecuted),
      ).toBe(false);
    });

    it('should return false for unknown recurrence type when lastExecutedAt is set', () => {
      const lastExecuted = new Date(fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000);
      const recurTime = `${String(fixedHour).padStart(2, '0')}:${String(fixedMinute).padStart(2, '0')}`;
      expect(
        evaluator.isRecurrenceTime(
          recurTime,
          'monthly' as RecurrenceType,
          lastExecuted,
        ),
      ).toBe(false);
    });
  });
});
