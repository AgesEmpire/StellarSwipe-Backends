import {
  BadRequestException,
  Injectable,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  Horizon,
} from "@stellar/stellar-sdk";
import { StellarConfigService } from "../../config/stellar.service";
import { MarketOrderDto } from "../dto/market-order.dto";
import { MarketOrderResponseDto } from "../dto/order-response.dto";
import { buildAsset } from "./asset-utils";

interface MarketPriceEstimate {
  averagePrice: number;
  bestPrice: number;
  worstPrice: number;
  totalBids: number;
  liquidityDepth: number;
}

@Injectable()
export class MarketOrderService {
  private readonly server: Horizon.Server;
  private readonly logger = new Logger(MarketOrderService.name);

  constructor(private readonly stellarConfig: StellarConfigService) {
    this.server = new Horizon.Server(this.stellarConfig.horizonUrl, {
      allowHttp: this.stellarConfig.horizonUrl.startsWith("http://"),
    });
  }

  /**
   * Execute a market order (immediate execution at best available price)
   * Market orders use manageSellOffer with price "0" for fill-or-kill behavior
   */
  async executeOrder(dto: MarketOrderDto): Promise<MarketOrderResponseDto> {
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

      // Estimate market price and check liquidity
      const priceEstimate = await this.estimateMarketPrice(
        sellingAsset,
        buyingAsset,
        dto.amount,
      );

      // Calculate slippage protection
      const slippage = this.calculateSlippage(
        priceEstimate.bestPrice,
        priceEstimate.averagePrice,
      );

      this.logger.log(
        `Market order slippage: ${slippage.toFixed(4)}% (max: ${dto.maxSlippagePercent}%)`,
      );

      // Check slippage protection
      if (slippage > dto.maxSlippagePercent) {
        throw new BadRequestException(
          `Slippage ${slippage.toFixed(2)}% exceeds maximum allowed ${dto.maxSlippagePercent}%. ` +
            `Best price: ${priceEstimate.bestPrice}, Average price: ${priceEstimate.averagePrice}`,
        );
      }

      // Load account and validate
      const keypair = this.parseKeypair(dto.sourceSecret);
      const account = await this.loadAccount(keypair.publicKey());

      // Build and submit transaction with fill-or-kill behavior (price = "0")
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.stellarConfig.networkPassphrase,
      })
        .addOperation(
          Operation.manageSellOffer({
            selling: sellingAsset,
            buying: buyingAsset,
            amount: this.formatAmount(dto.amount),
            price: "0", // Price "0" creates fill-or-kill market order behavior
            offerId: "0", // New offer
          }),
        )
        .setTimeout(30)
        .build();

      transaction.sign(keypair);

      this.logger.log(
        `Submitting market order: ${dto.amount} ${dto.sellingAssetCode} -> ${dto.buyingAssetCode}`,
      );

      const result = await this.server.submitTransaction(transaction);

      this.logger.log(`Market order executed successfully: ${result.hash}`);

      return {
        hash: result.hash,
        orderType: "market",
        status: "filled",
        priceEstimate: {
          averagePrice: priceEstimate.averagePrice,
          bestPrice: priceEstimate.bestPrice,
          worstPrice: priceEstimate.worstPrice,
        },
        slippagePercent: Number(slippage.toFixed(4)),
        filledAmount: dto.amount,
        timestamp: new Date(),
      };
    } catch (error) {
      this.handleOrderError(error, dto);
    }
  }

  /**
   * Estimate the market price by analyzing the order book
   * Simulates filling the order to calculate average execution price
   */
  private async estimateMarketPrice(
    selling: Asset,
    buying: Asset,
    amount: number,
  ): Promise<MarketPriceEstimate> {
    try {
      const orderbook = await this.server
        .orderbook(selling, buying)
        .limit(200) // Get more depth for better estimation
        .call();

      const bids = orderbook.bids || [];

      if (bids.length === 0) {
        throw new BadRequestException(
          "No liquidity available in the order book for this trading pair",
        );
      }

      const bestPrice = Number(bids[0].price);
      let remaining = amount;
      let totalSold = 0;
      let totalBought = 0;
      let worstPrice = bestPrice;
      let bidCount = 0;

      // Simulate order filling across order book
      for (const bid of bids) {
        const bidPrice = Number(bid.price);
        const bidAmount = Number(bid.amount);

        // Validate bid data
        if (
          !Number.isFinite(bidPrice) ||
          !Number.isFinite(bidAmount) ||
          bidAmount <= 0 ||
          bidPrice <= 0
        ) {
          this.logger.warn(
            `Invalid bid data encountered: ${JSON.stringify(bid)}`,
          );
          continue;
        }

        const fillAmount = Math.min(remaining, bidAmount);
        totalSold += fillAmount;
        totalBought += fillAmount * bidPrice;
        remaining -= fillAmount;
        worstPrice = bidPrice;
        bidCount++;

        if (remaining <= 0) {
          break;
        }
      }

      // Check if order can be fully filled
      if (remaining > 0) {
        throw new BadRequestException(
          `Insufficient liquidity: Can only fill ${totalSold.toFixed(7)} of ${amount} ${selling.getCode()}. ` +
            `Available bids: ${bidCount}`,
        );
      }

      if (totalSold === 0) {
        throw new BadRequestException(
          "Unable to estimate price: no valid bids found",
        );
      }

      const averagePrice = totalBought / totalSold;

      this.logger.debug(
        `Price estimate - Best: ${bestPrice}, Average: ${averagePrice.toFixed(7)}, Worst: ${worstPrice}, Bids: ${bidCount}`,
      );

      return {
        averagePrice,
        bestPrice,
        worstPrice,
        totalBids: bidCount,
        liquidityDepth: totalSold,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to fetch order book: ${(error as Error).message}`);
      throw new InternalServerErrorException(
        "Unable to fetch order book data from Stellar network",
      );
    }
  }

  /**
   * Calculate slippage percentage between best and average price
   */
  private calculateSlippage(bestPrice: number, averagePrice: number): number {
    if (bestPrice <= 0) {
      throw new BadRequestException(
        "Invalid best price for slippage calculation",
      );
    }
    return Math.abs(((bestPrice - averagePrice) / bestPrice) * 100);
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
  private handleOrderError(error: any, dto: MarketOrderDto): never {
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
            throw new BadRequestException("Cannot trade with yourself");
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
          default:
            throw new BadRequestException(`Transaction failed: ${opCode}`);
        }
      }
    }

    this.logger.error(
      `Unexpected error executing market order: ${error.message}`,
    );
    throw new InternalServerErrorException(
      "Failed to execute market order. Please try again later",
    );
  }

  /**
   * Format amount to Stellar's 7 decimal precision
   */
  private formatAmount(value: number): string {
    return value.toFixed(7);
  }
}
