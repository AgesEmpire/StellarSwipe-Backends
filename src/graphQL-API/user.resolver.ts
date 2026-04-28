import { Resolver, Query, Args, ID, ObjectType, Field } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';

import { GqlAuthGuard } from '../guards/gql-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from '../../users/users.service';

/** Lightweight user type — mirrors what the JWT payload exposes. */
@ObjectType()
export class GqlUserType {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field({ nullable: true })
  username?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field()
  role: string;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  updatedAt?: Date;
}

@UseGuards(GqlAuthGuard)
@Resolver(() => GqlUserType)
export class UserResolver {
  private readonly logger = new Logger(UserResolver.name);

  constructor(private readonly usersService: UsersService) {}

  // ─── Queries ───────────────────────────────────────────────────────────────

  @Query(() => GqlUserType, { nullable: true, description: 'Profile of the authenticated user' })
  async me(@CurrentUser() user: { id: string }): Promise<GqlUserType | null> {
    this.logger.debug(`me query — userId: ${user.id}`);
    return this.usersService.findById(user.id);
  }

  @Query(() => GqlUserType, {
    nullable: true,
    description: 'Public profile lookup by user ID (admin only)',
  })
  async userById(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() currentUser: { id: string; role: string },
  ): Promise<GqlUserType | null> {
    if (currentUser.role !== 'admin') return null;
    return this.usersService.findById(id);
  }
}
