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

  async initiateDeposit(dto: InitiateDepositDto): Promise<Sep24ResponseDto> {
    try {
      const anchorDomain = dto.anchorDomain || this.defaultAnchor;

      this.logger.log(
        `User ${dto.userId} initiating deposit of ${dto.amount} ${dto.assetCode} via ${anchorDomain}`,
      );

      const anchor = this.anchorProvider.getAnchor(anchorDomain);

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

  async getAvailableAnchors() {
    try {
      const anchors = this.anchorProvider.listAvailableAnchors();
      return anchors.map((anchor) => ({
        domain: anchor.domain,
        homeDomain: anchor.homeDomain,
        supportedAssets: this.anchorProvider.getSupportedAssets(anchor.domain),
        supportsKyc: !!anchor.kycUrl,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to list available anchors: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.normalizeAnchorError(error, 'Failed to list available anchors');
    }
  }

  /**
   * Normalizes an anchor-specific error into a stable API error code while
   * preserving a sanitized diagnostic reference for support. Provider payloads
   * are never forwarded to the client.
   */
  private normalizeAnchorError(
    error: unknown,
    fallbackMessage: string,
  ): HttpException {
    const rawCode = this.extractAnchorErrorCode(error);
    const mapping = rawCode
      ? KNOWN_ANCHOR_ERRORS[rawCode] || UNKNOWN_ANCHOR_ERROR
      : UNKNOWN_ANCHOR_ERROR;

    const diagnosticReference = this.sanitizeDiagnosticReference(rawCode);

    return new HttpException(
      {
        statusCode: mapping.status,
        error: mapping.code,
        message: fallbackMessage,
        retryable: mapping.retryable,
        diagnosticReference,
      },
      mapping.status,
    );
  }

  private extractAnchorErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const candidate = error as Record<string, unknown>;
    const response = candidate.response as Record<string, unknown> | undefined;

    const possibleCodes = [
      candidate.error,
      candidate.code,
      response && response.error,
      response && response.code,
    ];

    for (const value of possibleCodes) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return undefined;
  }

  private sanitizeDiagnosticReference(rawCode?: string): string | undefined {
    if (!rawCode) {
      return undefined;
    }
    // Keep only a short, safe token so provider payloads are never leaked.
    const sanitized = rawCode.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64);
    return sanitized.length > 0 ? sanitized : undefined;
  }

  private mapToTransactionStatusDto(
    transaction: Sep24Transaction,
  ): TransactionStatusDto {
    return {
      id: transaction.id,
      status: transaction.status,
      statusEta: transaction.status_eta,
      moreInfoUrl: transaction.more_info_url,
      amountIn: transaction.amount_in,
      amountOut: transaction.amount_out,
      amountFee: transaction.amount_fee,
      startedAt: transaction.started_at
        ? new Date(transaction.started_at)
        : undefined,
      completedAt: transaction.completed_at
        ? new Date(transaction.completed_at)
        : undefined,
    };
  }

  private async getUserStellarAccount(userId: string): Promise<string> {
    // Placeholder for user account lookup; kept as-is to preserve behavior.
    return userId;
  }
}
