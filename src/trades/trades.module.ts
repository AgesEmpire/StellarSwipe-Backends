import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StellarConfigService } from "../config/stellar.service";
import { TradesController } from "./trades.controller";
import { LimitOrderService } from "./services/limit-order.service";
import { MarketOrderService } from "./services/market-order.service";

@Module({
  imports: [ConfigModule],
  controllers: [TradesController],
  providers: [
    StellarConfigService,
    MarketOrderService,
    LimitOrderService,
  ],
})
export class TradesModule {}
