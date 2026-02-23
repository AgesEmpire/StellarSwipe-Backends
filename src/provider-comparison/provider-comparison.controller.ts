import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ProviderComparisonService } from './services/provider-comparison.service';
import { CompareProvidersDto } from './dto/compare-providers.dto';
import { ComparisonResultDto } from './dto/comparison-result.dto';

@Controller('providers')
export class ProviderComparisonController {
  constructor(
    private readonly comparisonService: ProviderComparisonService,
  ) {}

  @Post('compare')
  async compareProviders(
    @Body() dto: CompareProvidersDto,
  ): Promise<ComparisonResultDto> {
    return this.comparisonService.compareProviders(dto);
  }
}
