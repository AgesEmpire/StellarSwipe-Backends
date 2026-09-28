import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { SponsoredReservesService } from './sponsored-reserves.service';

const SPONSOR_SECRET = 'SSPONSOR00000000000000000000000000000000000000000000000000';
const NEW_ACCT_SECRET = 'SNEWACCT00000000000000000000000000000000000000000000000000';
const NEW_ACCT_PUBLIC = 'GNEWACCOUNT00000000000000000000000000000000000000000000000';
const MOCK_HASH = 'sponsoredhash123';

const makeAccount = (xlmBalance: string, subentryCount = 0) => ({
  id: 'GSPONSOR',
  sequence: '1',
  subentry_count: subentryCount,
  balances: [{ asset_type: 'native', balance: xlmBalance }],
});

const mockServer = {
  loadAccount: jest.fn().mockResolvedValue(makeAccount('1000', 0)),
  fetchBaseFee: jest.fn().mockResolvedValue(100),
  submitTransaction: jest.fn().mockResolvedValue({ hash: MOCK_HASH }),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: { Server: jest.fn().mockImplementation(() => mockServer) },
    Keypair: {
      fromSecret: jest.fn().mockImplementation((secret: string) => ({
        publicKey: () =>
          secret === SPONSOR_SECRET ? 'GSPONSOR_PUBLIC' : NEW_ACCT_PUBLIC,
        sign: jest.fn(),
      })),
    },
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
    },
    Asset: jest.fn().mockImplementation((code: string, issuer: string) => ({ code, issuer })),
    Operation: {
      beginSponsoringFutureReserves: jest.fn().mockReturnValue({}),
      createAccount: jest.fn().mockReturnValue({}),
      endSponsoringFutureReserves: jest.fn().mockReturnValue({}),
      changeTrust: jest.fn().mockReturnValue({}),
      revokeSponsorship: jest.fn().mockReturnValue({}),
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ sign: jest.fn() }),
    })),
  };
});

describe('SponsoredReservesService', () => {
  let service: SponsoredReservesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SponsoredReservesService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: any) => def),
            getOrThrow: jest.fn().mockReturnValue(SPONSOR_SECRET),
          },
        },
      ],
    }).compile();

    service = module.get(SponsoredReservesService);
    mockServer.loadAccount.mockResolvedValue(makeAccount('1000', 0));
  });

  afterEach(() => jest.clearAllMocks());

  describe('sponsorNewAccountOnboarding', () => {
    it('should build sandwich transaction and return result', async () => {
      const StellarSdk = require('@stellar/stellar-sdk');
      const result = await service.sponsorNewAccountOnboarding(
        { newAccountPublicKey: NEW_ACCT_PUBLIC },
        NEW_ACCT_SECRET,
      );

      expect(StellarSdk.Operation.beginSponsoringFutureReserves).toHaveBeenCalledWith({
        sponsoredId: NEW_ACCT_PUBLIC,
      });
      expect(StellarSdk.Operation.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ destination: NEW_ACCT_PUBLIC }),
      );
      expect(StellarSdk.Operation.endSponsoringFutureReserves).toHaveBeenCalledWith({
        source: NEW_ACCT_PUBLIC,
      });
      expect(result.hash).toBe(MOCK_HASH);
      expect(result.sponsorAccount).toBe('GSPONSOR_PUBLIC');
      expect(result.trustlinesCreated).toBe(0);
    });

    it('should add changeTrust operations for each trustline asset', async () => {
      const StellarSdk = require('@stellar/stellar-sdk');
      const result = await service.sponsorNewAccountOnboarding(
        {
          newAccountPublicKey: NEW_ACCT_PUBLIC,
          trustlineAssets: ['USDC:GABC1234', 'BTC:GDEF5678'],
        },
        NEW_ACCT_SECRET,
      );

      expect(StellarSdk.Operation.changeTrust).toHaveBeenCalledTimes(2);
      expect(result.trustlinesCreated).toBe(2);
    });

    it('should throw BadRequestException when sponsor has insufficient reserve', async () => {
      mockServer.loadAccount.mockResolvedValue(makeAccount('0.5', 0));

      await expect(
        service.sponsorNewAccountOnboarding(
          { newAccountPublicKey: NEW_ACCT_PUBLIC },
          NEW_ACCT_SECRET,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when secret/public key mismatch', async () => {
      const StellarSdk = require('@stellar/stellar-sdk');
      StellarSdk.Keypair.fromSecret.mockImplementationOnce(() => ({
        publicKey: () => 'GSPONSOR_PUBLIC', // first call = sponsor
      })).mockImplementationOnce(() => ({
        publicKey: () => 'GDIFFERENT_KEY',  // new account key mismatch
        sign: jest.fn(),
      }));

      await expect(
        service.sponsorNewAccountOnboarding(
          { newAccountPublicKey: NEW_ACCT_PUBLIC },
          NEW_ACCT_SECRET,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSponsorReserveCapacity', () => {
    it('should report canOnboard=true with sufficient balance', async () => {
      const result = await service.getSponsorReserveCapacity();
      expect(result.canOnboard).toBe(true);
      expect(parseFloat(result.availableXlm)).toBeGreaterThan(0);
    });

    it('should report canOnboard=false when sponsor balance is too low', async () => {
      mockServer.loadAccount.mockResolvedValueOnce(makeAccount('5.1', 0));
      const result = await service.getSponsorReserveCapacity();
      expect(result.canOnboard).toBe(false);
    });
  });

  describe('revokeSponsoredAccountReserve', () => {
    it('should submit a revokeSponsorship transaction', async () => {
      const StellarSdk = require('@stellar/stellar-sdk');
      const result = await service.revokeSponsoredAccountReserve({
        sponsoredAccountPublicKey: NEW_ACCT_PUBLIC,
      });

      expect(StellarSdk.Operation.revokeSponsorship).toHaveBeenCalledWith({
        type: 'account',
        account: NEW_ACCT_PUBLIC,
      });
      expect(result.hash).toBe(MOCK_HASH);
    });
  });
});
