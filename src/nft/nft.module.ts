import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NftMinterService } from './nft-minter.service';
import { NftController } from './nft.controller';
import { NftCollection } from './entities/nft-collection.entity';
import { MintedNft } from './entities/minted-nft.entity';
import { NftMetadata } from './entities/nft-metadata.entity';
import { MetadataGenerator } from './utils/metadata-generator';
import { IpfsUploader } from './utils/ipfs-uploader';
import { SorobanModule } from '../soroban/soroban.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NftCollection, MintedNft, NftMetadata]),
    SorobanModule,
  ],
  controllers: [NftController],
  providers: [NftMinterService, MetadataGenerator, IpfsUploader],
  exports: [NftMinterService],
})
export class NftModule {}
