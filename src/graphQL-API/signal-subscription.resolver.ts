import { Resolver, Subscription, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { SignalType } from '../types/signal.type';
import { GqlAuthGuard } from '../guards/gql-auth.guard';

const PUB_SUB_SIGNAL_ADDED = 'signalAdded';

@UseGuards(GqlAuthGuard)
@Resolver(() => SignalType)
export class SignalSubscriptionResolver {
  constructor(private readonly pubSub: PubSub) {}

  @Subscription(() => SignalType, {
    description: 'Real-time subscription for new signals',
    filter: (payload, variables) => {
      if (!variables?.filter?.assetPair) return true;
      return payload.signalAdded.assetPair === variables.filter.assetPair;
    },
  })
  signalAdded(
    @Context() context: any,
    @Args('filter', { nullable: true }) filter?: { assetPair?: string },
  ): AsyncIterator<SignalType> {
    return this.pubSub.asyncIterator(PUB_SUB_SIGNAL_ADDED);
  }

  publishSignalAdded(signal: SignalType): void {
    this.pubSub.publish(PUB_SUB_SIGNAL_ADDED, { signalAdded: signal });
  }
}
