import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RegimeDetectorService } from './regime-detector.service';
import { DetectRegimeDto, RegimeResponseDto } from './dto/regime-detection.dto';

@ApiTags('Market Intelligence')
@Controller('market-intelligence/regime')
export class RegimeController {
  constructor(private readonly regimeDetectorService: RegimeDetectorService) {}

  @Get()
  @ApiOperation({ summary: 'Get current market regime for an asset pair' })
  @ApiResponse({ status: 200, type: RegimeResponseDto })
  async getCurrentRegime(@Query() dto: DetectRegimeDto): Promise<RegimeResponseDto> {
    return this.regimeDetectorService.detectRegime(dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get historical market regime transitions' })
  async getRegimeHistory(@Query('assetPair') assetPair: string) {
    // This would typically call a service method to fetch historical transitions
    // For now, we'll return a placeholder or implement the method in the service if needed
    return { assetPair, history: [] }; 
  }
}
