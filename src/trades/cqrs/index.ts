import { ExecuteTradeHandler } from './commands/handlers/execute-trade.handler';
import { CancelTradeHandler } from './commands/handlers/cancel-trade.handler';
import { GetTradeStatusHandler } from './queries/handlers/get-trade-status.handler';

export * from './commands/execute-trade.command';
export * from './commands/cancel-trade.command';
export * from './queries/get-trade-status.query';
export { ExecuteTradeHandler } from './commands/handlers/execute-trade.handler';
export { CancelTradeHandler } from './commands/handlers/cancel-trade.handler';
export { GetTradeStatusHandler } from './queries/handlers/get-trade-status.handler';

/** All CQRS command/query handlers for the trades module. */
export const TRADE_CQRS_HANDLERS = [
  ExecuteTradeHandler,
  CancelTradeHandler,
  GetTradeStatusHandler,
];
