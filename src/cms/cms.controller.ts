import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { ContentManagerService } from './content-manager.service';
import { CreateContentDto } from './dto/create-content.dto';
import { TranslateContentDto } from './dto/translate-content.dto';
import { PublishContentDto } from './dto/publish-content.dto';
import { ContentQueryDto } from './dto/content-query.dto';

@Controller('cms')
export class CmsController {
  constructor(private readonly contentManager: ContentManagerService) {}

  @Post('content')
  create(@Body() dto: CreateContentDto) {
    return this.contentManager.create(dto);
  }

  @Get('content')
  findAll(@Query() query: ContentQueryDto) {
    return this.contentManager.findAll(query);
  }

  @Get('content/:slug')
  findBySlug(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.contentManager.findBySlug(slug, locale);
  }

  @Get('content/:slug/html')
  getAsHtml(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.contentManager.getContentAsHtml(slug, locale);
  }

  @Put('content/:id/publish')
  publish(
    @Param('id') id: string,
    @Body() dto: PublishContentDto,
    @Query('userId') userId: string,
  ) {
    return this.contentManager.publish(id, userId, dto.changeNotes);
  }

  @Put('content/:id/archive')
  archive(@Param('id') id: string) {
    return this.contentManager.archive(id);
  }

  @Post('content/:id/translations')
  addTranslation(@Param('id') id: string, @Body() dto: TranslateContentDto) {
    return this.contentManager.addTranslation(id, dto);
  }

  @Put('translations/:translationId/approve')
  approveTranslation(
    @Param('translationId') translationId: string,
    @Query('reviewerId') reviewerId: string,
  ) {
    return this.contentManager.approveTranslation(translationId, reviewerId);
  }

  @Get('content/:id/versions')
  getVersionHistory(@Param('id') id: string) {
    return this.contentManager.getVersionHistory(id);
  }
}
