import { IsString, IsNotEmpty, Matches, IsOptional, IsNumberString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FeeBumpDto {
  @ApiProperty({ description: 'Base64-encoded XDR of the inner transaction (user-signed)' })
  @IsString()
  @IsNotEmpty()
  innerTransactionXdr: string;

  @ApiPropertyOptional({ description: 'Fee per operation in stroops (defaults to network base fee * 10)' })
  @IsOptional()
  @IsNumberString()
  feePerOperation?: string;
}

export class FeeBumpResultDto {
  hash: string;
  sponsorAccount: string;
  feeCharged: string;
}
