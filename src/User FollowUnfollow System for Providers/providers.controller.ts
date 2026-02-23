import {
  Controller,
  Post,
  Delete,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { FollowerService } from './services/follower.service';

/**
 * Assumes req.user.id is populated by a JWT/Auth guard.
 * Attach your AuthGuard globally or per-controller as needed.
 */
@Controller('providers')
export class ProvidersController {
  constructor(private readonly followerService: FollowerService) {}

  // POST /providers/:id/follow
  @Post(':id/follow')
  @HttpCode(HttpStatus.CREATED)
  async follow(
    @Param('id', ParseUUIDPipe) providerId: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const follower = await this.followerService.follow(req.user.id, providerId);
    return {
      message: 'Provider followed successfully.',
      followedAt: follower.followedAt,
    };
  }

  // DELETE /providers/:id/unfollow
  @Delete(':id/unfollow')
  @HttpCode(HttpStatus.OK)
  async unfollow(
    @Param('id', ParseUUIDPipe) providerId: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    await this.followerService.unfollow(req.user.id, providerId);
    return { message: 'Provider unfollowed successfully.' };
  }
}
