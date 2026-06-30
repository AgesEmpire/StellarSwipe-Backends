import { Controller, Post, Get, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FeeBumpService } from './fee-bump.service';
import { FeeBumpDto } from './fee-bump.dto';

@ApiTags('Fee Bump')
@Controller('stellar/fee-bump')
export class FeeBumpController {
  constructor(private readonly feeBumpService: FeeBumpService) {}

  @Post('submit')
  @ApiOperation({ summary: 'Wrap a user-signed inner transaction in a fee-bump and submit' })
  submitFeeBump(@Body() dto: FeeBumpDto) {
    return this.feeBumpService.submitFeeBump(dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get sponsor fee spend stats' })
  getFeeStats() {
    return this.feeBumpService.getSponsorFeeStats();
  }
}
