import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CompetitionService } from './competition.service';
import { CreateCompetitionDto } from './dto/create-competition.dto';
import { JoinCompetitionDto } from './dto/join-competition.dto';
import { RecordCompetitionTradeDto } from './dto/record-competition-trade.dto';
import { Competition } from './entities/competition.entity';
import { Participant } from './entities/participant.entity';
import { CompetitionTrade } from './entities/competition-trade.entity';
import { CompetitionLeaderboardDto } from './dto/competition-leaderboard.dto';

@Controller('competitions')
export class CompetitionController {
  constructor(private readonly competitionService: CompetitionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateCompetitionDto): Promise<Competition> {
    return this.competitionService.create(dto);
  }

  @Get('live')
  async listLive(): Promise<Competition[]> {
    return this.competitionService.listLive();
  }

  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string): Promise<Competition> {
    return this.competitionService.findOne(id);
  }

  @Get(':id/leaderboard')
  async leaderboard(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CompetitionLeaderboardDto> {
    return this.competitionService.getLeaderboard(id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.CREATED)
  async join(
    @Param('id', ParseUUIDPipe) competitionId: string,
    @Body() dto: JoinCompetitionDto,
  ): Promise<Participant> {
    return this.competitionService.join(competitionId, dto.userId);
  }

  @Post(':id/trades')
  @HttpCode(HttpStatus.CREATED)
  async recordTrade(
    @Param('id', ParseUUIDPipe) competitionId: string,
    @Body() dto: RecordCompetitionTradeDto,
  ): Promise<CompetitionTrade> {
    return this.competitionService.recordTrade({
      competitionId,
      userId: dto.userId,
      volume: dto.volume,
      realizedPnl: dto.realizedPnl,
      assetPair: dto.assetPair,
      externalTradeId: dto.externalTradeId,
    });
  }
}
