import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClaimableBalanceService } from './claimable-balance.service';
import {
  CreateClaimableBalanceDto,
  ClaimBalanceDto,
  ReclaimExpiredBalanceDto,
} from './claimable-balance.dto';

@ApiTags('Claimable Balances')
@Controller('stellar/claimable-balances')
export class ClaimableBalanceController {
  constructor(private readonly claimableBalanceService: ClaimableBalanceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a claimable balance for a reward payout' })
  create(@Body() dto: CreateClaimableBalanceDto) {
    return this.claimableBalanceService.createClaimableBalance(dto);
  }

  @Post('claim')
  @ApiOperation({ summary: 'Claim an outstanding claimable balance' })
  claim(@Body() dto: ClaimBalanceDto) {
    return this.claimableBalanceService.claimBalance(dto);
  }

  @Post('reclaim')
  @ApiOperation({ summary: 'Reclaim an expired claimable balance back to the sponsor' })
  reclaim(@Body() dto: ReclaimExpiredBalanceDto) {
    return this.claimableBalanceService.reclaimExpiredBalance(dto);
  }
}
