import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NftMinterService } from './nft-minter.service';
import { MintNftDto } from './dto/mint-nft.dto';
import { NftTransferDto } from './dto/nft-transfer.dto';

@Controller('nft')
export class NftController {
  constructor(private readonly nftMinterService: NftMinterService) {}

  @Get('collections')
  getCollections() {
    return this.nftMinterService.getCollections();
  }

  @Post('collections')
  createCollection(@Body() body: { name: string; symbol: string; contractId?: string; maxSupply?: number }) {
    return this.nftMinterService.createCollection(body);
  }

  @Post('mint')
  @HttpCode(HttpStatus.CREATED)
  mint(@Body() dto: MintNftDto) {
    return this.nftMinterService.mintNft(dto);
  }

  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  transfer(@Body() dto: NftTransferDto) {
    return this.nftMinterService.transferNft(dto);
  }

  @Get('user/:userId')
  getUserNfts(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.nftMinterService.getUserNfts(userId);
  }

  @Get('metadata/:tokenId')
  getMetadata(@Param('tokenId') tokenId: string) {
    return this.nftMinterService.getNftMetadata(tokenId);
  }
}
