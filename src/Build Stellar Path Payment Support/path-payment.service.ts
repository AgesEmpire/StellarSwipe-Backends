import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { PathFinderService } from './path-finder.service';
import {
  PathPaymentRequestDto,
  PathPaymentResponseDto,
  PathResultDto,
} from './dto/path-payment.dto';

@Injectable()
export class PathPaymentService {
  private readonly logger = new Logger(PathPaymentService.name);
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly pathFinder: PathFinderService,
  ) {
    const horizonUrl =
      configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';

    this.server = new Horizon.Server(horizonUrl);

    this.networkPassphrase =
      configService.get<string>('STELLAR_NETWORK') === 'mainnet'
        ? Networks.PUBLIC
        : Networks.TESTNET;
  }

  // ─────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────

  /**
   * Execute a path payment with automatic best-path selection and
   * slippage protection. Falls back to a direct trade when no
   * multi-hop paths exist.
   */
  async executePathPayment(
    dto: PathPaymentRequestDto,
    signingSecret: string, // passed at call-site; never stored
  ): Promise<PathPaymentResponseDto> {
    const slippage = dto.slippageTolerance ?? 1;

    // 1. Discover paths (or use the caller-forced path)
    const allPaths = await this.discoverPaths(dto, slippage);

    // 2. Choose the best path (or fall back to direct)
    const { selectedPath, usedDirectTrade } = await this.choosePath(
      dto,
      allPaths,
      slippage,
    );

    // 3. Build & submit the transaction
    try {
      const txHash = await this.buildAndSubmit(
        dto,
        selectedPath,
        slippage,
        signingSecret,
      );

      return {
        success: true,
        transactionHash: txHash,
        selectedPath,
        allPaths,
        usedDirectTrade,
      };
    } catch (error) {
      this.logger.error(`Path payment failed: ${error.message}`, error.stack);
      return {
        success: false,
        selectedPath,
        allPaths,
        usedDirectTrade,
        error: error.message,
      };
    }
  }

  /**
   * Preview available paths and their costs without submitting a transaction.
   */
  async previewPaths(
    dto: PathPaymentRequestDto,
  ): Promise<{ paths: PathResultDto[]; bestPath: PathResultDto | null }> {
    const slippage = dto.slippageTolerance ?? 1;
    const paths = await this.discoverPaths(dto, slippage);
    const bestPath = this.pathFinder.selectBestPath(paths);
    return { paths, bestPath };
  }

  // ─────────────────────────────────────────────
  //  Path discovery
  // ─────────────────────────────────────────────

  private async discoverPaths(
    dto: PathPaymentRequestDto,
    slippage: number,
  ): Promise<PathResultDto[]> {
    if (dto.forcedPath) {
      // Caller supplied a specific intermediary path; wrap it as a single option
      const srcAmount = await this.estimateSourceAmount(dto);
      return [
        {
          path: dto.forcedPath,
          sourceAmount: srcAmount,
          destinationAmount: dto.destinationAmount,
          slippage,
          hops: dto.forcedPath.length + 1,
          priceRatio:
            parseFloat(dto.destinationAmount) / parseFloat(srcAmount),
        },
      ];
    }

    return this.pathFinder.findPaths(
      dto.sourceAccount,
      dto.sourceAsset,
      dto.destinationAsset,
      dto.destinationAmount,
      slippage,
    );
  }

  // ─────────────────────────────────────────────
  //  Path selection with fallback
  // ─────────────────────────────────────────────

  private async choosePath(
    dto: PathPaymentRequestDto,
    allPaths: PathResultDto[],
    slippage: number,
  ): Promise<{ selectedPath: PathResultDto; usedDirectTrade: boolean }> {
    const best = this.pathFinder.selectBestPath(allPaths);

    if (best) {
      return { selectedPath: best, usedDirectTrade: false };
    }

    // ── Fallback: direct trade ──────────────────
    this.logger.warn(
      `No multi-hop paths found. Falling back to direct trade for ` +
        `${dto.sourceAsset.code} → ${dto.destinationAsset.code}`,
    );

    const srcAmount = await this.estimateSourceAmount(dto);
    const directPath = this.pathFinder.buildDirectPath(
      dto.sourceAsset,
      dto.destinationAsset,
      srcAmount,
      dto.destinationAmount,
      slippage,
    );

    return { selectedPath: directPath, usedDirectTrade: true };
  }

  // ─────────────────────────────────────────────
  //  Transaction construction & submission
  // ─────────────────────────────────────────────

  private async buildAndSubmit(
    dto: PathPaymentRequestDto,
    selectedPath: PathResultDto,
    slippage: number,
    signingSecret: string,
  ): Promise<string> {
    const keypair = Keypair.fromSecret(signingSecret);

    if (keypair.publicKey() !== dto.sourceAccount) {
      throw new BadRequestException(
        'Signing key does not match source account.',
      );
    }

    const account = await this.server.loadAccount(dto.sourceAccount);

    const sendMax = this.pathFinder.calculateSendMax(
      selectedPath.sourceAmount,
      slippage,
    );

    const srcAsset = this.pathFinder.toStellarAsset(dto.sourceAsset);
    const dstAsset = this.pathFinder.toStellarAsset(dto.destinationAsset);
    const intermediaryAssets: Asset[] = selectedPath.path.map((a) =>
      this.pathFinder.toStellarAsset(a),
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.pathPaymentStrictReceive({
          sendAsset: srcAsset,
          sendMax,
          destination: dto.destinationAccount,
          destAsset: dstAsset,
          destAmount: dto.destinationAmount,
          path: intermediaryAssets,
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(keypair);

    const result = await this.server.submitTransaction(tx);

    if (!result.successful) {
      const extras = (result as any).extras;
      const resultCodes = extras?.result_codes;
      throw new InternalServerErrorException(
        `Transaction failed: ${JSON.stringify(resultCodes)}`,
      );
    }

    return result.hash;
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  /**
   * Quick estimate of the source amount required for a direct trade,
   * used only when no multi-hop paths are found.
   */
  private async estimateSourceAmount(
    dto: PathPaymentRequestDto,
  ): Promise<string> {
    try {
      const dstAsset = this.pathFinder.toStellarAsset(dto.destinationAsset);
      const srcAsset = this.pathFinder.toStellarAsset(dto.sourceAsset);

      // Use strict-send path-finding as an inverse estimate
      const response = await this.server
        .strictSendPaths(srcAsset, '1', [dstAsset])
        .call();

      if (response.records.length) {
        const rate = parseFloat(response.records[0].destination_amount);
        const required = parseFloat(dto.destinationAmount) / rate;
        return required.toFixed(7);
      }
    } catch (_) {
      // Swallow – return a default estimate below
    }

    // Conservative fallback: 1:1 ratio
    return dto.destinationAmount;
  }
}
