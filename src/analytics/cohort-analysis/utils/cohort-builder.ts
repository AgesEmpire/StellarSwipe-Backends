import { CohortType } from '../interfaces/cohort-config.interface';

const toDateKey = (date: Date, period: 'day' | 'week' | 'month'): string => {
  const d = new Date(date);
  if (period === 'day') {
    return d.toISOString().slice(0, 10);
  }
  if (period === 'week') {
    const weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = weekStart.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    weekStart.setUTCDate(weekStart.getUTCDate() + diff);
    return weekStart.toISOString().slice(0, 10);
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const buildCohortKey = (params: {
  cohortType: CohortType;
  userCreatedAt: Date;
  firstTradeAt?: Date | null;
  providerId?: string | null;
  period: 'day' | 'week' | 'month';
}): string => {
  const { cohortType, userCreatedAt, firstTradeAt, providerId, period } = params;
  if (cohortType === 'signup_period') {
    return toDateKey(userCreatedAt, period);
  }
  if (cohortType === 'first_trade_period') {
    return firstTradeAt ? toDateKey(firstTradeAt, period) : 'no_first_trade';
  }
  return providerId ?? 'unknown_provider';
};

export const getPeriodDiff = (
  startDate: Date,
  eventDate: Date,
  period: 'day' | 'week' | 'month',
): number => {
  const start = new Date(startDate);
  const event = new Date(eventDate);
  const msDiff = event.getTime() - start.getTime();
  if (period === 'day') {
    return Math.floor(msDiff / (1000 * 60 * 60 * 24));
  }
  if (period === 'week') {
    return Math.floor(msDiff / (1000 * 60 * 60 * 24 * 7));
  }
  return (event.getUTCFullYear() - start.getUTCFullYear()) * 12 + (event.getUTCMonth() - start.getUTCMonth());
};
