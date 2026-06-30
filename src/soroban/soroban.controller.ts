import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SimulateContractDto } from './dto/simulate-contract.dto';
import { SimulateContractResponseDto } from './dto/simulate-contract-response.dto';
import { SorobanSimulationService } from './soroban-simulation.service';

@ApiTags('Soroban')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('soroban')
export class SorobanController {
  constructor(
    private readonly simulationService: SorobanSimulationService,
  ) {}

  /**
   * POST /soroban/simulate
   *
   * Runs a Soroban RPC `simulateTransaction` (preflight) for a proposed
   * contract invocation and returns the estimated resource fee, minimum
   * resource fee, simulated result, and ledger footprint **without**
   * broadcasting the transaction.
   *
   * Clients should use the returned `totalFee`, `footprint`, and `auth`
   * values to build and submit the real transaction with the correct
   * resource budget.
   *
   * Error semantics:
   * - HTTP 200 + `success: false` + `simulationError` — the contract itself
   *   would revert (e.g. assertion, insufficient balance)
   * - HTTP 200 + `success: false` + `rpcError` — the Soroban RPC could not
   *   be reached or returned an unexpected protocol response
   */
  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preflight a Soroban contract call (fee estimation)',
    description:
      'Calls Soroban RPC simulateTransaction and returns the estimated ' +
      'resource fee, minimum resource fee, and simulated result/footprint ' +
      'without submitting the transaction on-chain.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Simulation result (check `success` field)',
    type: SimulateContractResponseDto,
  })
  async simulate(
    @Body() dto: SimulateContractDto,
  ): Promise<SimulateContractResponseDto> {
    return this.simulationService.simulate(dto);
  }
}
