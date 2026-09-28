import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { WalletValidationService, StellarNetwork } from '../../../src/stellar/validation/wallet-validation.service';

describe('WalletValidationService', () => {
  let service: WalletValidationService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config = {
          STELLAR_NETWORK: StellarNetwork.TESTNET,
        };
        return config[key] || defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletValidationService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<WalletValidationService>(WalletValidationService);
    configService = module.get(ConfigService);
  });

  describe('validateAddress', () => {
    it('should validate a valid Stellar account address', () => {
      const validAddress = 'GCKFBEIYTKP5RDBQMUTAPDCOOMCQIYLCY4H2DHFZGSLRFQD5TVLWOWSK';
      
      const result = service.validateAddress(validAddress);

      expect(result.isValid).toBe(true);
      expect(result.addressType).toBe('account');
      expect(result.network).toBe(StellarNetwork.TESTNET);
    });

    it('should reject invalid address format', () => {
      const invalidAddress = 'invalid-address';
      
      const result = service.validateAddress(invalidAddress);

      expect(result.isValid).toBe(false);
      expect(result.addressType).toBe('unknown');
      expect(result.error).toContain('Invalid Stellar address format');
    });

    it('should handle empty or null addresses', () => {
      const result1 = service.validateAddress('');
      const result2 = service.validateAddress(null as any);

      expect(result1.isValid).toBe(false);
      expect(result2.isValid).toBe(false);
    });

    it('should validate contract addresses', () => {
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
      
      const result = service.validateAddress(contractAddress);

      expect(result.isValid).toBe(true);
      expect(result.addressType).toBe('contract');
    });
  });

  describe('validateAndThrow', () => {
    it('should throw BadRequestException for invalid address', () => {
      const invalidAddress = 'invalid-address';

      expect(() => service.validateAndThrow(invalidAddress))
        .toThrow(BadRequestException);
    });

    it('should return validation result for valid address', () => {
      const validAddress = 'GCKFBEIYTKP5RDBQMUTAPDCOOMCQIYLCY4H2DHFZGSLRFQD5TVLWOWSK';
      
      const result = service.validateAndThrow(validAddress);

      expect(result.isValid).toBe(true);
    });
  });

  describe('validateMultipleAddresses', () => {
    it('should validate multiple addresses', () => {
      const addresses = [
        'GCKFBEIYTKP5RDBQMUTAPDCOOMCQIYLCY4H2DHFZGSLRFQD5TVLWOWSK',
        'invalid-address',
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      ];

      const results = service.validateMultipleAddresses(addresses);

      expect(results).toHaveLength(3);
      expect(results[0].isValid).toBe(true);
      expect(results[1].isValid).toBe(false);
      expect(results[2].isValid).toBe(true);
    });
  });

  describe('utility methods', () => {
    it('should check if address is valid account address', () => {
      const accountAddress = 'GCKFBEIYTKP5RDBQMUTAPDCOOMCQIYLCY4H2DHFZGSLRFQD5TVLWOWSK';
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

      expect(service.isValidAccountAddress(accountAddress)).toBe(true);
      expect(service.isValidAccountAddress(contractAddress)).toBe(false);
    });

    it('should check if address is valid contract address', () => {
      const accountAddress = 'GCKFBEIYTKP5RDBQMUTAPDCOOMCQIYLCY4H2DHFZGSLRFQD5TVLWOWSK';
      const contractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

      expect(service.isValidContractAddress(contractAddress)).toBe(true);
      expect(service.isValidContractAddress(accountAddress)).toBe(false);
    });

    it('should generate test address', () => {
      const testAddress = service.generateTestAddress();

      expect(typeof testAddress).toBe('string');
      expect(testAddress.length).toBe(56);
      expect(testAddress.startsWith('G')).toBe(true);
    });

    it('should return current network info', () => {
      expect(service.getCurrentNetwork()).toBe(StellarNetwork.TESTNET);
      expect(service.getNetworkPassphrase()).toContain('Test SDF Network');
      expect(service.getSupportedNetworks()).toContain(StellarNetwork.TESTNET);
    });
  });
});