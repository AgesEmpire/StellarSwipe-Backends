import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SwipeService } from './swipe.service';
import { SwipeIntentDto } from './dto/swipe-intent.dto';
import { OrchestratorResult } from '../services/trade-execution-orchestrator.service';

@Controller('trades/swipe')
export class SwipeController {
  constructor(private readonly swipeService: SwipeService) {}

  /**
   * Unified swipe endpoint — accepts trade intents from gesture, keyboard,
   * or button sources and applies the same validation, risk checks, and
   * Soroban execution as the primary gesture flow.
   *
   * POST /trades/swipe
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async handleSwipe(@Body() dto: SwipeIntentDto): Promise<OrchestratorResult> {
    return this.swipeService.handleSwipe(dto);
  }
}
