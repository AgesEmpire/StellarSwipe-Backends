import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { SocialExportService } from './social-export.service';
import { SocialExportRequestDto } from './social-export.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('social-export')
@UseGuards(JwtAuthGuard)
export class SocialExportController {
  constructor(private readonly socialExportService: SocialExportService) {}

  @Post(':tradeId')
  async generateExport(
    @Param('tradeId') tradeId: string,
    @Body() dto: SocialExportRequestDto,
  ) {
    return this.socialExportService.generateExport(tradeId, dto);
  }
}
