import { ArrayMaxSize, ArrayMinSize, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStellarPublicKey } from '../../../common/decorators/is-stellar-address.decorator';

export class WatchAccountsDto {
  @ApiProperty({
    description: 'Account public keys to watch',
    type: [String],
    example: ['GCLWGQPMKXQSPF776IU33AH4PZNOOWNAWGGKVTBQMIC5IMKUNP3E6NVU'],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'publicKeys must contain at least one account' })
  @ArrayMaxSize(100, { message: 'publicKeys must not contain more than 100 accounts' })
  @IsStellarPublicKey({
    each: true,
    message: 'each entry in publicKeys must be a valid Stellar public key (56-char G... address)',
  })
  publicKeys: string[];
}
