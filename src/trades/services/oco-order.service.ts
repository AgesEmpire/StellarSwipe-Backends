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
  OcoLeg,
  OcoOrderData,
} from '../entities/advanced-order.entity';
import {
  CancelOcoOrderDto,
  CreateOcoOrderDto,
  OcoOrderResponseDto,
} from '../dto/oco-order.dto';
import { StellarConfigService } from '../../config/stellar.service';
import { buildAsset } from './asset-utils';

@Injectable()
export class OcoOrderService {
  private readonly server: Horizon.Server;
  private readonly logger = new Logger(OcoOrderService.name);

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
   * Create a new OCO order.
   *
   * An OCO (One-Cancels-Other) order links two limit offers:
   *   • stop-loss  – cancels the take-profit when triggered
   *   • take-profit – cancels the stop-loss when triggered
   *
   * Both offers are placed immediately at the stated prices.
   * A monitoring loop (poll mechanism or event hook) must call `checkAndExecute`
   * periodically to detect fills and cancel the sibling.
   */
  async createOrder(dto: CreateOcoOrderDto): Promise<OcoOrderResponseDto> {
    // ── Validate prices ────────────────────────────────────────────────────
    this.validateOcoPrices(dto.stopLoss.triggerPrice, dto.takeProfit.triggerPrice);

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

    // ── Persist the order record first (ACTIVE, legs not yet submitted) ────
    const order = this.repo.create({
      userId: dto.userId,
      positionId: dto.positionId,
      orderType: AdvancedOrderType.OCO,
      status: AdvancedOrderStatus.ACTIVE,
      sellingAssetCode: dto.sellingAssetCode,
      sellingAssetIssuer: dto.sellingAssetIssuer,
      buyingAssetCode: dto.buyingAssetCode,
      buyingAssetIssuer: dto.buyingAssetIssuer,
      ocoData: {
        stopLoss: {
          triggerPrice: dto.stopLoss.triggerPrice,
          amount: dto.stopLoss.amount ?? dto.amount,
          executed: false,
        },
        takeProfit: {
          triggerPrice: dto.takeProfit.triggerPrice,
          amount: dto.takeProfit.amount ?? dto.amount,
          executed: false,
        },
      } as OcoOrderData,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });

    const saved = await this.repo.save(order);

    // ── Place both limit offers on-chain ───────────────────────────────────
    try {
      const keypair = this.parseKeypair(dto.sourceSecret);
      const account = await this.loadAccount(keypair.publicKey());

      const slAmount = (dto.stopLoss.amount ?? dto.amount).toFixed(7);
      const tpAmount = (dto.takeProfit.amount ?? dto.amount).toFixed(7);

      // Build a single transaction with two manageSellOffer operations
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.stellarConfig.networkPassphrase,
      })
        .addOperation(
          Operation.manageSellOffer({
            selling: sellingAsset,
            buying: buyingAsset,
            amount: slAmount,
            price: dto.stopLoss.triggerPrice.toFixed(7),
            offerId: '0',
          }),
        )
        .addOperation(
          Operation.manageSellOffer({
            selling: sellingAsset,
            buying: buyingAsset,
            amount: tpAmount,
            price: dto.takeProfit.triggerPrice.toFixed(7),
            offerId: '0',
          }),
        )
        .setTimeout(30)
        .build();

      tx.sign(keypair);

      const result = await this.server.submitTransaction(tx);
      this.logger.log(`OCO order submitted – tx: ${result.hash}`);

      // Parse offer IDs from the tx result operations
      const offerIds = this.extractOfferIds(result);

      // Update the order data with the real Stellar offer IDs
      saved.ocoData = {
        ...saved.ocoData!,
        stopLoss: {
          ...saved.ocoData!.stopLoss,
          offerId: offerIds[0],
          txHash: result.hash,
        },
        takeProfit: {
          ...saved.ocoData!.takeProfit,
          offerId: offerIds[1],
          txHash: result.hash,
        },
      };

      await this.repo.save(saved);
    } catch (error) {
      // Mark order as failed but keep the DB record for audit
      saved.status = AdvancedOrderStatus.CANCELLED;
      saved.errorMessage = (error as Error).message;
      await this.repo.save(saved);
      this.handleStellarError(error, 'Failed to place OCO order');
    }

    return this.toResponseDto(saved);
  }

  /**
   * Check live order-book and fills for an active OCO order.
   * Call this from a scheduler or any event hook.
   *
   * When one leg gets fully filled:
   *  1. Mark that leg as executed
   *  2. Cancel the sibling leg on-chain (manageSellOffer amount=0)
   *  3. Set order status to FILLED
   *
   * Edge-case – simultaneous fill: whichever leg is detected first wins;
   * the sibling cancel is idempotent (amount 0 on an already-filled offer
   * is a no-op on Stellar).
   */
  async checkAndExecute(orderId: string, sourceSecret: string): Promise<void> {
    const order = await this.repo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`OCO order ${orderId} not found`);
    if (order.status !== AdvancedOrderStatus.ACTIVE) return; // nothing to do

    const data = order.ocoData!;
    const keypair = this.parseKeypair(sourceSecret);

    // Determine which leg(s) fired by checking if their offer still exists
    const slFilled = await this.isOfferFilled(data.stopLoss.offerId);
    const tpFilled = await this.isOfferFilled(data.takeProfit.offerId);

    if (!slFilled && !tpFilled) return; // Neither leg triggered yet

    const triggeredLeg: OcoLeg = slFilled ? OcoLeg.STOP_LOSS : OcoLeg.TAKE_PROFIT;
    const siblingOfferId = slFilled
      ? data.takeProfit.offerId
      : data.stopLoss.offerId;

    this.logger.log(
      `OCO order ${orderId}: ${triggeredLeg} triggered – cancelling sibling offer ${siblingOfferId}`,
    );

    // Cancel sibling on-chain
    if (siblingOfferId) {
      try {
        await this.cancelOffer(keypair, siblingOfferId);
      } catch (err) {
        // Best-effort: log but don't block the status update
        this.logger.warn(
          `Could not cancel sibling offer ${siblingOfferId}: ${(err as Error).message}`,
        );
      }
    }

    // Update DB record
    const now = new Date().toISOString();
    if (triggeredLeg === OcoLeg.STOP_LOSS) {
      data.stopLoss.executed = true;
      data.stopLoss.executedAt = now;
    } else {
      data.takeProfit.executed = true;
      data.takeProfit.executedAt = now;
    }
    data.triggeredLeg = triggeredLeg;

    order.ocoData = data;
    order.status = AdvancedOrderStatus.FILLED;
    order.executedAt = new Date();
    await this.repo.save(order);

    this.logger.log(`OCO order ${orderId} completed via ${triggeredLeg}`);
  }

  /**
   * Cancel both legs of an active OCO order.
   */
  async cancelOrder(dto: CancelOcoOrderDto): Promise<OcoOrderResponseDto> {
    const order = await this.repo.findOne({
      where: { id: dto.orderId, userId: dto.userId },
    });

    if (!order) {
      throw new NotFoundException(`OCO order not found`);
    }

    if (order.status !== AdvancedOrderStatus.ACTIVE) {
      throw new ConflictException(
        `OCO order is already ${order.status} and cannot be cancelled`,
      );
    }

    const keypair = this.parseKeypair(dto.sourceSecret);
    const data = order.ocoData!;

    const cancelErrors: string[] = [];

    for (const [leg, snapshot] of [
      ['stopLoss', data.stopLoss] as const,
      ['takeProfit', data.takeProfit] as const,
    ]) {
      if (snapshot.offerId && !snapshot.executed) {
        try {
          await this.cancelOffer(keypair, snapshot.offerId);
        } catch (err) {
          const msg = `Failed to cancel ${leg} offer ${snapshot.offerId}: ${(err as Error).message}`;
          this.logger.error(msg);
          cancelErrors.push(msg);
        }
      }
    }

    if (cancelErrors.length === 2) {
      // Both cancels failed – abort
      throw new InternalServerErrorException(
        `Could not cancel OCO order offers: ${cancelErrors.join('; ')}`,
      );
    }

    order.status = AdvancedOrderStatus.CANCELLED;
    order.cancelledAt = new Date();
    if (cancelErrors.length > 0) {
      order.errorMessage = cancelErrors.join('; ');
    }
    await this.repo.save(order);

    return this.toResponseDto(order);
  }

  /**
   * Retrieve a single OCO order for a given user.
   */
  async getOrder(orderId: string, userId: string): Promise<OcoOrderResponseDto> {
    const order = await this.repo.findOne({
      where: { id: orderId, userId, orderType: AdvancedOrderType.OCO },
    });
    if (!order) throw new NotFoundException(`OCO order not found`);
    return this.toResponseDto(order);
  }

  /**
   * List all OCO orders for a user.
   */
  async listOrders(
    userId: string,
    status?: AdvancedOrderStatus,
  ): Promise<OcoOrderResponseDto[]> {
    const where: Record<string, any> = {
      userId,
      orderType: AdvancedOrderType.OCO,
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
   * Validate that stop-loss < current price < take-profit (directionally).
   * Since we don't know current price here, we simply enforce SL < TP.
   */
  private validateOcoPrices(stopLossPrice: number, takeProfitPrice: number): void {
    if (stopLossPrice <= 0 || takeProfitPrice <= 0) {
      throw new BadRequestException('OCO prices must be positive');
    }
    if (stopLossPrice >= takeProfitPrice) {
      throw new BadRequestException(
        'Stop-loss price must be strictly less than take-profit price',
      );
    }
  }

  /**
   * Check if a Stellar offer is no longer on the order book (i.e. filled / cancelled).
   * Returns true when the offer is gone (filled).
   */
  private async isOfferFilled(offerId?: string): Promise<boolean> {
    if (!offerId) return false;
    try {
      await this.server.offers().offer(offerId).call();
      return false; // Still exists → not filled yet
    } catch (err: any) {
      if (err?.response?.status === 404) return true; // Gone → filled
      this.logger.warn(`Error checking offer ${offerId}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Cancel a Stellar offer by setting its amount to 0.
   */
  private async cancelOffer(keypair: Keypair, offerId: string): Promise<void> {
    const account = await this.loadAccount(keypair.publicKey());

    // We need the asset pair to cancel.  Use native XLM as placeholder –
    // Stellar ignores asset on deletion when offerId is non-zero and amount=0.
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.stellarConfig.networkPassphrase,
    })
      .addOperation(
        Operation.manageSellOffer({
          selling: Asset.native(),
          buying: new Asset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'),
          amount: '0',
          price: '1',
          offerId,
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    await this.server.submitTransaction(tx);
    this.logger.log(`Cancelled offer ${offerId}`);
  }

  /**
   * Extract Stellar offer IDs created in a submitted transaction result.
   * Offer IDs live in the operation results as `offerID`.
   */
  private extractOfferIds(result: any): string[] {
    try {
      const ids: string[] = [];

      // If horizon returns offer IDs directly:
      if (Array.isArray((result as any).offerResults)) {
        for (const r of (result as any).offerResults) {
          ids.push(String(r.offerID ?? r.offer_id ?? ''));
        }
      }

      return ids.length > 0 ? ids : ['', ''];
    } catch {
      return ['', ''];
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

  private toResponseDto(order: AdvancedOrder): OcoOrderResponseDto {
    const data = order.ocoData!;
    return {
      id: order.id,
      userId: order.userId,
      positionId: order.positionId,
      status: order.status,
      sellingAssetCode: order.sellingAssetCode,
      buyingAssetCode: order.buyingAssetCode,
      stopLossTriggerPrice: data.stopLoss.triggerPrice,
      takeProfitTriggerPrice: data.takeProfit.triggerPrice,
      amount: data.stopLoss.amount,
      triggeredLeg: data.triggeredLeg,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
