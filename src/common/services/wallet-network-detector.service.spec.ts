import { Test, TestingModule } from '@nestjs/testing';
import { WalletNetworkDetectorService } from './wallet-network-detector.service';
import { StellarConfigService } from '../../config/stellar.service';
import { WalletNetworkRequirement } from '../decorators/wallet-network-requirement.decorator';

describe('WalletNetworkDetectorService', () => {
  let service: WalletNetworkDetectorService;
  let mockStellarConfig: any;

  beforeEach(async () => {
    mockStellarConfig = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletNetworkDetectorService,
        {
          provide: StellarConfigService,
          useValue: mockStellarConfig,
        },
      ],
    }).compile();

    service = module.get<WalletNetworkDetectorService>(
      WalletNetworkDetectorService,
    );
  });

  describe('extractNetworkFromUser', () => {
    it('extracts network from user.network', () => {
      const user = { network: 'testnet' };
      const network = service.extractNetworkFromUser(user);
      expect(network).toBe(WalletNetworkRequirement.TESTNET);
    });

    it('extracts network from user.stellarNetwork', () => {
      const user = { stellarNetwork: 'mainnet' };
      const network = service.extractNetworkFromUser(user);
      expect(network).toBe(WalletNetworkRequirement.MAINNET);
    });

    it('extracts network from user.walletNetwork', () => {
      const user = { walletNetwork: 'testnet' };
      const network = service.extractNetworkFromUser(user);
      expect(network).toBe(WalletNetworkRequirement.TESTNET);
    });

    it('extracts network from user.stellar.network', () => {
      const user = { stellar: { network: 'mainnet' } };
      const network = service.extractNetworkFromUser(user);
      expect(network).toBe(WalletNetworkRequirement.MAINNET);
    });

    it('returns undefined when user is null', () => {
      const network = service.extractNetworkFromUser(null);
      expect(network).toBeUndefined();
    });

    it('returns undefined when network is not found', () => {
      const user = { walletAddress: 'GABC...' };
      const network = service.extractNetworkFromUser(user);
      expect(network).toBeUndefined();
    });

    it('handles case-insensitive network names', () => {
      expect(service.extractNetworkFromUser({ network: 'TESTNET' })).toBe(
        WalletNetworkRequirement.TESTNET,
      );
      expect(service.extractNetworkFromUser({ network: 'MainNet' })).toBe(
        WalletNetworkRequirement.MAINNET,
      );
    });

    it('handles whitespace in network names', () => {
      expect(
        service.extractNetworkFromUser({ network: '  testnet  ' }),
      ).toBe(WalletNetworkRequirement.TESTNET);
    });
  });

  describe('isNetworkAllowed', () => {
    it('allows any network when requirement is EITHER', () => {
      expect(
        service.isNetworkAllowed(
          WalletNetworkRequirement.TESTNET,
          WalletNetworkRequirement.EITHER,
        ),
      ).toBe(true);
      expect(
        service.isNetworkAllowed(
          WalletNetworkRequirement.MAINNET,
          WalletNetworkRequirement.EITHER,
        ),
      ).toBe(true);
      expect(
        service.isNetworkAllowed(
          undefined,
          WalletNetworkRequirement.EITHER,
        ),
      ).toBe(true);
    });

    it('allows matching networks', () => {
      expect(
        service.isNetworkAllowed(
          WalletNetworkRequirement.TESTNET,
          WalletNetworkRequirement.TESTNET,
        ),
      ).toBe(true);
      expect(
        service.isNetworkAllowed(
          WalletNetworkRequirement.MAINNET,
          WalletNetworkRequirement.MAINNET,
        ),
      ).toBe(true);
    });

    it('denies mismatched networks', () => {
      expect(
        service.isNetworkAllowed(
          WalletNetworkRequirement.TESTNET,
          WalletNetworkRequirement.MAINNET,
        ),
      ).toBe(false);
      expect(
        service.isNetworkAllowed(
          WalletNetworkRequirement.MAINNET,
          WalletNetworkRequirement.TESTNET,
        ),
      ).toBe(false);
    });

    it('denies when wallet network is undefined', () => {
      expect(
        service.isNetworkAllowed(
          undefined,
          WalletNetworkRequirement.MAINNET,
        ),
      ).toBe(false);
      expect(
        service.isNetworkAllowed(
          undefined,
          WalletNetworkRequirement.TESTNET,
        ),
      ).toBe(false);
    });
  });
});
