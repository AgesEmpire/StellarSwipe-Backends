import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SorobanService } from '../soroban/soroban.service';
import { NftCollection } from './entities/nft-collection.entity';
import { MintedNft } from './entities/minted-nft.entity';
import { NftMetadata } from './entities/nft-metadata.entity';
import { MintNftDto } from './dto/mint-nft.dto';
import { NftTransferDto } from './dto/nft-transfer.dto';
import { MetadataGenerator } from './utils/metadata-generator';
import { IpfsUploader } from './utils/ipfs-uploader';
import { NftStandard, NftTransferResult } from './interfaces/nft-standard.interface';
import { NftRarity } from './interfaces/metadata-schema.interface';

@Injectable()
export class NftMinterService {
  private readonly logger = new Logger(NftMinterService.name);

  constructor(
    @InjectRepository(NftCollection)
    private readonly collectionRepo: Repository<NftCollection>,
    @InjectRepository(MintedNft)
    private readonly mintedNftRepo: Repository<MintedNft>,
    @InjectRepository(NftMetadata)
    private readonly metadataRepo: Repository<NftMetadata>,
    private readonly sorobanService: SorobanService,
    private readonly metadataGenerator: MetadataGenerator,
    private readonly ipfsUploader: IpfsUploader,
  ) {}

  async mintNft(dto: MintNftDto): Promise<NftStandard> {
    const collection = await this.collectionRepo.findOne({ where: { id: dto.collectionId, isActive: true } });
    if (!collection) throw new NotFoundException('NFT collection not found');
    if (collection.maxSupply && collection.totalMinted >= collection.maxSupply) {
      throw new BadRequestException('Collection max supply reached');
    }

    const tokenId = uuidv4();
    const rarity: NftRarity = dto.rarity ?? 'common';

    const metadata = this.metadataGenerator.generate({
      type: dto.type,
      name: `${collection.name} #${collection.totalMinted + 1}`,
      description: `StellarSwipe ${dto.type} NFT`,
      rarity,
      issuer: collection.contractId ?? 'StellarSwipe',
      extra: { achievementKey: dto.achievementKey },
    });

    const { hash: ipfsHash, uri: ipfsUri } = await this.ipfsUploader.uploadMetadata(metadata);

    let txHash: string | undefined;
    if (collection.contractId && dto.sourceSecret) {
      try {
        const result = await this.sorobanService.invokeContract(
          collection.contractId,
          'mint',
          [tokenId, dto.ownerWallet, ipfsUri],
          { sourceSecret: dto.sourceSecret },
        );
        txHash = result.hash;
      } catch (err) {
        this.logger.warn(`Soroban mint failed, recording off-chain: ${(err as Error).message}`);
      }
    }

    const [mintedNft] = await Promise.all([
      this.mintedNftRepo.save(
        this.mintedNftRepo.create({
          tokenId,
          collectionId: collection.id,
          ownerId: dto.userId,
          ownerWallet: dto.ownerWallet,
          type: dto.type,
          rarity,
          metadataUri: ipfsUri,
          txHash,
          achievementKey: dto.achievementKey,
        }),
      ),
      this.metadataRepo.save(
        this.metadataRepo.create({ tokenId, metadata, ipfsHash, ipfsUri }),
      ),
      this.collectionRepo.increment({ id: collection.id }, 'totalMinted', 1),
    ]);

    this.logger.log(`Minted NFT ${tokenId} for user ${dto.userId}`);

    return {
      contractId: collection.contractId,
      tokenId: mintedNft.tokenId,
      owner: mintedNft.ownerWallet,
      collectionId: collection.id,
      metadataUri: ipfsUri,
      mintedAt: mintedNft.mintedAt,
      txHash: txHash ?? '',
    };
  }

  async transferNft(dto: NftTransferDto): Promise<NftTransferResult> {
    const nft = await this.mintedNftRepo.findOne({
      where: { tokenId: dto.tokenId, ownerId: dto.fromUserId },
      relations: ['collection'],
    });
    if (!nft) throw new NotFoundException('NFT not found or not owned by sender');

    let txHash = '';
    if (nft.collection?.contractId) {
      const result = await this.sorobanService.invokeContract(
        nft.collection.contractId,
        'transfer',
        [dto.fromWallet, dto.toWallet, dto.tokenId],
        { sourceSecret: dto.sourceSecret },
      );
      txHash = result.hash;
    }

    await this.mintedNftRepo.update(nft.id, { ownerId: dto.toUserId, ownerWallet: dto.toWallet });

    return { success: true, txHash, from: dto.fromWallet, to: dto.toWallet, tokenId: dto.tokenId };
  }

  async getUserNfts(userId: string): Promise<MintedNft[]> {
    return this.mintedNftRepo.find({ where: { ownerId: userId }, relations: ['collection'] });
  }

  async getNftMetadata(tokenId: string): Promise<NftMetadata> {
    const meta = await this.metadataRepo.findOne({ where: { tokenId } });
    if (!meta) throw new NotFoundException('NFT metadata not found');
    return meta;
  }

  async getCollections(): Promise<NftCollection[]> {
    return this.collectionRepo.find({ where: { isActive: true } });
  }

  async createCollection(data: Partial<NftCollection>): Promise<NftCollection> {
    return this.collectionRepo.save(this.collectionRepo.create(data));
  }
}
