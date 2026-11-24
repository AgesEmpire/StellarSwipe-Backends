import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  PublicAttribution,
  SignalSourceAttributionService,
} from './signal-source-attribution.service';

@ApiTags('signals')
@Controller('signals/:signalId/attribution')
export class SignalSourceAttributionController {
  constructor(private readonly service: SignalSourceAttributionService) {}

  @Get()
  @ApiOperation({ summary: 'Public source attribution for a signal version (latest by default)' })
  @ApiQuery({ name: 'version', required: false, type: Number })
  get(
    @Param('signalId', ParseUUIDPipe) signalId: string,
    @Query('version', new ParseIntPipe({ optional: true })) version?: number,
  ): Promise<PublicAttribution> {
    return this.service.getPublicAttribution(signalId, version);
  }
}
