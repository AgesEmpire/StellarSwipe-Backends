import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { SignalTemplateService } from './signal-template.service';
import { CreateTemplateDto } from '../dto/create-template.dto';
import { UpdateTemplateDto, UseTemplateDto } from '../dto/use-template.dto';
// Replace with your actual JWT / Auth guard
// import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

@ApiTags('Signal Templates')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('signal-templates')
export class SignalTemplateController {
  constructor(private readonly templateService: SignalTemplateService) {}

  // ─── Provider's own templates ──────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new signal template' })
  @ApiResponse({ status: 201, description: 'Template created' })
  create(@Request() req: any, @Body() dto: CreateTemplateDto) {
    const providerId = req.user?.id ?? 'dev-provider'; // replace with real auth
    return this.templateService.create(providerId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: "List provider's own templates" })
  findMyTemplates(@Request() req: any) {
    const providerId = req.user?.id ?? 'dev-provider';
    return this.templateService.findAllForProvider(providerId);
  }

  @Get('public')
  @ApiOperation({ summary: 'List all public templates (from any provider)' })
  findPublicTemplates() {
    return this.templateService.findPublicTemplates();
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get usage analytics for all my templates' })
  getAnalytics(@Request() req: any) {
    const providerId = req.user?.id ?? 'dev-provider';
    return this.templateService.getUsageAnalytics(providerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single template by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templateService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template (bumps version; past signals unaffected)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  update(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    const providerId = req.user?.id ?? 'dev-provider';
    return this.templateService.update(id, providerId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a template' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  remove(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const providerId = req.user?.id ?? 'dev-provider';
    return this.templateService.softDelete(id, providerId);
  }

  // ─── Template Usage ─────────────────────────────────────────────────────

  @Post('generate')
  @ApiOperation({
    summary:
      'Generate a signal from a template by filling in variable values. Returns signal object — does NOT persist a signal.',
  })
  @ApiResponse({ status: 201, description: 'Generated signal object' })
  generateSignal(@Request() req: any, @Body() dto: UseTemplateDto) {
    const providerId = req.user?.id ?? 'dev-provider';
    return this.templateService.generateSignal(dto, providerId);
  }

  // ─── Template Sharing ───────────────────────────────────────────────────

  @Post(':id/clone')
  @ApiOperation({ summary: "Clone a public template into caller's library" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  cloneTemplate(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const providerId = req.user?.id ?? 'dev-provider';
    return this.templateService.cloneTemplate(id, providerId);
  }
}
