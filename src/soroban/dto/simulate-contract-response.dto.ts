import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SimulateContractResponseDto {
  @ApiProperty({ description: 'Whether the simulation succeeded without contract-level errors' })
  success!: boolean;

  @ApiPropertyOptional({ description: 'Estimated resource fee in stroops' })
  resourceFee?: string;

  @ApiPropertyOptional({ description: 'Minimum resource fee in stroops (lower bound)' })
  minResourceFee?: string;

  @ApiPropertyOptional({ description: 'Recommended inclusion (base) fee in stroops' })
  inclusionFee?: string;

  @ApiPropertyOptional({ description: 'Total estimated fee (inclusionFee + resourceFee) in stroops' })
  totalFee?: string;

  @ApiPropertyOptional({ description: 'Simulated contract return value (native JS representation)' })
  result?: unknown;

  @ApiPropertyOptional({
    description: 'Ledger footprint data needed to build the real transaction',
  })
  footprint?: {
    readOnly?: string[];
    readWrite?: string[];
  };

  /**
   * Auth entries required by the simulation — pass them back when building
   * the real transaction to avoid a second preflight round-trip.
   */
  @ApiPropertyOptional({
    description: 'Authorization entries required by the contract call (base64 XDR)',
    isArray: true,
  })
  auth?: string[];

  /** Present only when success=false */
  @ApiPropertyOptional({ description: 'Contract-level revert message (simulation error)' })
  simulationError?: string;

  /** Present only when the RPC itself could not be reached / returned an unexpected response */
  @ApiPropertyOptional({ description: 'RPC connectivity or protocol error (distinct from contract revert)' })
  rpcError?: string;
}
