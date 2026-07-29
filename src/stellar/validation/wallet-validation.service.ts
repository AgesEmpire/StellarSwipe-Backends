import { Injectable, BadRequestException } from '@nestjs/common';
import { StrKey, Keypair } from '@stellar/stellar-sdk';
import { ConfigService } from '@nestjs/config';

export enum StellarNetwork {
  MAINNET = 'mainnet',
  TESTNET = 'testnet',
  FUTURENET = 'futurenet',
}

interface ValidationResult {
  isValid: boolean;
  network?: StellarNetwork;
  addressType: 'account' | 'muxed' | 'contract' | 'unknown';
  error?: string;
}

@Injectable()
export class WalletValidationService {
  private readonly expectedNetwork: StellarNetwork;
  private readonly networkPassphrases = {
    [StellarNetwork.MAINNET]: 'Public Global Stellar Network ; September 2015',
    [StellarNetwork.TESTNET]: 'Test SDF Network ; September 2015',
    [StellarNetwork.FUTURENET]: 'Test SDF Future Network ; October 2022',
  };

  constructor(private readonly configService: ConfigService) {
    this.expectedNetwork = this.configService.get('STELLAR_NETWORK', StellarNetwork.TESTNET) as StellarNetwork;
  }

  validateAddress(address: string): ValidationResult {
    if (!address || typeof address !== 'string') {
      return {
        isValid: false,
        addressType: 'unknown',
        error: 'Address is required and must be a string',
      };
    }

    // Trim whitespace
    address = address.trim();

    try {
      // Check if it's a valid Stellar account address
      if (StrKey.isValidEd25519PublicKey(address)) {
        return {
          isValid: true,
          network: this.expectedNetwork,
          addressType: 'account',
        };
      }

      // Check if it's a valid muxed account address
      if (StrKey.isValidMed25519PublicKey(address)) {
        return {
          isValid: true,
          network: this.expectedNetwork,
          addressType: 'muxed',
        };
      }

      // Check if it's a valid contract address
      if (StrKey.isValidContract(address)) {
        return {
          isValid: true,
          network: this.expectedNetwork,
          addressType: 'contract',
        };
      }

      return {
        isValid: false,
        addressType: 'unknown',
        error: 'Invalid Stellar address format',
      };
    } catch (error) {
      return {
        isValid: false,
        addressType: 'unknown',
        error: `Address validation failed: ${error.message}`,
      };
    }
  }

  validateAndThrow(address: string): ValidationResult {
    const result = this.validateAddress(address);
    
    if (!result.isValid) {
      throw new BadRequestException(result.error || 'Invalid wallet address');
    }

    if (result.network !== this.expectedNetwork) {
      throw new BadRequestException(
        `Address is not valid for ${this.expectedNetwork} network`
      );
    }

    return result;
  }

  validateMultipleAddresses(addresses: string[]): ValidationResult[] {
    return addresses.map(address => this.validateAddress(address));
  }

  isValidAccountAddress(address: string): boolean {
    const result = this.validateAddress(address);
    return result.isValid && result.addressType === 'account';
  }

  isValidContractAddress(address: string): boolean {
    const result = this.validateAddress(address);
    return result.isValid && result.addressType === 'contract';
  }

  generateTestAddress(): string {
    // Generate a random keypair for testing purposes
    const keypair = Keypair.random();
    return keypair.publicKey();
  }

  getNetworkPassphrase(): string {
    return this.networkPassphrases[this.expectedNetwork];
  }

  getCurrentNetwork(): StellarNetwork {
    return this.expectedNetwork;
  }

  getSupportedNetworks(): StellarNetwork[] {
    return Object.values(StellarNetwork);
  }
}