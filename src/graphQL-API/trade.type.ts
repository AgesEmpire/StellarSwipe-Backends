import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';
import { AuthorizedField } from './plugins/field-auth.plugin';

@ObjectType()
export class TradeType {
  @Field(() => ID)
  id: string;

  @Field()
  pair: string;

  @Field()
  side: string; // BUY | SELL

  @Field()
  status: string;

  @Field(() => Float)
  entryPrice: number;

  @Field(() => Float, { nullable: true })
  exitPrice?: number;

  @Field(() => Float)
  size: number;

  @AuthorizedField(() => Float, {
    nullable: true,
    description: 'Realised PnL in USD',
    permissions: ['trades:read-pnl'],
  })
  pnl?: number;

  @AuthorizedField(() => Float, {
    nullable: true,
    description: 'PnL as a percentage of position',
    permissions: ['trades:read-pnl'],
  })
  pnlPercent?: number;

  @AuthorizedField(() => Float, {
    nullable: true,
    permissions: ['trades:read-fees'],
  })
  fees?: number;

  @Field(() => String, { nullable: true })
  signalId?: string;

  @AuthorizedField(() => String, {
    permissions: ['trades:read-user-id'],
  })
  userId: string;

  @Field()
  openedAt: Date;

  @Field({ nullable: true })
  closedAt?: Date;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  updatedAt?: Date;
}

@ObjectType()
export class TradeSummaryType {
  @Field(() => Int)
  totalTrades: number;

  @Field(() => Int)
  winningTrades: number;

  @Field(() => Int)
  losingTrades: number;

  @Field(() => Float)
  winRate: number;

  @Field(() => Float)
  totalPnl: number;

  @Field(() => Float)
  totalFees: number;

  @Field(() => Float)
  avgPnlPerTrade: number;

  @Field(() => Float)
  largestWin: number;

  @Field(() => Float)
  largestLoss: number;
}

@ObjectType()
export class PaginatedTradesType {
  @Field(() => [TradeType])
  items: TradeType[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Boolean)
  hasNextPage: boolean;
}
