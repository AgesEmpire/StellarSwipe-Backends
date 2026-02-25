export { ProductAnalyticsModule } from './product-analytics.module';
export { ProductAnalyticsService } from './product-analytics.service';
export {
  AnalyticsInterceptor,
  TrackEvent,
} from './interceptors/analytics.interceptor';
export { ANALYTICS_EVENTS, FUNNELS, COHORTS } from './events/event-definitions';
export type {
  AnalyticsEventName,
  UserProperties,
  TradeExecutedProperties,
  SignalViewedProperties,
  //   TradeOptions,
} from './events/event-definitions';
