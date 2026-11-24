import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TradeFailureCode } from '../errors/trade-failure-codes';

/**
 * OpenAPI schema for trade execution failure responses (#1527).
 *
 * Clients must branch on `code`; `message` is human-readable and may be
 * reworded without notice.
 */
export class TradeFailureResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({
    enum: TradeFailureCode,
    enumName: 'TradeFailureCode',
    description: [
      'Stable machine-readable failure reason:',
      `- ${TradeFailureCode.VALIDATION_FAILED}: request failed validation`,
      `- ${TradeFailureCode.DUPLICATE_TRADE}: a pending trade already exists for the signal`,
      `- ${TradeFailureCode.INSUFFICIENT_BALANCE}: wallet cannot cover amount and fees`,
      `- ${TradeFailureCode.INSUFFICIENT_LIQUIDITY}: market cannot fill the requested size`,
      `- ${TradeFailureCode.SLIPPAGE_EXCEEDED}: price moved beyond slippage tolerance`,
      `- ${TradeFailureCode.RISK_LIMIT_EXCEEDED}: risk or velocity limit hit`,
      `- ${TradeFailureCode.COMPLIANCE_BLOCKED}: blocked by compliance rules`,
      `- ${TradeFailureCode.PROVIDER_REJECTED}: network rejected the transaction`,
      `- ${TradeFailureCode.PROVIDER_UNAVAILABLE}: execution provider unavailable`,
      `- ${TradeFailureCode.TIMEOUT}: execution did not complete in time`,
      `- ${TradeFailureCode.UNKNOWN}: unclassified failure`,
    ].join('\n'),
  })
  code!: TradeFailureCode;

  @ApiProperty({ example: 'Not enough market liquidity to fill this trade.' })
  message!: string;

  @ApiProperty({ description: 'Whether retrying later may succeed' })
  retryable!: boolean;

  @ApiPropertyOptional({ description: 'Trade id when a trade record was created' })
  tradeId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Safe validation messages (validation failures only)',
  })
  errors?: string[];
}
