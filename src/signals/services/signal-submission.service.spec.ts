import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Signal, SignalType, SignalStatus } from '../entities/signal.entity';
import { StakeVerificationService } from '../../stake-verification/stake-verification.service';
import { SignalSubmissionService } from './signal-submission.service';

const VALID_PROVIDER = 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBKM6GS6HMDE';
const FUTURE = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

const validBuyDto = {
  providerId: VALID_PROVIDER,
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  type: SignalType.BUY,
  entryPrice: '0.10',
  targetPrice: '0.15',
  stopLossPrice: '0.08',
  expiresAt: FUTURE,
};

const verifiedStake = {
  verified: true,
  stakeAmount: '5000',
  minimumRequired: '1000',
  verifiedAt: new Date(),
  message: 'Provider is verified',
};

describe('SignalSubmissionService', () => {
  let service: SignalSubmissionService;
  let signalRepo: any;
  let stakeService: any;

  beforeEach(async () => {
    const mockSignal: Partial<Signal> = {
      id: 'sig-uuid',
      status: SignalStatus.ACTIVE,
      providerId: VALID_PROVIDER,
    };

    signalRepo = {
      create: jest.fn().mockReturnValue(mockSignal),
      save: jest.fn().mockResolvedValue(mockSignal),
    };

    stakeService = {
      verifyProviderStake: jest.fn().mockResolvedValue(verifiedStake),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalSubmissionService,
        { provide: getRepositoryToken(Signal), useValue: signalRepo },
        { provide: StakeVerificationService, useValue: stakeService },
      ],
    }).compile();

    service = module.get(SignalSubmissionService);
  });

  describe('submitSignal', () => {
    it('creates and saves a signal when stake is verified', async () => {
      const result = await service.submitSignal(validBuyDto as any);
      expect(signalRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('sig-uuid');
    });

    it('throws ForbiddenException when stake verification fails', async () => {
      stakeService.verifyProviderStake.mockResolvedValue({
        ...verifiedStake,
        verified: false,
        message: 'Insufficient stake',
      });
      await expect(service.submitSignal(validBuyDto as any)).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for BUY with targetPrice below entryPrice', async () => {
      const dto = { ...validBuyDto, targetPrice: '0.05' };
      await expect(service.submitSignal(dto as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for SELL with targetPrice above entryPrice', async () => {
      const dto = { ...validBuyDto, type: SignalType.SELL, entryPrice: '0.15', targetPrice: '0.20' };
      await expect(service.submitSignal(dto as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for expiry less than 1h from now', async () => {
      const dto = { ...validBuyDto, expiresAt: new Date(Date.now() + 10_000).toISOString() };
      await expect(service.submitSignal(dto as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for non-positive entryPrice', async () => {
      const dto = { ...validBuyDto, entryPrice: '0' };
      await expect(service.submitSignal(dto as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('trySubmitSignal', () => {
    it('returns success result on valid submission', async () => {
      const result = await service.trySubmitSignal(validBuyDto as any);
      expect(result.success).toBe(true);
      expect(result.signal).toBeDefined();
    });

    it('returns STAKE_VERIFICATION_FAILED error code without throwing', async () => {
      stakeService.verifyProviderStake.mockResolvedValue({ ...verifiedStake, verified: false, message: 'Low stake' });
      const result = await service.trySubmitSignal(validBuyDto as any);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('STAKE_VERIFICATION_FAILED');
    });

    it('returns INVALID_PAYLOAD error code without throwing', async () => {
      const dto = { ...validBuyDto, entryPrice: '-1' };
      const result = await service.trySubmitSignal(dto as any);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PAYLOAD');
    });
  });
});
