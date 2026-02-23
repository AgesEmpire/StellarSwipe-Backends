import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ContentService } from './content.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ContentQueryDto } from './dto/content-query.dto';
import { CreateEngagementDto } from './dto/engagement.dto';
import {
  ContentResponseDto,
  ContentListResponseDto,
} from './dto/content-response.dto';

@Controller('providers')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Post('content')
  async create(
    @Request() req,
    @Body() createContentDto: CreateContentDto,
  ): Promise<ContentResponseDto> {
    const providerId = req.user?.id || 'mock-provider-id'; // Replace with actual auth
    return this.contentService.create(providerId, createContentDto);
  }

  @Get('content')
  async findAll(
    @Query() query: ContentQueryDto,
  ): Promise<ContentListResponseDto> {
    return this.contentService.findAll(query);
  }

  @Get(':id/content')
  async findByProvider(
    @Param('id') providerId: string,
  ): Promise<ContentResponseDto[]> {
    return this.contentService.findByProvider(providerId);
  }

  @Get('content/:id')
  async findOne(@Param('id') id: string): Promise<ContentResponseDto> {
    return this.contentService.findOne(id);
  }

  @Put('content/:id')
  async update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateContentDto: UpdateContentDto,
  ): Promise<ContentResponseDto> {
    const providerId = req.user?.id || 'mock-provider-id'; // Replace with actual auth
    return this.contentService.update(id, providerId, updateContentDto);
  }

  @Delete('content/:id')
  async delete(@Request() req, @Param('id') id: string): Promise<void> {
    const providerId = req.user?.id || 'mock-provider-id'; // Replace with actual auth
    return this.contentService.delete(id, providerId);
  }

  @Post('content/:id/engage')
  async engage(
    @Request() req,
    @Param('id') contentId: string,
    @Body() engagementDto: CreateEngagementDto,
  ): Promise<{ message: string }> {
    const userId = req.user?.id || 'mock-user-id'; // Replace with actual auth
    await this.contentService.recordEngagement(
      contentId,
      userId,
      engagementDto,
    );
    return { message: 'Engagement recorded successfully' };
  }

  @Get('content/tags/popular')
  async getPopularTags(): Promise<string[]> {
    return this.contentService.getPopularTags();
  }
}
