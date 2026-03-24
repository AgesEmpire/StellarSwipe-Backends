export const KafkaTopics = {
  TRADE_EXECUTED: 'trade.executed',
  TRADE_CANCELLED: 'trade.cancelled',
  TRADE_SCHEDULED: 'trade.scheduled',
  SIGNAL_CREATED: 'signal.created',
  SIGNAL_EXPIRED: 'signal.expired',
  SIGNAL_TRIGGERED: 'signal.triggered',
  USER_REGISTERED: 'user.registered',
  PRICE_UPDATED: 'price.updated',
  SCHEDULE_TRIGGERED: 'schedule.triggered',
  SCHEDULE_EXPIRED: 'schedule.expired',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];
