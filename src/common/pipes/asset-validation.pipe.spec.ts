import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AssetValidationPipe } from './asset-validation.pipe';
import { AssetsService } from '../../assets/assets.service';
import { AssetDto } from '../../assets/dto/asset-price.dto';

describe('AssetValidationPipe', () => {
  let pipe: AssetValidationPipe;
  let assetsService: jest.Mocked<AssetsService>;
  let cacheManager: jest.Mocked<any>;

  const mockAssets: AssetDto[] = [
    {
      id: '1',
      code: 'XLM',
      issuer: null,
      name: 'Stellar Lumens',
      description: 'Native asset',
      logoUrl: 'https://example.com/xlm.png',
      isVerified: true,
      isPopular: true,
      type: 'NATIVE' as any,
      createdAt: new Date(),
    },
    {
      id: '2',
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47GDEVS2HW6LBX4KIFNDUYAPG',
      name: 'USDC',
      description: 'USD Coin',
      logoUrl: 'https://example.com/usdc.png',
      isVerified: true,
      isPopular: true,
      type: 'ISSUED' as any,
      createdAt: new Date(),
    },
    {
      id: '3',
      code: 'AQUA',
      issuer: 'GBNZILSTVQSRDG5OKDJVVVX3VS3ZGGF3BYRTOJSQHXLWMCBOGB2CBJBJ',
      name: 'AQUA',
      description: 'AQUA Token',
      logoUrl: 'https://example.com/aqua.png',
      isVerified: true,
      isPopular: true,
      type: 'ISSUED' as any,
      createdAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const mockAssetsService = {
      getAllAssets: jest.fn().mockResolvedValue(mockAssets),
    };

    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetValidationPipe,
        {
          provide: AssetsService,
          useValue: mockAssetsService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCache,
        },
      ],
    }).compile();

    pipe = module.get<AssetValidationPipe>(AssetValidationPipe);
    assetsService = module.get(AssetsService) as jest.Mocked<AssetsService>;
    cacheManager = module.get(CACHE_MANAGER);
  });

  describe('supported asset codes', () => {
    it('should pass when baseAsset and counterAsset are both supported', async () => {
      cacheManager.get.mockResolvedValue(null);

      const dto = {
        baseAsset: 'XLM',
        counterAsset: 'USDC',
      };

      const result = await pipe.transform(dto, {} as any);

      expect(result).toEqual(dto);
      expect(assetsService.getAllAssets).toHaveBeenCalled();
      expect(cacheManager.set).toHaveBeenCalledWith(
        'supported_assets_registry',
        ['XLM', 'USDC', 'AQUA'],
        5 * 60 * 1000,
      );
    });

    it('should pass when assetCode is supported', async () => {
      cacheManager.get.mockResolvedValue(['XLM', 'USDC', 'AQUA']);

      const dto = {
        assetCode: 'USDC',
      };

      const result = await pipe.transform(dto, {} as any);

      expect(result).toEqual(dto);
      expect(assetsService.getAllAssets).not.toHaveBeenCalled();
    });

    it('should use cached supported assets on subsequent calls', async () => {
      const cachedAssets = ['XLM', 'USDC', 'AQUA'];
      cacheManager.get.mockResolvedValue(cachedAssets);

      const dto = {
        baseAsset: 'XLM',
        counterAsset: 'USDC',
      };

      await pipe.transform(dto, {} as any);

      expect(cacheManager.get).toHaveBeenCalledWith('supported_assets_registry');
      expect(assetsService.getAllAssets).not.toHaveBeenCalled();
    });
  });

  describe('unsupported asset codes', () => {
    it('should throw when baseAsset is not supported', async () => {
      cacheManager.get.mockResolvedValue(null);

      const dto = {
        baseAsset: 'INVALID_ASSET',
        counterAsset: 'XLM',
      };

      await expect(pipe.transform(dto, {} as any)).rejects.toThrow(BadRequestException);
    });

    it('should throw when counterAsset is not supported', async () => {
      cacheManager.get.mockResolvedValue(['XLM', 'USDC', 'AQUA']);

      const dto = {
        baseAsset: 'XLM',
        counterAsset: 'UNKNOWN_ASSET',
      };

      await expect(pipe.transform(dto, {} as any)).rejects.toThrow(BadRequestException);
    });

    it('should throw when assetCode is not supported', async () => {
      cacheManager.get.mockResolvedValue(['XLM', 'USDC', 'AQUA']);

      const dto = {
        assetCode: 'FAKE_ASSET',
      };

      await expect(pipe.transform(dto, {} as any)).rejects.toThrow(BadRequestException);
    });

    it('should list all unsupported assets in error response', async () => {
      cacheManager.get.mockResolvedValue(['XLM', 'USDC', 'AQUA']);

      const dto = {
        baseAsset: 'INVALID1',
        counterAsset: 'INVALID2',
      };

      try {
        await pipe.transform(dto, {} as any);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = error.getResponse() as any;
        expect(response.unsupportedAssets).toContain('INVALID1');
        expect(response.unsupportedAssets).toContain('INVALID2');
      }
    });

    it('should deduplicate unsupported assets in error response', async () => {
      cacheManager.get.mockResolvedValue(['XLM', 'USDC', 'AQUA']);

      const dto = {
        baseAsset: 'DUPLICATE_ASSET',
        counterAsset: 'DUPLICATE_ASSET',
      };

      try {
        await pipe.transform(dto, {} as any);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = error.getResponse() as any;
        expect(response.unsupportedAssets.length).toBe(1);
        expect(response.unsupportedAssets[0]).toBe('DUPLICATE_ASSET');
      }
    });
  });

  describe('malformed asset codes', () => {
    it('should ignore null asset codes', async () => {
      cacheManager.get.mockResolvedValue(['XLM', 'USDC', 'AQUA']);

      const dto = {
        baseAsset: null,
        counterAsset: 'XLM',
      };

      const result = await pipe.transform(dto, {} as any);
      expect(result).toEqual(dto);
    });

    it('should ignore undefined asset codes', async () => {
      cacheManager.get.mockResolvedValue(['XLM', 'USDC', 'AQUA']);

      const dto = {
        baseAsset: undefined,
        counterAsset: 'XLM',
      };

      const result = await pipe.transform(dto, {} as any);
      expect(result).toEqual(dto);
    });

    it('should ignore non-string asset codes', async () => {
      cacheManager.get.mockResolvedValue(['XLM', 'USDC', 'AQUA']);

      const dto = {
        baseAsset: 123 as any,
        counterAsset: 'XLM',
      };

      const result = await pipe.transform(dto, {} as any);
      expect(result).toEqual(dto);
    });

    it('should ignore null input object', async () => {
      const result = await pipe.transform(null, {} as any);
      expect(result).toBeNull();
    });

    it('should ignore non-object input', async () => {
      const result = await pipe.transform('string', {} as any);
      expect(result).toBe('string');
    });
  });

  describe('error handling', () => {
    it('should fail open (allow asset) when AssetsService throws', async () => {
      cacheManager.get.mockResolvedValue(null);
      assetsService.getAllAssets.mockRejectedValue(new Error('Database error'));

      const dto = {
        baseAsset: 'XLM',
        counterAsset: 'UNKNOWN_ASSET',
      };

      const result = await pipe.transform(dto, {} as any);
      expect(result).toEqual(dto);
    });

    it('should handle missing AssetsService gracefully', async () => {
      const pipeWithoutService = new AssetValidationPipe(cacheManager, undefined);

      const dto = {
        baseAsset: 'XLM',
        counterAsset: 'USDC',
      };

      const result = await pipeWithoutService.transform(dto, {} as any);
      expect(result).toEqual(dto);
    });

    it('should handle missing CacheManager gracefully', async () => {
      const pipeWithoutCache = new AssetValidationPipe(undefined, assetsService);

      const dto = {
        baseAsset: 'XLM',
        counterAsset: 'USDC',
      };

      const result = await pipeWithoutCache.transform(dto, {} as any);
      expect(result).toEqual(dto);
    });
  });
});
