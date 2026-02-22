import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { AchievementsService } from './achievements.service';
import { UserAchievementsResponseDto } from './dto/user-achievements.dto';

// Swap these imports for your actual guards / decorators
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Achievements')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  // ─── Catalogue ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all available achievements / badge definitions' })
  @ApiOkResponse({ description: 'Array of all active achievements' })
  async listAll() {
    return this.achievementsService.getAllAchievements();
  }

  // ─── User profile badges ──────────────────────────────────────────────────

  /**
   * GET /achievements/me
   * Returns the authenticated user's badge collection + in-progress achievements.
   * Replace the hardcoded userId with @CurrentUser() once auth is wired up.
   */
  @Get('me')
  @ApiOperation({ summary: "Get current user's achievements and progress" })
  @ApiOkResponse({ type: UserAchievementsResponseDto })
  async getMyAchievements(
    // @CurrentUser() user: { id: string },
  ): Promise<UserAchievementsResponseDto> {
    const userId = 'REPLACE_WITH_CURRENT_USER_ID'; // ← swap with decorator
    return this.achievementsService.getUserAchievements(userId);
  }

  /**
   * GET /achievements/users/:userId
   * Public profile – another user's earned badges only.
   */
  @Get('users/:userId')
  @ApiOperation({ summary: "Get a specific user's awarded badges (public)" })
  @ApiOkResponse({ type: UserAchievementsResponseDto })
  async getUserAchievements(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserAchievementsResponseDto> {
    return this.achievementsService.getUserAchievements(userId);
  }

  // ─── Retroactive evaluation (admin / internal) ───────────────────────────

  @Post('users/:userId/retroactive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-evaluate achievements retroactively (admin endpoint)',
    description:
      'Pass historical metrics for a user to award any badges they should have earned in the past.',
  })
  async retroactive(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body()
    metrics: {
      tradeCount?: number;
      winStreak?: number;
      signalCount?: number;
      signalCopies?: number;
      maxHoldDays?: number;
      profitableMonth?: boolean;
    },
  ) {
    await this.achievementsService.retroactivelyEvaluate(userId, metrics);
    return { message: 'Retroactive evaluation complete.' };
  }
}
