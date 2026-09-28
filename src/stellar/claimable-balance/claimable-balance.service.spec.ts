import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ClaimableBalanceService } from './claimable-balance.service';
import { ClaimPredicateType } from './claimable-balance.dto';

const MOCK_HASH = 'claimable123hash';
const MOCK_BALANCE_ID = 'balance-id-xyz';
const SPONSOR_SECRET = 'SSECRET000000000000000000000000000000000000000000000000000';
const RECIPIENT = 'GRECIPIENT0000000000000000000000000000000000000000000000000';

const mockServer = {
  loadAccount: jest.fn().mockResolvedValue({ id: 'source', sequence: '1' }),
  fetchBaseFee: jest.fn().mockResolvedValue(100),
  submitTransaction: jest.fn().mockResolvedValue({ hash: MOCK_HASH, balance_id: MOCK_BALANCE_ID }),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: { Server: jest.fn().mockImplementation(() => mockServer) },
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({
        publicKey: () => 'GSPONSOR_PUBLIC',
        sign: jest.fn(),
      }),
    },
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
    },
    Asset: {
      native: jest.fn().mockReturnValue({ isNative: () => true }),
      ...actual.Asset,
    },
    Claimant: {
      predicateUnconditional: jest.fn().mockReturnValue({}),
      predicateBeforeAbsoluteTime: jest.fn().mockReturnValue({}),
      predicateBeforeRelativeTime: jest.fn().mockReturnValue({}),
    },
    Operation: {
      createClaimableBalance: jest.fn().mockReturnValue({}),
      claimClaimableBalance: jest.fn().mockReturnValue({}),
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ sign: jest.fn() }),
    })),
  };
});

describe('ClaimableBalanceService', () => {
  let service: ClaimableBalanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimableBalanceService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: any) => def),
            getOrThrow: jest.fn().mockReturnValue(SPONSOR_SECRET),
          },
        },
      ],
    }).compile();

    service = module.get(ClaimableBalanceService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createClaimableBalance', () => {
    it('should create a claimable balance with unconditional predicate', async () => {
      const result = await service.createClaimableBalance({
        sponsorSecretKey: SPONSOR_SECRET,
        recipientAddress: RECIPIENT,
        assetCode: 'XLM',
        amount: '10',
      });
      expect(result.hash).toBe(MOCK_HASH);
      expect(result.balanceId).toBeTruthy();
    });

    it('should create with absolute time-bound predicate', async () => {
      const StellarSdk = require('@stellar/stellar-sdk');
      const result = await service.createClaimableBalance({
        sponsorSecretKey: SPONSOR_SECRET,
        recipientAddress: RECIPIENT,
        assetCode: 'XLM',
        amount: '10',
        predicateType: ClaimPredicateType.BEFORE_ABSOLUTE_TIME,
        predicateValue: 9999999999,
      });
      expect(StellarSdk.Claimant.predicateBeforeAbsoluteTime).toHaveBeenCalledWith('9999999999');
      expect(result.hash).toBe(MOCK_HASH);
    });

    it('should create with relative time-bound predicate', async () => {
      const StellarSdk = require('@stellar/stellar-sdk');
      await service.createClaimableBalance({
        sponsorSecretKey: SPONSOR_SECRET,
        recipientAddress: RECIPIENT,
        assetCode: 'XLM',
        amount: '10',
        predicateType: ClaimPredicateType.BEFORE_RELATIVE_TIME,
        predicateValue: 86400,
      });
      expect(StellarSdk.Claimant.predicateBeforeRelativeTime).toHaveBeenCalledWith('86400');
    });

    it('should throw BadRequestException when predicateValue missing for absolute time', async () => {
      await expect(
        service.createClaimableBalance({
          sponsorSecretKey: SPONSOR_SECRET,
          recipientAddress: RECIPIENT,
          assetCode: 'XLM',
          amount: '10',
          predicateType: ClaimPredicateType.BEFORE_ABSOLUTE_TIME,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('claimBalance', () => {
    it('should claim an outstanding balance', async () => {
      const result = await service.claimBalance({
        claimantSecretKey: SPONSOR_SECRET,
        balanceId: MOCK_BALANCE_ID,
      });
      expect(result.hash).toBe(MOCK_HASH);
    });
  });

  describe('reclaimExpiredBalance', () => {
    it('should reclaim an expired balance', async () => {
      const result = await service.reclaimExpiredBalance({
        sponsorSecretKey: SPONSOR_SECRET,
        balanceId: MOCK_BALANCE_ID,
      });
      expect(result.hash).toBe(MOCK_HASH);
    });
  });
});
