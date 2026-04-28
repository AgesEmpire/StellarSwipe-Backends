import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class SignalTargetType {
  @Field(() => Float)
  price: number;

  @Field(() => Float, { nullable: true })
  probability?: number;
}

@ObjectType()
export class SignalType {
  @Field(() => ID)
  id: string;

  @Field()
  pair: string;

  @Field()
  type: string; // BUY | SELL | HOLD

  @Field()
  status: string;

  @Field()
  timeframe: string;

  @Field(() => Float)
  entryPrice: number;

  @Field(() => Float)
  stopLoss: number;

  @Field(() => [SignalTargetType])
  targets: SignalTargetType[];

  @Field(() => Float)
  confidence: number;

  @Field(() => Float, { nullable: true })
  riskRewardRatio?: number;

  @Field(() => String, { nullable: true })
  rationale?: string;

  @Field(() => String, { nullable: true })
  providerId?: string;

  // Resolved via DataLoader — not stored directly
  @Field(() => ProviderType, { nullable: true })
  provider?: ProviderType;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  expiresAt?: Date;

  @Field({ nullable: true })
  triggeredAt?: Date;
}

// Forward-declared to avoid circular deps — provider.type.ts holds the real class
// but signal.type.ts needs a reference for the nested field.
@ObjectType()
export class ProviderType {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => Float, { nullable: true })
  winRate?: number;
}

@ObjectType()
export class PaginatedSignalsType {
  @Field(() => [SignalType])
  items: SignalType[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Boolean)
  hasNextPage: boolean;
}
