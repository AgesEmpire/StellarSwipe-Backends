import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class PositionType {
  @Field(() => ID)
  id: string;

  @Field()
  pair: string;

  @Field(() => Float)
  size: number;

  @Field(() => Float)
  avgEntryPrice: number;

  @Field(() => Float)
  currentPrice: number;

  @Field(() => Float)
  unrealisedPnl: number;

  @Field(() => Float)
  unrealisedPnlPercent: number;

  @Field(() => Float)
  notionalValue: number;

  @Field()
  side: string;

  @Field()
  openedAt: Date;
}

@ObjectType()
export class AllocationItemType {
  @Field()
  pair: string;

  @Field(() => Float)
  percentage: number;

  @Field(() => Float)
  valueUsd: number;
}

@ObjectType()
export class PortfolioPerformanceType {
  @Field(() => Float)
  dailyPnl: number;

  @Field(() => Float)
  weeklyPnl: number;

  @Field(() => Float)
  monthlyPnl: number;

  @Field(() => Float)
  allTimePnl: number;

  @Field(() => Float)
  dailyPnlPercent: number;

  @Field(() => Float)
  weeklyPnlPercent: number;

  @Field(() => Float)
  monthlyPnlPercent: number;
}

@ObjectType()
export class PortfolioType {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field(() => Float)
  totalValueUsd: number;

  @Field(() => Float)
  availableBalanceUsd: number;

  @Field(() => Float)
  usedMarginUsd: number;

  @Field(() => [PositionType])
  openPositions: PositionType[];

  @Field(() => Int)
  openPositionCount: number;

  @Field(() => [AllocationItemType])
  allocation: AllocationItemType[];

  @Field(() => PortfolioPerformanceType)
  performance: PortfolioPerformanceType;

  @Field()
  updatedAt: Date;
}
