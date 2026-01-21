import { IsEnum, IsNumber, IsPositive } from "class-validator";
import { BaseOrderDto } from "./base-order.dto";
import { OrderType } from "./order-type.enum";

export class LimitOrderDto extends BaseOrderDto {
  @IsEnum(OrderType)
  orderType: OrderType = OrderType.LIMIT;

  @IsNumber()
  @IsPositive()
  price!: number;
}
