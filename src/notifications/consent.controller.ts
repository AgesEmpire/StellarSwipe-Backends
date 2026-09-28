import {
  Controller,
  Get,
  Put,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentService } from './consent.service';
import { UpdateConsentDto, ConsentStateDto } from './dto/consent.dto';

@ApiTags('consent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications/consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get()
  @ApiOperation({ summary: 'Get current consent state for all marketing categories' })
  @ApiResponse({ status: 200, description: 'Consent state across all categories' })
  getConsentState(@Request() req: any): Promise<ConsentStateDto> {
    return this.consentService.getConsentState(req.user.id);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update consent for a specific marketing category' })
  @ApiResponse({ status: 200, description: 'Updated consent state' })
  updateConsent(
    @Request() req: any,
    @Body() dto: UpdateConsentDto,
  ): Promise<ConsentStateDto> {
    return this.consentService.updateConsent(req.user.id, dto);
  }
}
