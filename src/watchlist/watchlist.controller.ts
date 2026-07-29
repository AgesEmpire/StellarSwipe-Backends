import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WatchlistService } from './watchlist.service';
import { WatchlistActivityQueryDto } from './dto/watchlist-activity-query.dto';

@ApiTags('Watchlist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Post(':traderId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a trader to the watchlist' })
  @ApiParam({ name: 'traderId', description: 'UUID of the trader to watch' })
  @ApiResponse({ status: 201, description: 'Trader added (or already present — idempotent)' })
  async add(
    @Param('traderId', ParseUUIDPipe) traderId: string,
    @Request() req: { user: { id: string } },
  ) {
    const entry = await this.watchlistService.add(req.user.id, traderId);
    return { traderId: entry.traderId, addedAt: entry.addedAt };
  }

  @Delete(':traderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a trader from the watchlist' })
  @ApiParam({ name: 'traderId', description: 'UUID of the trader to remove' })
  @ApiResponse({ status: 204, description: 'Trader removed (no-op if not present)' })
  async remove(
    @Param('traderId', ParseUUIDPipe) traderId: string,
    @Request() req: { user: { id: string } },
  ): Promise<void> {
    await this.watchlistService.remove(req.user.id, traderId);
  }

  @Get()
  @ApiOperation({ summary: 'List all traders on the watchlist' })
  @ApiResponse({ status: 200, description: 'Array of watchlist entries' })
  async list(@Request() req: { user: { id: string } }) {
    return this.watchlistService.list(req.user.id);
  }

  @Get('activity')
  @ApiOperation({
    summary: 'Paginated signal activity feed for watchlisted traders',
    description:
      'Returns recent signals from traders on the watchlist. ' +
      'Independent of the copy-trading swipe feed — signals here are never auto-copied.',
  })
  @ApiResponse({ status: 200, description: 'Paginated signal activity' })
  async activity(
    @Query() query: WatchlistActivityQueryDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.watchlistService.getActivity(req.user.id, query);
  }
}
