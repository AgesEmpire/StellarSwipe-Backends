import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  AdvancedOrder,
  AdvancedOrderStatus,
  AdvancedOrderType,
  IcebergOrderData,
} from '../entities/advanced-order.entity';
import {
  CancelIcebergOrderDto,
  CreateIcebergOrderDto,
  IcebergOrderResponseDto,
} from '../dto/iceberg-order.dto';
import { StellarConfigService } from '../../config/stellar.service';
import { buildAsset } from './asset-utils';

@Injectable()
export class IcebergOrderService {
  private readonly server: Horizon.Server;
  private readonly logger = new Logger(IcebergOrderService.name);

  constructor(
    @InjectRepository(AdvancedOrder)
    private readonly repo: Repository<AdvancedOrder>,
    private readonly stellarConfig: StellarConfigService,
  ) {
    this.server = new Horizon.Server(this.stellarConfig.horizonUrl, {
      allowHttp: this.stellarConfig.horizonUrl.startsWith('http://'),
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Create an iceberg order.
   *
   * An iceberg order hides the full `totalAmount` from the market and only
   * exposes `displayAmount` at a time via a Stellar manageSellOffer.
   *
   * When the visible slice is filled, call `checkAndRefill` to post a new
   * slice until the full amount has been executed.
   */
  async createOrder(dto: CreateIcebergOrderDto): Promise<IcebergOrderResponseDto> {
    // ── Validate sizes ─────────────────────────────────────────────────────
    this.validateIcebergSizes(dto.totalAmount, dto.displayAmount);

    // ── Build assets ───────────────────────────────────────────────────────
    const sellingAsset = buildAsset(
      dto.sellingAssetCode,
      dto.sellingAssetIssuer,
      'Selling asset',
    );
    const buyingAsset = buildAsset(
      dto.buyingAssetCode,
      dto.buyingAssetIssuer,
      'Buying asset',
    );

    if (sellingAsset.equals(buyingAsset)) {
      throw new BadRequestException('Cannot trade an asset for itself');
    }

    // ── Persist order record ───────────────────────────────────────────────
    const firstDisplayAmount = Math.min(dto.displayAmount, dto.totalAmount);

    const order = this.repo.create({
      userId: dto.userId,
      positionId: dto.positionId,
      orderType: AdvancedOrderType.ICEBERG,
      status: AdvancedOrderStatus.ACTIVE,
      sellingAssetCode: dto.sellingAssetCode,
      sellingAssetIssuer: dto.sellingAssetIssuer,
      buyingAssetCode: dto.buyingAssetCode,
      buyingAssetIssuer: dto.buyingAssetIssuer,
      icebergData: {
        totalAmount: dto.totalAmount,
        displayAmount: dto.displayAmount,
        filledAmount: 0,
        currentDisplayedAmount: firstDisplayAmount,
        refillCount: 0,
        limitPrice: dto.limitPrice,
      } as IcebergOrderData,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });

    const saved = await this.repo.save(order);

    // ── Place the first slice on-chain ─────────────────────────────────────
    try {
      const keypair = this.parseKeypair(dto.sourceSecret);
      const offerId = await this.placeSlice(
        keypair,
        sellingAsset,
        buyingAsset,
        firstDisplayAmount,
        dto.limitPrice,
      );

      saved.icebergData = {
        ...saved.icebergData!,
        activeOfferId: offerId,
      };

      await this.repo.save(saved);
      this.logger.log(
        `Iceberg order ${saved.id}: first slice placed – offer ${offerId} (${firstDisplayAmount}/${dto.totalAmount})`,
      );
    } catch (error) {
      saved.status = AdvancedOrderStatus.CANCELLED;
      saved.errorMessage = (error as Error).message;
      await this.repo.save(saved);
      this.handleStellarError(error, 'Failed to place iceberg order slice');
    }

    return this.toResponseDto(saved);
  }

  /**
   * Check whether the currently visible slice has been filled.
   * If so, post a new slice until the full order is complete.
   *
   * Call this from a scheduler / polling job (e.g. every 30 s).
   */
  async checkAndRefill(orderId: string, sourceSecret: string): Promise<void> {
    const order = await this.repo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`Iceberg order ${orderId} not found`);
    if (order.status !== AdvancedOrderStatus.ACTIVE) return;

    const data = order.icebergData!;
    const keypair = this.parseKeypair(sourceSecret);

    // Check whether the active displayed slice was consumed
    const activeFilled = await this.isOfferFilled(data.activeOfferId);
    if (!activeFilled) {
      this.logger.debug(
        `Iceberg ${orderId}: active offer ${data.activeOfferId} still open`,
      );
      return;
    }

    // Update filled amount
    data.filledAmount += data.currentDisplayedAmount;

    this.logger.log(
      `Iceberg ${orderId}: slice filled – total filled ${data.filledAmount}/${data.totalAmount}`,
    );

    const remaining = data.totalAmount - data.filledAmount;

    if (remaining <= 0) {
      // Fully filled
      order.icebergData = { ...data, filledAmount: data.totalAmount, currentDisplayedAmount: 0 };
      order.status = AdvancedOrderStatus.FILLED;
      order.executedAt = new Date();
      await this.repo.save(order);
      this.logger.log(`Iceberg order ${orderId} fully filled`);
      return;
    }

    // Place next slice
    const nextSliceAmount = Math.min(data.displayAmount, remaining);

    const sellingAsset = buildAsset(
      order.sellingAssetCode,
      order.sellingAssetIssuer,
      'Selling asset',
    );
    const buyingAsset = buildAsset(
      order.buyingAssetCode,
      order.buyingAssetIssuer,
      'Buying asset',
    );

    try {
      const newOfferId = await this.placeSlice(
        keypair,
        sellingAsset,
        buyingAsset,
        nextSliceAmount,
        data.limitPrice,
      );

      order.icebergData = {
        ...data,
        filledAmount: data.filledAmount,
        currentDisplayedAmount: nextSliceAmount,
        activeOfferId: newOfferId,
        refillCount: data.refillCount + 1,
      };

      order.status = AdvancedOrderStatus.PARTIALLY_FILLED;
      await this.repo.save(order);

      this.logger.log(
        `Iceberg ${orderId}: slice #${data.refillCount + 1} placed – offer ${newOfferId} (${nextSliceAmount} remaining)`,
      );
    } catch (err) {
      this.logger.error(
        `Iceberg ${orderId}: failed to place refill slice – ${(err as Error).message}`,
      );
      order.errorMessage = (err as Error).message;
      await this.repo.save(order);
    }
  }

  /**
   * Cancel the currently displayed slice of an iceberg order and mark it done.
   */
  async cancelOrder(dto: CancelIcebergOrderDto): Promise<IcebergOrderResponseDto> {
    const order = await this.repo.findOne({
      where: { id: dto.orderId, userId: dto.userId },
    });

    if (!order) throw new NotFoundException(`Iceberg order not found`);

    if (order.status === AdvancedOrderStatus.CANCELLED) {
      throw new ConflictException('Order is already cancelled');
    }

    if (order.status === AdvancedOrderStatus.FILLED) {
      throw new ConflictException('Cannot cancel a fully-filled iceberg order');
    }

    const data = order.icebergData!;
    const keypair = this.parseKeypair(dto.sourceSecret);

    if (data.activeOfferId) {
      try {
        await this.cancelOffer(keypair, data.activeOfferId, order);
      } catch (err) {
        this.logger.warn(
          `Could not cancel active offer ${data.activeOfferId}: ${(err as Error).message}`,
        );
      }
    }

    order.status = AdvancedOrderStatus.CANCELLED;
    order.cancelledAt = new Date();
    await this.repo.save(order);

    return this.toResponseDto(order);
  }

  /**
   * Fetch a single iceberg order for a user.
   */
  async getOrder(orderId: string, userId: string): Promise<IcebergOrderResponseDto> {
    const order = await this.repo.findOne({
      where: { id: orderId, userId, orderType: AdvancedOrderType.ICEBERG },
    });
    if (!order) throw new NotFoundException(`Iceberg order not found`);
    return this.toResponseDto(order);
  }

  /**
   * List all iceberg orders for a user.
   */
  async listOrders(
    userId: string,
    status?: AdvancedOrderStatus,
  ): Promise<IcebergOrderResponseDto[]> {
    const where: Record<string, any> = {
      userId,
      orderType: AdvancedOrderType.ICEBERG,
    };
    if (status) where['status'] = status;

    const orders = await this.repo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return orders.map((o) => this.toResponseDto(o));
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Place a single displayed slice as a Stellar manageSellOffer.
   * Returns the offer ID from the Horizon response.
   */
  private async placeSlice(
    keypair: Keypair,
    sellingAsset: Asset,
    buyingAsset: Asset,
    amount: number,
    limitPrice: number,
  ): Promise<string> {
    const account = await this.loadAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.stellarConfig.networkPassphrase,
    })
      .addOperation(
        Operation.manageSellOffer({
          selling: sellingAsset,
          buying: buyingAsset,
          amount: amount.toFixed(7),
          price: limitPrice.toFixed(7),
          offerId: '0',
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const result = await this.server.submitTransaction(tx);

    const offerId = this.extractFirstOfferId(result);
    return offerId;
  }

  /**
   * Cancel a Stellar offer by setting its amount to 0.
   * We reconstruct the asset pair from the order record.
   */
  private async cancelOffer(
    keypair: Keypair,
    offerId: string,
    order: AdvancedOrder,
  ): Promise<void> {
    const sellingAsset = buildAsset(
      order.sellingAssetCode,
      order.sellingAssetIssuer,
      'Selling asset',
    );
    const buyingAsset = buildAsset(
      order.buyingAssetCode,
      order.buyingAssetIssuer,
      'Buying asset',
    );

    const account = await this.loadAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.stellarConfig.networkPassphrase,
    })
      .addOperation(
        Operation.manageSellOffer({
          selling: sellingAsset,
          buying: buyingAsset,
          amount: '0',
          price: order.icebergData!.limitPrice.toFixed(7),
          offerId,
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    await this.server.submitTransaction(tx);
  }

  /** Check if a Horizon offer ID is no longer in the order book (= filled / cancelled). */
  private async isOfferFilled(offerId?: string): Promise<boolean> {
    if (!offerId) return false;
    try {
      await this.server.offers().offer(offerId).call();
      return false;
    } catch (err: any) {
      if (err?.response?.status === 404) return true;
      this.logger.warn(`Error checking offer ${offerId}: ${(err as Error).message}`);
      return false;
    }
  }

  private validateIcebergSizes(totalAmount: number, displayAmount: number): void {
    if (totalAmount <= 0 || displayAmount <= 0) {
      throw new BadRequestException('Amounts must be positive numbers');
    }
    if (displayAmount >= totalAmount) {
      throw new BadRequestException(
        'displayAmount must be strictly less than totalAmount to hide liquidity',
      );
    }
  }

  private extractFirstOfferId(result: any): string {
    try {
      if (Array.isArray((result as any).offerResults)) {
        return String((result as any).offerResults[0]?.offerID ?? '');
      }
      return '';
    } catch {
      return '';
    }
  }

  private parseKeypair(secret: string): Keypair {
    try {
      return Keypair.fromSecret(secret);
    } catch {
      throw new BadRequestException('Invalid source secret key format');
    }
  }

  private async loadAccount(publicKey: string): Promise<Horizon.AccountResponse> {
    try {
      return await this.server.loadAccount(publicKey);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        throw new BadRequestException(
          'Source account not found on the Stellar network',
        );
      }
      throw new InternalServerErrorException(
        'Failed to load account from Stellar network',
      );
    }
  }

  private handleStellarError(error: any, fallbackMsg: string): never {
    if (
      error instanceof BadRequestException ||
      error instanceof InternalServerErrorException
    ) {
      throw error;
    }
    const opCode =
      error?.response?.data?.extras?.result_codes?.operations?.[0];
    if (opCode) {
      throw new BadRequestException(`Stellar operation failed: ${opCode}`);
    }
    this.logger.error(`${fallbackMsg}: ${error?.message}`);
    throw new InternalServerErrorException(fallbackMsg);
  }

  private toResponseDto(order: AdvancedOrder): IcebergOrderResponseDto {
    const data = order.icebergData!;
    const remaining = data.totalAmount - data.filledAmount;
    const fillPct =
      data.totalAmount > 0
        ? Number(((data.filledAmount / data.totalAmount) * 100).toFixed(2))
        : 0;

    return {
      id: order.id,
      userId: order.userId,
      positionId: order.positionId,
      status: order.status,
      sellingAssetCode: order.sellingAssetCode,
      buyingAssetCode: order.buyingAssetCode,
      limitPrice: data.limitPrice,
      totalAmount: data.totalAmount,
      displayAmount: data.displayAmount,
      filledAmount: data.filledAmount,
      remainingAmount: remaining,
      fillPercentage: fillPct,
      refillCount: data.refillCount,
      activeOfferId: data.activeOfferId,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
