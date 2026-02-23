import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { CreateFlagDto, UpdateFlagDto } from './dto/create-flag.dto';
import { FlagEvaluationResult } from './dto/evaluate-flag.dto';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flagsService: FeatureFlagsService) {}

  @Post()
  async createFlag(@Body() dto: CreateFlagDto) {
    return this.flagsService.createFlag(dto);
  }

  @Get()
  async getAllFlags() {
    return this.flagsService.getAllFlags();
  }

  @Get(':name')
  async getFlag(@Param('name') name: string) {
    return this.flagsService.getFlag(name);
  }

  @Put(':name')
  async updateFlag(@Param('name') name: string, @Body() dto: UpdateFlagDto) {
    return this.flagsService.updateFlag(name, dto);
  }

  @Delete(':name')
  async deleteFlag(@Param('name') name: string) {
    await this.flagsService.deleteFlag(name);
    return { message: 'Flag deleted successfully' };
  }

  @Get(':name/evaluate')
  async evaluateFlag(
    @Param('name') name: string,
    @Query('userId') userId: string,
  ): Promise<FlagEvaluationResult> {
    return this.flagsService.evaluateFlag(name, userId);
  }

  @Get('user/:userId/assignments')
  async getUserAssignments(@Param('userId') userId: string) {
    return this.flagsService.getUserAssignments(userId);
  }
}
