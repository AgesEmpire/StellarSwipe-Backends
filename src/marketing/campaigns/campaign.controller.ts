import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Request,
} from '@nestjs/common';
import { CampaignManagerService } from './campaign-manager.service';
import { CreateCampaignDto, UpdateCampaignDto, CampaignQueryDto } from './dto/create-campaign.dto';
import { CreateCampaignTargetDto } from './dto/campaign-target.dto';
import { CampaignMetricsQueryDto } from './dto/campaign-metrics.dto';

@Controller('marketing/campaigns')
export class CampaignController {
  constructor(private readonly campaignManager: CampaignManagerService) {}

  @Post()
  create(@Body() dto: CreateCampaignDto, @Request() req: any) {
    return this.campaignManager.create(dto, req.user?.id ?? 'system');
  }

  @Get()
  findAll(@Query() query: CampaignQueryDto) {
    return this.campaignManager.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.campaignManager.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignManager.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.campaignManager.delete(id);
  }

  @Post(':id/targets')
  addTarget(@Param('id') id: string, @Body() dto: CreateCampaignTargetDto) {
    return this.campaignManager.addTarget(id, dto);
  }

  @Delete(':id/targets/:targetId')
  removeTarget(@Param('id') id: string, @Param('targetId') targetId: string) {
    return this.campaignManager.removeTarget(id, targetId);
  }

  @Get(':id/metrics')
  getMetrics(@Param('id') id: string, @Query() query: CampaignMetricsQueryDto) {
    return this.campaignManager.getMetrics(id, query);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.campaignManager.activate(id);
  }

  @Patch(':id/pause')
  pause(@Param('id') id: string) {
    return this.campaignManager.pause(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.campaignManager.cancel(id);
  }
}
