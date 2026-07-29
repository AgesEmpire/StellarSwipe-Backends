import { Controller, Post, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WalletValidationService, StellarNetwork } from './wallet-validation.service';

class ValidateAddressDto {
  address: string;
}

class ValidateMultipleAddressesDto {
  addresses: string[];
}

@ApiTags('wallet-validation')
@Controller('wallet/validation')
export class WalletValidationController {
  constructor(private readonly walletValidationService: WalletValidationService) {}

  @Post('validate')
  @ApiOperation({ summary: 'Validate a single Stellar wallet address' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  validateAddress(@Body() dto: ValidateAddressDto) {
    return this.walletValidationService.validateAddress(dto.address);
  }

  @Post('validate-multiple')
  @ApiOperation({ summary: 'Validate multiple Stellar wallet addresses' })
  @ApiResponse({ status: 200, description: 'Array of validation results' })
  validateMultipleAddresses(@Body() dto: ValidateMultipleAddressesDto) {
    return this.walletValidationService.validateMultipleAddresses(dto.addresses);
  }

  @Post('validate-strict')
  @ApiOperation({ summary: 'Validate address with strict network checking (throws on invalid)' })
  @ApiResponse({ status: 200, description: 'Validation successful' })
  @ApiResponse({ status: 400, description: 'Invalid address' })
  validateAddressStrict(@Body() dto: ValidateAddressDto) {
    return this.walletValidationService.validateAndThrow(dto.address);
  }

  @Get('network-info')
  @ApiOperation({ summary: 'Get current network configuration' })
  getNetworkInfo() {
    return {
      currentNetwork: this.walletValidationService.getCurrentNetwork(),
      networkPassphrase: this.walletValidationService.getNetworkPassphrase(),
      supportedNetworks: this.walletValidationService.getSupportedNetworks(),
    };
  }

  @Get('test-address')
  @ApiOperation({ summary: 'Generate a test address for development' })
  generateTestAddress() {
    return {
      address: this.walletValidationService.generateTestAddress(),
      network: this.walletValidationService.getCurrentNetwork(),
    };
  }
}