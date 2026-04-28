import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NftMinterService } from './nft-minter.service';
import { NftCollection } from './entities/nft-collection.entity';
import { MintedNft } from './entities/minted-nft.entity';
import { NftMetadata } from './entities/nft-metadata.entity';
import { SorobanService } from '../soroban/soroban.service';
import { MetadataGenerator } from './utils/metadata-generator';
import { IpfsUploader } from './utils/ipfs-uploader';
import { MintNftDto } from './dto/mint-nft.dto';
import { NotFoundException, BadRequestException } from '@nestjs/common';

const mockCollection: NftCollection = {
  id: 'col-uuid',
  name: 'Test Collection',
  symbol: 'TEST',
  contractId: null,
  description: 'Test',
  totalMinted: 0,
  maxSupply: null,
  isActive: true,
  nfts: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMintedNft: MintedNft = {
  id: 'nft-uuid',
  tokenId: 'token-uuid',
  collectionId: 'col-uuid',
  collection: mockCollection,
  ownerId: 'user-uuid',
  ownerWallet: 'GABC123',
  type: 'achievement',
  rarity: 'common',
  metadataUri: 'ipfs://Qm123',
  txHash: null,
  achievementKey: 'first_trade',
  mintedAt: new Date(),
};

describe('NftMinterService', () => {
  let service: NftMinterService;
  let collectionRepo: jest.Mocked<Repository<NftCollection>>;
  let mintedNftRepo: jest.Mocked<Repository<MintedNft>>;
  let metadataRepo: jest.Mocked<Repository<NftMetadata>>;

  const mockSorobanService = { invokeContract: jest.fn() };
  const mockMetadataGenerator = {
    generate: jest.fn().mockReturnValue({
      name: 'Test NFT',
      description: 'desc',
      image: 'ipfs://img',
      type: 'achievement',
      rarity: 'common',
      issuer: 'StellarSwipe',
      issued_at: new Date().toISOString(),
      attributes: [],
    }),
  };
  const mockIpfsUploader = {
    uploadMetadata: jest.fn().mockResolvedValue({ hash: 'Qm123', uri: 'ipfs://Qm123' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NftMinterService,
        { provide: getRepositoryToken(NftCollection), useValue: { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn(), increment: jest.fn() } },
        { provide: getRepositoryToken(MintedNft), useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn(), update: jest.fn() } },
        { provide: getRepositoryToken(NftMetadata), useValue: { findOne: jest.fn(), save: jest.fn(), create: jest.fn() } },
        { provide: SorobanService, useValue: mockSorobanService },
        { provide: MetadataGenerator, useValue: mockMetadataGenerator },
        { provide: IpfsUploader, useValue: mockIpfsUploader },
      ],
    }).compile();

    service = module.get(NftMinterService);
    collectionRepo = module.get(getRepositoryToken(NftCollection));
    mintedNftRepo = module.get(getRepositoryToken(MintedNft));
    metadataRepo = module.get(getRepositoryToken(NftMetadata));
  });

  describe('mintNft', () => {
    const dto: MintNftDto = {
      userId: 'user-uuid',
      ownerWallet: 'GABC123',
      collectionId: 'col-uuid',
      type: 'achievement',
      rarity: 'common',
      achievementKey: 'first_trade',
    };

    it('should mint an NFT successfully', async () => {
      collectionRepo.findOne.mockResolvedValue(mockCollection);
      mintedNftRepo.create.mockReturnValue(mockMintedNft);
      mintedNftRepo.save.mockResolvedValue(mockMintedNft);
      metadataRepo.create.mockReturnValue({} as NftMetadata);
      metadataRepo.save.mockResolvedValue({} as NftMetadata);
      collectionRepo.increment.mockResolvedValue(undefined);

      const result = await service.mintNft(dto);

      expect(result.tokenId).toBeDefined();
      expect(result.metadataUri).toBe('ipfs://Qm123');
      expect(mintedNftRepo.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException when collection not found', async () => {
      collectionRepo.findOne.mockResolvedValue(null);
      await expect(service.mintNft(dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when max supply reached', async () => {
      collectionRepo.findOne.mockResolvedValue({ ...mockCollection, maxSupply: 1, totalMinted: 1 });
      await expect(service.mintNft(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUserNfts', () => {
    it('should return user NFTs', async () => {
      mintedNftRepo.find.mockResolvedValue([mockMintedNft]);
      const result = await service.getUserNfts('user-uuid');
      expect(result).toHaveLength(1);
      expect(result[0].ownerId).toBe('user-uuid');
    });
  });

  describe('getNftMetadata', () => {
    it('should throw NotFoundException when metadata not found', async () => {
      metadataRepo.findOne.mockResolvedValue(null);
      await expect(service.getNftMetadata('bad-token')).rejects.toThrow(NotFoundException);
    });
  });
});
