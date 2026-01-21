import { Transform } from "class-transformer";
import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  ValidateIf,
} from "class-validator";

export class BaseOrderDto {
  @IsString()
  @IsNotEmpty()
  sourceSecret!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  sellingAssetCode!: string;

  @ValidateIf((dto) => dto.sellingAssetCode !== "XLM")
  @IsString()
  @IsNotEmpty()
  sellingAssetIssuer?: string;

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  buyingAssetCode!: string;

  @ValidateIf((dto) => dto.buyingAssetCode !== "XLM")
  @IsString()
  @IsNotEmpty()
  buyingAssetIssuer?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
