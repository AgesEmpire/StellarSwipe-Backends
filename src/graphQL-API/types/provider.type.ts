import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class ProviderStatsType {
  @Field(() => Float)
  winRate: number;

  @Field(() => Int)
  totalSignals: number;

  @Field(() => Int)
  activeSignals: number;

  @Field(() => Float)
  avgRiskReward: number;

  @Field(() => Float)
  avgReturn: number;

  @Field(() => Int)
  followers: number;

  @Field(() => Int)
  copiers: number;
}

@ObjectType()
export class ProviderType {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  username?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field({ nullable: true })
  bio?: string;

  @Field(() => Float, { nullable: true })
  winRate?: number;

  @Field(() => Boolean)
  isVerified: boolean;

  @Field(() => Boolean, { nullable: true })
  isStaked?: boolean;

  @Field(() => String, { nullable: true })
  walletAddress?: string;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  updatedAt?: Date;
}

@ObjectType()
export class PaginatedProvidersType {
  @Field(() => [ProviderType])
  items: ProviderType[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Boolean)
  hasNextPage: boolean;
}
