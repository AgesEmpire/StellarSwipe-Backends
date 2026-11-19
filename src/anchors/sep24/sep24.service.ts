import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InitiateDepositDto,
  InitiateWithdrawalDto,
  Sep24ResponseDto,
  TransactionStatusDto,
  GetTransactionDto,
  KycStatusDto,
  InitiateKycDto,
  TransactionType,
  TransactionStatus,
} from './dto/deposit-withdrawal.dto';
import {
  AnchorIntegrationsProvider,
  Sep24Transaction,
} from './providers/anchor-integrations';

interface AnchorErrorMapping {
  code: string;
  status: HttpStatus;
  retryable: boolean;
}

const KNOWN_ANCHOR_ERRORS: Record<string, AnchorErrorMapping> = {
  authentication_required: {
    code: 'ANCHOR_AUTHENTICATION_REQUIRED',
    status: HttpStatus.UNAUTHORIZED,
    retryable: false,
  },
  kyc_required: {
    code: 'ANCHOR_KYC_REQUIRED',
    status: HttpStatus.FORBIDDEN,
    retryable: false,
  },
  asset_not_supported: {
    code: 'ANCHOR_ASSET_NOT_SUPPORTED',
    status: HttpStatus.BAD_REQUEST,
    retryable: false,
  },
  invalid_request: {
    code: 'ANCHOR_INVALID_REQUEST',
    status: HttpStatus.BAD_REQUEST,
    retryable: false,
  },
  amount_too_small: {
    code: 'ANCHOR_AMOUNT_TOO_SMALL',
    status: HttpStatus.BAD_REQUEST,
    retryable: false,
  },
  amount_too_large: {
    code: 'ANCHOR_AMOUNT_TOO_LARGE',
    status: HttpStatus.BAD_REQUEST,
    retryable: false,
  },
  transaction_not_found: {
    code: 'ANCHOR_TRANSACTION_NOT_FOUND',
    status: HttpStatus.NOT_FOUND,
    retryable: false,
  },
  rate_limit_exceeded: {
    code: 'ANCHOR_RATE_LIMITED',
    status: HttpStatus.TOO_MANY_REQUESTS,
    retryable: true,
  },
  service_unavailable: {
    code: 'ANCHOR_SERVICE_UNAVAILABLE',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    retryable: true,
  },
  internal_error: {
    code: 'ANCHOR_INTERNAL_ERROR',
    status: HttpStatus.BAD_GATEWAY,
    retryable: true,
  },
};

const UNKNOWN_ANCHOR_ERROR: AnchorErrorMapping = {
  code: 'ANCHOR_UNKNOWN_ERROR',
  status: HttpStatus.BAD_GATEWAY,
  retryable: false,
};

/**
 * Typed representation of the SEP-24 capabilities an anchor advertises via
 * its `/info` endpoint. Optional capabilities default to `false` when the
 * anchor does not advertise them.
 */
export interface Sep24AnchorCapabilities {
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositAssets: string[];
  withdrawAssets: string[];
  supportsDeposit: (assetCode: string) => boolean;
  supportsWithdraw: (assetCode: string) => boolean;
}

/**
 * Parse raw anchor `/info` metadata into a typed capability representation.
 * Malformed or missing metadata yields a capability set with everything
 * disabled rather than throwing, so callers can reject flows cleanly.
 */
export function parseAnchorCapabilities(
  raw: unknown,
): Sep24AnchorCapabilities {
  const empty: Sep24AnchorCapabilities = {
    depositEnabled: false,
    withdrawEnabled: false,
    depositAssets: [],
    withdrawAssets: [],
    supportsDeposit: () => false,
    supportsWithdraw: () => false,
  };

  if (!raw || typeof raw !== 'object') {
    return empty;
  }

  const info = raw as Record<string, unknown>;
  const deposit = info.deposit;
  const withdraw = info.withdraw;

  const collectAssets = (section: unknown): string[] => {
    if (!section || typeof section !== 'object') {
      return [];
    }
    const assets = (section as Record<string, unknown>).enabled_assets;
    if (!Array.isArray(assets)) {
      return [];
    }
    return assets.filter(
      (asset): asset is string => typeof asset === 'string' && asset.length > 0,
    );
  };

  const depositAssets = collectAssets(deposit);
  const withdrawAssets = collectAssets(withdraw);

  const depositEnabled =
    !!deposit &&
    typeof deposit === 'object' &&
    (deposit as Record<string, unknown>).enabled !== false &&
    depositAssets.length > 0;
  const withdrawEnabled =
    !!withdraw &&
    typeof withdraw === 'object' &&
    (withdraw as Record<string, unknown>).enabled !== false &&
    withdrawAssets.length > 0;

  return {
    depositEnabled,
    withdrawEnabled,
    depositAssets,
    withdrawAssets,
    supportsDeposit: (assetCode: string) =>
      depositEnabled && depositAssets.includes(assetCode),
    supportsWithdraw: (assetCode: string) =>
      withdrawEnabled && withdrawAssets.includes(assetCode),
  };
}

@Injectable()
export class Sep24Service {
  private readonly logger = new Logger(Sep24Service.name);
  private readonly defaultAnchor: string;

  constructor(
    private readonly anchorProvider: AnchorIntegrationsProvider,
    private readonly configService: ConfigService,
  ) {
    this.defaultAnchor =
      this.configService.get<string>('SEP24_DEFAULT_ANCHOR') || 'circle';
    this.logger.log(`SEP24 Service initialized with default anchor: ${this.defaultAnchor}`);
  }

  /**
   * Fetch and parse the anchor's advertised SEP-24 capabilities. Returns
   * `null` when the provider cannot supply capability metadata.
   */
  async getAnchorCapabilities(
    anchorDomain?: string,
  ): Promise<Sep24AnchorCapabilities | null> {
    const domain = anchorDomain || this.defaultAnchor;
    const provider = this.anchorProvider as unknown as {
      getAnchorInfo?: (domain: string) => Promise<unknown>;
    };
    if (typeof provider.getAnchorInfo !== 'function') {
      return null;
    }
    try {
      const info = await provider.getAnchorInfo(domain);
      return parseAnchorCapabilities(info);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch capabilities for ${domain}: ${error.message}`,
      );
      return null;
    }
  }

  private async assertDepositSupported(
    anchorDomain: string,
    assetCode: string,
  ): Promise<void> {
    const capabilities = await this.getAnchorCapabilities(anchorDomain);
    if (!capabilities) {
      return;
    }
    if (!capabilities.supportsDeposit(assetCode)) {
      throw new HttpException(
        {
          code: 'ANCHOR_CAPABILITY_UNSUPPORTED',
          message: `Anchor ${anchorDomain} does not support deposit for asset ${assetCode}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async assertWithdrawSupported(
    anchorDomain: string,
    assetCode: string,
  ): Promise<void> {
    const capabilities = await this.getAnchorCapabilities(anchorDomain);
    if (!capabilities) {
      return;
    }
    if (!capabilities.supportsWithdraw(assetCode)) {
      throw new HttpException(
        {
          code: 'ANCHOR_CAPABILITY_UNSUPPORTED',
          message: `Anchor ${anchorDomain} does not support withdrawal for asset ${assetCode}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async initiateDeposit(dto: InitiateDepositDto): Promise<Sep24ResponseDto> {
    try {
      const anchorDomain = dto.anchorDomain || this.defaultAnchor;

      this.logger.log(
        `User ${dto.userId} initiating deposit of ${dto.amount} ${dto.assetCode} via ${anchorDomain}`,
      );

      const anchor = this.anchorProvider.getAnchor(anchorDomain);

      await this.assertDepositSupported(anchorDomain, dto.assetCode);

      const result = await this.anchorProvider.initiateDeposit(anchorDomain, {
        asset_code: dto.assetCode,
        account: dto.account || await this.getUserStellarAccount(dto.userId),
        amount: dto.amount.toString(),
        lang: dto.lang || 'en',
      });

      this.logger.log(
        `Deposit initiated successfully. Transaction ID: ${result.id}`,
      );

      return {
        type: TransactionType.DEPOSIT,
        url: result.url,
        id: result.id,
      };
    } catch (error) {
      this.logger.error(
        `Failed to initiate deposit for user ${dto.userId}: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.normalizeAnchorError(error, 'Failed to initiate deposit');
    }
  }

  async initiateWithdrawal(
    dto: InitiateWithdrawalDto,
  ): Promise<Sep24ResponseDto> {
    try {
      const anchorDomain = dto.anchorDomain || this.defaultAnchor;

      this.logger.log(
        `User ${dto.userId} initiating withdrawal of ${dto.amount} ${dto.assetCode} via ${anchorDomain}`,
      );

      const anchor = this.anchorProvider.getAnchor(anchorDomain);

      await this.assertWithdrawSupported(anchorDomain, dto.assetCode);

      const result = await this.anchorProvider.initiateWithdrawal(
        anchorDomain,
        {
          asset_code: dto.assetCode,
          account: dto.account || await this.getUserStellarAccount(dto.userId),
          amount: dto.amount.toString(),
          type: dto.type,
          dest: dto.dest,
          dest_extra: dto.destExtra,
        },
      );

      this.logger.log(
        `Withdrawal initiated successfully. Transaction ID: ${result.id}`,
      );

      return {
        type: TransactionType.WITHDRAWAL,
        url: result.url,
        id: result.id,
      };
    } catch (error) {
      this.logger.error(
        `Failed to initiate withdrawal for user ${dto.userId}: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.normalizeAnchorError(error, 'Failed to initiate withdrawal');
    }
  }

  async getTransactionStatus(
    dto: GetTransactionDto,
    anchorDomain?: string,
  ): Promise<TransactionStatusDto> {
    try {
      const domain = anchorDomain || this.defaultAnchor;

      this.logger.log(
        `Fetching transaction status from ${domain} - ID: ${dto.id}`,
      );

      const transaction = await this.anchorProvider.getTransaction(
        domain,
        dto.id,
        dto.stellarTransactionId,
        dto.externalTransactionId,
      );

      return this.mapToTransactionStatusDto(transaction);
    } catch (error) {
      this.logger.error(
        `Failed to get transaction status: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.normalizeAnchorError(error, 'Failed to get transaction status');
    }
  }

  async getUserTransactions(
    userId: string,
    assetCode: string,
    anchorDomain?: string,
    limit?: number,
  ): Promise<TransactionStatusDto[]> {
    try {
      const domain = anchorDomain || this.defaultAnchor;
      const account = await this.getUserStellarAccount(userId);

      this.logger.log(
        `Fetching transactions for user ${userId} from ${domain}`,
      );

      const transactions = await this.anchorProvider.getTransactions(
        domain,
        assetCode,
        account,
        limit,
      );

      return transactions.map((tx) => this.mapToTransactionStatusDto(tx));
    } catch (error) {
      this.logger.error(
        `Failed to get user transactions: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.normalizeAnchorError(error, 'Failed to get user transactions');
    }
  }

  async checkKycStatus(
    userId: string,
    anchorDomain?: string,
  ): Promise<KycStatusDto> {
    try {
      const domain = anchorDomain || this.defaultAnchor;

      this.logger.log(`Checking KYC status for user ${userId} with ${domain}`);

      const result = await this.anchorProvider.checkKycStatus(domain, userId);

      return {
        userId,
        anchorDomain: domain,
        status: result.status,
        moreInfoUrl: result.moreInfoUrl,
      };
    } catch (error) {
      this.logger.error(
        `Failed to check KYC status: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.normalizeAnchorError(error, 'Failed to check KYC status');
    }
  }

  async initiateKyc(dto: InitiateKycDto): Promise<{ url: string }> {
    try {
      this.logger.log(
        `Initiating KYC for user ${dto.userId} with ${dto.anchorDomain}`,
      );

      const result = await this.anchorProvider.initiateKyc(
        dto.anchorDomain,
        dto.userId,
      );

      this.logger.log(`KYC initiated successfully. URL: ${result.url}`);

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to initiate KYC: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.normalizeAnchorError(error, 'Failed to initiate KYC');
    }
  }

  private normalizeAnchorError(
    error: any,
    fallbackMessage: string,
  ): HttpException {
    const rawCode =
      error?.response?.data?.error ||
      error?.response?.data?.code ||
      error?.code;
    const mapping =
      (typeof rawCode === 'string' && KNOWN_ANCHOR_ERRORS[rawCode]) ||
      UNKNOWN_ANCHOR_ERROR;

    const message =
      error?.response?.data?.message || error?.message || fallbackMessage;

    return new HttpException(
      {
        code: mapping.code,
        message,
        retryable: mapping.retryable,
      },
      mapping.status,
    );
  }

  private mapToTransactionStatusDto(
    transaction: Sep24Transaction,
  ): TransactionStatusDto {
    return {
      id: transaction.id,
      status: transaction.status as TransactionStatus,
      kind: transaction.kind,
      amountIn: transaction.amount_in,
      amountOut: transaction.amount_out,
      amountFee: transaction.amount_fee,
      startedAt: transaction.started_at,
      completedAt: transaction.completed_at,
      stellarTransactionId: transaction.stellar_transaction_id,
      externalTransactionId: transaction.external_transaction_id,
      message: transaction.message,
      moreInfoUrl: transaction.more_info_url,
    };
  }

  private async getUserStellarAccount(userId: string): Promise<string> {
    // Placeholder for user account lookup; overridden by wallet integration.
    return userId;
  }
}
