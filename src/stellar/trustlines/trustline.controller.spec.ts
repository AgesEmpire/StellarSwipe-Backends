import { Test, TestingModule } from '@nestjs/testing';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TrustlineController } from './trustline.controller';
import { TrustlineService } from './trustline.service';
import { CheckTrustlineDto, AutoCreateTrustlineDto } from './dto/check-trustline.dto';

// Well-formed 56-char Stellar public/secret keys used across the existing
// trustline test fixtures/examples in the codebase.
const VALID_PUBLIC_KEY = 'GCLWGQPMKXQSPF776IU33AH4PZNOOWNAWGGKVTBQMIC5IMKUNP3E6NVU';
const VALID_ISSUER_KEY = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const VALID_SECRET_KEY = 'SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4';

const mockTrustlineService = {
  createTrustline: jest.fn(),
  removeTrustline: jest.fn(),
  getTrustlineStatus: jest.fn(),
  checkTrustlineBeforeTrade: jest.fn().mockResolvedValue({
    hasRequired: true,
    needsCreation: false,
  }),
  autoCreateTrustlineForTrade: jest.fn().mockResolvedValue({
    success: true,
  }),
};

// Mirrors the global ValidationPipe configuration wired up in src/main.ts
// (whitelist, forbidNonWhitelisted, transform) so this test exercises the
// same rejection behavior real HTTP requests would hit.
const globalPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};

describe('TrustlineController', () => {
  let controller: TrustlineController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrustlineController],
      providers: [{ provide: TrustlineService, useValue: mockTrustlineService }],
    }).compile();

    controller = module.get(TrustlineController);
  });

  describe('checkTrustlineBeforeTrade', () => {
    const validBody: CheckTrustlineDto = {
      publicKey: VALID_PUBLIC_KEY,
      assetCode: 'USDC',
      assetIssuer: VALID_ISSUER_KEY,
    };

    it('accepts a valid payload and delegates to the service', async () => {
      const result = await controller.checkTrustlineBeforeTrade(validBody);
      expect(result).toEqual({ hasRequired: true, needsCreation: false });
      expect(mockTrustlineService.checkTrustlineBeforeTrade).toHaveBeenCalledTimes(1);
    });

    it('rejects a payload missing required fields with a structured 400 error', async () => {
      const pipe = new ValidationPipe(globalPipeOptions);
      const metadata: ArgumentMetadata = {
        type: 'body',
        metatype: CheckTrustlineDto,
        data: '',
      };

      await expect(
        pipe.transform({ publicKey: VALID_PUBLIC_KEY }, metadata),
      ).rejects.toThrow(BadRequestException);

      try {
        await pipe.transform({ publicKey: VALID_PUBLIC_KEY }, metadata);
        fail('expected ValidationPipe to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = err.getResponse();
        expect(response.statusCode).toBe(400);
        expect(Array.isArray(response.message)).toBe(true);
        expect(response.message.length).toBeGreaterThan(0);
        // assetCode and assetIssuer are required and were omitted above.
        expect(response.message.join(' ')).toEqual(
          expect.stringContaining('assetCode'),
        );
      }
    });

    it('rejects a payload with an invalid Stellar public key', async () => {
      const dto = plainToInstance(CheckTrustlineDto, {
        publicKey: 'not-a-valid-key',
        assetCode: 'USDC',
        assetIssuer: VALID_ISSUER_KEY,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'publicKey')).toBe(true);
    });

    it('rejects a payload containing unknown fields (forbidNonWhitelisted)', async () => {
      const pipe = new ValidationPipe(globalPipeOptions);
      const metadata: ArgumentMetadata = {
        type: 'body',
        metatype: CheckTrustlineDto,
        data: '',
      };

      await expect(
        pipe.transform(
          { ...validBody, notAllowedField: 'oops' },
          metadata,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('autoCreateTrustlineForTrade', () => {
    const validBody: AutoCreateTrustlineDto = {
      publicKey: VALID_PUBLIC_KEY,
      secretKey: VALID_SECRET_KEY,
      assetCode: 'USDC',
      assetIssuer: VALID_ISSUER_KEY,
    };

    it('accepts a valid payload and delegates to the service', async () => {
      const result = await controller.autoCreateTrustlineForTrade(validBody);
      expect(result).toEqual({ success: true });
      expect(mockTrustlineService.autoCreateTrustlineForTrade).toHaveBeenCalledTimes(1);
    });

    it('rejects a malformed secret key with a structured 400 error', async () => {
      const dto = plainToInstance(AutoCreateTrustlineDto, {
        publicKey: VALID_PUBLIC_KEY,
        secretKey: 'not-a-secret-key',
        assetCode: 'USDC',
        assetIssuer: VALID_ISSUER_KEY,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'secretKey')).toBe(true);
    });
  });
});
