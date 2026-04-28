import { IsString, IsUUID } from 'class-validator';

export class NftTransferDto {
  @IsString()
  tokenId: string;

  @IsUUID()
  fromUserId: string;

  @IsString()
  fromWallet: string;

  @IsUUID()
  toUserId: string;

  @IsString()
  toWallet: string;

  @IsString()
  sourceSecret: string;
}
