import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { PathPaymentService } from './path-payment.service';
import { PathPaymentRequestDto } from './dto/path-payment.dto';

@ApiTags('Stellar Path Payments')
@Controller('stellar/path-payments')
export class PathPaymentController {
  constructor(private readonly pathPaymentService: PathPaymentService) {}

  /** Preview available paths without executing a transaction */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Discover and rank available payment paths' })
  async preview(@Body() dto: PathPaymentRequestDto) {
    return this.pathPaymentService.previewPaths(dto);
  }

  /**
   * Execute a path payment.
   * The signing secret is passed via the X-Signing-Secret header so it
   * is never logged in request bodies. Use a secrets vault in production.
   */
  @Post('execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a path payment with best-path selection' })
  @ApiHeader({
    name: 'X-Signing-Secret',
    description: 'Stellar account secret key for signing (never store in body)',
  })
  async execute(
    @Body() dto: PathPaymentRequestDto,
    @Headers('X-Signing-Secret') signingSecret: string,
  ) {
    return this.pathPaymentService.executePathPayment(dto, signingSecret);
  }
}
