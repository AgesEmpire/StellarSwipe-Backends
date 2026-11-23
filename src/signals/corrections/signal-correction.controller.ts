import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  SignalCorrectedEventPayload,
  SignalCorrectionService,
} from './signal-correction.service';
import { SignalCorrectionEvent } from './signal-correction-event.entity';

export class CorrectSignalDto {
  @ApiProperty({ description: 'Why the published signal is being corrected' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() entryPrice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() targetPrice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() stopLossPrice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) rationale?: string;
}

@ApiTags('signals')
@Controller('signals/:signalId/corrections')
export class SignalCorrectionController {
  constructor(private readonly service: SignalCorrectionService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Correct a published signal (emits signal.corrected)' })
  correct(
    @Param('signalId', ParseUUIDPipe) signalId: string,
    @Body() dto: CorrectSignalDto,
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SignalCorrectedEventPayload> {
    return this.service.correct(signalId, req.user.id, { ...dto, idempotencyKey });
  }

  @Get()
  @ApiOperation({ summary: 'List correction events in order (replay from afterSequence)' })
  list(
    @Param('signalId', ParseUUIDPipe) signalId: string,
    @Query('afterSequence', new ParseIntPipe({ optional: true })) afterSequence?: number,
  ): Promise<SignalCorrectionEvent[]> {
    return this.service.listCorrections(signalId, afterSequence ?? 0);
  }
}
