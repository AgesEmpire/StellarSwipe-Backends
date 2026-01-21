import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { StellarConfigService } from "../../config/stellar.service";
import { LimitOrderDto } from "../dto/limit-order.dto";
import { LimitOrderResponseDto } from "../dto/order-response.dto";
import { buildAsset } from "./asset-utils";

interface OrderBookAnalysis {
  bestBidPrice: number;
  bestAskPrice: number;
  spread: number;
  liquidityAtPrice: number;
}

@Injectable()
export class LimitOrderService {
  private readonly server: Horizon.Server;
  private readonly logger = new Logger(LimitOrderService.name);

  constructor(private readonly stellarConfig: StellarConfigService) {
    this.server = new Horizon.Server(this.stellarConfig.horizonUrl, {
      allowHttp: this.stellarConfig.horizonUrl.startsWith("http://"),
    });
  }

  /**
   * Place a limit order (waits for specific price to be reached)
   * Limit orders use manageSellOffer with a specified price
   */
  async placeOrder(dto: LimitOrderDto): Promise<LimitOrderResponseDto> {
    try {
      // Validate and build assets
      const sellingAsset = buildAsset(
        dto.sellingAssetCode,
        dto.sellingAssetIssuer,
        "Selling asset",
      );
      const buyingAsset = buildAsset(
        dto.buyingAssetCode,
        dto.buyingAssetIssuer,
        "Buying asset",
      );

      // Prevent same asset trading
      if (sellingAsset.equals(buyingAsset)) {
        throw new BadRequestException("Cannot trade an asset for itself");
      }

      // Validate price is reasonable
      if (dto.price <= 0) {
        throw new BadRequestException(
          "Limit order price must be greater than zero",
        );
      }

      // Analyze order book to provide context
      const orderBookAnalysis = await this.analyzeOrderBook(
        sellingAsset,
        buyingAsset,
        dto.price,
      );

      this.logger.log(
        `Placing limit order: ${dto.amount} ${dto.sellingAssetCode} @ ${dto.price} (Spread: ${orderBookAnalysis.spread.toFixed(4)}%)`,
      );

      // Warn if price is far from market (potential typo)
      if (orderBookAnalysis.bestBidPrice > 0) {
        const priceDiff =
          Math.abs(dto.price - orderBookAnalysis.bestBidPrice) /
          orderBookAnalysis.bestBidPrice;
        if (priceDiff > 0.1) {
          // 10% difference
          this.logger.warn(
            `Limit order price ${dto.price} differs significantly from best bid ${orderBookAnalysis.bestBidPrice}`,
          );
        }
      }

      // Load account and validate
      const keypair = this.parseKeypair(dto.sourceSecret);
      const account = await this.loadAccount(keypair.publicKey());

      // Build and submit transaction
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.stellarConfig.networkPassphrase,
      })
        .addOperation(
          Operation.manageSellOffer({
            selling: sellingAsset,
            buying: buyingAsset,
            amount: this.formatAmount(dto.amount),
            price: this.formatPrice(dto.price),
            offerId: "0", // New offer (use existing ID to update/cancel)
          }),
        )
        .setTimeout(30)
        .build();

      transaction.sign(keypair);

      this.logger.log(
        `Submitting limit order transaction for ${keypair.publicKey()}`,
      );

      const result = await this.server.submitTransaction(transaction);

      this.logger.log(`Limit order placed successfully: ${result.hash}`);

      // Determine initial status based on order book
      // If price matches existing orders, it may fill immediately (partially or fully)
      const status =
        dto.price >= orderBookAnalysis.bestBidPrice &&
        orderBookAnalysis.bestBidPrice > 0
          ? "filled" // Price crosses spread, likely filled immediately
          : "open"; // Price outside spread, waiting for match

      return {
        hash: result.hash,
        orderType: "limit",
        status: status as "open" | "partially_filled" | "filled",
        limitPrice: dto.price,
        filledAmount: status === "filled" ? dto.amount : undefined,
        remainingAmount: status === "open" ? dto.amount : undefined,
        timestamp: new Date(),
      };
    } catch (error) {
      this.handleOrderError(error, dto);
    }
  }

  /**
   * Analyze order book to provide context for limit order placement
   */
  private async analyzeOrderBook(
    selling: Asset,
    buying: Asset,
    limitPrice: number,
  ): Promise<OrderBookAnalysis> {
    try {
      const orderbook = await this.server
        .orderbook(selling, buying)
        .limit(50)
        .call();

      const bids = orderbook.bids || [];
      const asks = orderbook.asks || [];

      const bestBidPrice = bids.length > 0 ? Number(bids[0].price) : 0;
      const bestAskPrice = asks.length > 0 ? Number(asks[0].price) : 0;

      // Calculate spread
      let spread = 0;
      if (bestBidPrice > 0 && bestAskPrice > 0) {
        spread = ((bestAskPrice - bestBidPrice) / bestBidPrice) * 100;
      }

      // Calculate liquidity at or near limit price
      let liquidityAtPrice = 0;
      for (const bid of bids) {
        const bidPrice = Number(bid.price);
        if (Math.abs(bidPrice - limitPrice) / limitPrice < 0.01) {
          // Within 1%
          liquidityAtPrice += Number(bid.amount);
        }
      }

      this.logger.debug(
        `Order book analysis - Best bid: ${bestBidPrice}, Best ask: ${bestAskPrice}, Spread: ${spread.toFixed(4)}%`,
      );

      return {
        bestBidPrice,
        bestAskPrice,
        spread,
        liquidityAtPrice,
      };
    } catch (error) {
      // Non-critical: order can still be placed without this analysis
      this.logger.warn(
        `Failed to analyze order book: ${(error as Error).message}. Proceeding with order placement.`,
      );
      return {
        bestBidPrice: 0,
        bestAskPrice: 0,
        spread: 0,
        liquidityAtPrice: 0,
      };
    }
  }

  /**
   * Parse and validate keypair from secret
   */
  private parseKeypair(secret: string): Keypair {
    try {
      return Keypair.fromSecret(secret);
    } catch (error) {
      this.logger.error(`Invalid secret key format: ${(error as Error).message}`);
      throw new BadRequestException("Invalid source secret key format");
    }
  }

  /**
   * Load account from Stellar network with error handling
   */
  private async loadAccount(
    publicKey: string,
  ): Promise<Horizon.AccountResponse> {
    try {
      return await this.server.loadAccount(publicKey);
    } catch (error) {
      this.logger.error(
        `Failed to load account ${publicKey}: ${(error as Error).message}`,
      );
      if ((error as any).response?.status === 404) {
        throw new BadRequestException(
          "Source account not found. Ensure the account is funded and activated on the Stellar network",
        );
      }
      throw new InternalServerErrorException(
        "Failed to load account from Stellar network",
      );
    }
  }

  /**
   * Handle and format order execution errors
   */
  private handleOrderError(error: any, dto: LimitOrderDto): never {
    if (
      error instanceof BadRequestException ||
      error instanceof InternalServerErrorException
    ) {
      throw error;
    }

    // Handle Stellar SDK errors
    if (error.response?.data?.extras) {
      const extras = error.response.data.extras;
      this.logger.error(
        `Transaction failed: ${JSON.stringify(extras.result_codes)}`,
      );

      if (extras.result_codes?.operations) {
        const opCode = extras.result_codes.operations[0];

        switch (opCode) {
          case "op_cross_self":
            throw new BadRequestException(
              "Limit order would cross with your own existing order",
            );
          case "op_sell_no_trust":
            throw new BadRequestException(
              "Account does not have a trustline for the selling asset",
            );
          case "op_buy_no_trust":
            throw new BadRequestException(
              "Account does not have a trustline for the buying asset",
            );
          case "op_offer_cross_self":
            throw new BadRequestException(
              "Order would cross with an existing order from the same account",
            );
          case "op_underfunded":
            throw new BadRequestException(
              `Insufficient balance to sell ${dto.amount} ${dto.sellingAssetCode}`,
            );
          case "op_line_full":
            throw new BadRequestException(
              "Destination account trustline would exceed limit",
            );
          case "op_sell_not_authorized":
            throw new BadRequestException(
              "Account is not authorized to sell this asset",
            );
          case "op_buy_not_authorized":
            throw new BadRequestException(
              "Account is not authorized to buy this asset",
            );
          case "op_malformed":
            throw new BadRequestException(
              "Invalid order parameters. Check amount and price values",
            );
          default:
            throw new BadRequestException(`Transaction failed: ${opCode}`);
        }
      }
    }

    this.logger.error(
      `Unexpected error placing limit order: ${error.message}`,
    );
    throw new InternalServerErrorException(
      "Failed to place limit order. Please try again later",
    );
  }

  /**
   * Format amount to Stellar's 7 decimal precision
   */
  private formatAmount(value: number): string {
    return value.toFixed(7);
  }

  /**
   * Format price to Stellar's 7 decimal precision
   */
  private formatPrice(value: number): string {
    return value.toFixed(7);
  }
}
