import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { FeeBumpService } from './fee-bump.service';

const MOCK_HASH = 'abc123feebumphash';
const MOCK_FEE = '1000';

const mockServer = {
  fetchBaseFee: jest.fn().mockResolvedValue(100),
  submitTransaction: jest.fn().mockResolvedValue({ hash: MOCK_HASH, fee_charged: MOCK_FEE }),
};

const mockSponsorKeypair = {
  publicKey: () => 'GSPONSOR_PUBLIC_KEY',
  sign: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: jest.fn().mockImplementation(() => mockServer),
    },
    Keypair: {
      fromSecret: jest.fn().mockReturnValue(mockSponsorKeypair),
    },
    Networks: { PUBLIC: 'Public Global Stellar Network ; September 2015', TESTNET: 'Test SDF Network ; September 2015' },
    Transaction: jest.fn().mockImplementation(function () {
      // default: plain Transaction (not FeeBumpTransaction)
      Object.setPrototypeOf(this, actual.Transaction.prototype);
    }),
    FeeBumpTransaction: actual.FeeBumpTransaction,
    TransactionBuilder: {
      buildFeeBumpTransaction: jest.fn().mockReturnValue({
        sign: jest.fn(),
      }),
    },
  };
});

describe('FeeBumpService', () => {
  let service: FeeBumpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeBumpService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: any) => def),
            getOrThrow: jest.fn().mockReturnValue('SSECRET000000000000000000000000000000000000000000000000000'),
          },
        },
      ],
    }).compile();

    service = module.get(FeeBumpService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('submitFeeBump', () => {
    it('should build, sign, and submit a fee-bump transaction and return result', async () => {
      const result = await service.submitFeeBump({ innerTransactionXdr: 'validXdr' });

      expect(result.hash).toBe(MOCK_HASH);
      expect(result.sponsorAccount).toBe('GSPONSOR_PUBLIC_KEY');
      expect(result.feeCharged).toBe(MOCK_FEE);
    });

    it('should track cumulative fees after submission', async () => {
      await service.submitFeeBump({ innerTransactionXdr: 'validXdr' });
      const stats = service.getSponsorFeeStats();
      expect(BigInt(stats.totalFeesSpentStroops)).toBeGreaterThan(BigInt(0));
    });

    it('should throw BadRequestException for invalid XDR', async () => {
      const StellarSdk = require('@stellar/stellar-sdk');
      StellarSdk.Transaction.mockImplementationOnce(() => {
        throw new Error('bad xdr');
      });

      await expect(service.submitFeeBump({ innerTransactionXdr: 'BADINPUT' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when inner tx is already a fee-bump', async () => {
      const StellarSdk = require('@stellar/stellar-sdk');
      StellarSdk.Transaction.mockImplementationOnce(function () {
        Object.setPrototypeOf(this, StellarSdk.FeeBumpTransaction.prototype);
      });

      await expect(service.submitFeeBump({ innerTransactionXdr: 'feeBumpXdr' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getSponsorFeeStats', () => {
    it('should return sponsor public key and initial zero fee', () => {
      const stats = service.getSponsorFeeStats();
      expect(stats.sponsorAccount).toBe('GSPONSOR_PUBLIC_KEY');
      expect(stats.totalFeesSpentStroops).toBe('0');
    });
  });
});
