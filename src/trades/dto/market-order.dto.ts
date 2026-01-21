import { IsEnum, IsNumber, IsOptional, Max, Min } from "class-validator";
import { BaseOrderDto } from "./base-order.dto";
import { OrderType } from "./order-type.enum";

export class MarketOrderDto extends BaseOrderDto {
  @IsEnum(OrderType)
  orderType: OrderType = OrderType.MARKET;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  maxSlippagePercent = 1;
}
