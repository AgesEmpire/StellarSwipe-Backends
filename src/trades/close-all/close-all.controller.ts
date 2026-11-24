import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CloseAllPositionsService } from './close-all.service';
import { CloseAllConfirmationResult, CloseAllPreview } from './close-all.types';

export class ConfirmCloseAllDto {
  @IsString()
  @MinLength(10)
  previewToken!: string;
}

interface AuthedRequest {
  user?: { id?: string; sub?: string; roles?: string[] };
}

/** Close-all positions: preview first, then confirm against that preview (#1537). */
@ApiTags('portfolio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('portfolio/positions/close-all')
export class CloseAllPositionsController {
  constructor(private readonly closeAll: CloseAllPositionsService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview closing all positions (no side effects)',
    description:
      'Lists eligible and ineligible positions with estimated exit price, slippage and fees, and returns a short-lived signed previewToken.',
  })
  preview(@Req() req: AuthedRequest): Promise<CloseAllPreview> {
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    return this.closeAll.preview(userId, { id: userId, roles: req.user?.roles });
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a close-all preview',
    description:
      '410 if the preview expired; 409 CLOSE_ALL_PREVIEW_STALE if positions or prices changed materially. Idempotent: confirming the same preview again returns the original result with replayed=true.',
  })
  confirm(@Body() dto: ConfirmCloseAllDto, @Req() req: AuthedRequest): Promise<CloseAllConfirmationResult> {
    const userId = String(req.user?.id ?? req.user?.sub ?? '');
    return this.closeAll.confirm(userId, dto.previewToken, { id: userId, roles: req.user?.roles });
  }
}
