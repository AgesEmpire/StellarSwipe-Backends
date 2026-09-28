import {
  IsString,
  IsArray,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  ArrayNotEmpty,
  IsEnum,
} from 'class-validator';
import { ApiKeyScope } from '../enums/api-key-scope.enum';

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  /** Scopes granted to this key. Must be values from ApiKeyScope. */
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ApiKeyScope, { each: true })
  scopes!: ApiKeyScope[];

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(10000)
  rateLimit?: number;

  @IsOptional()
  expiresAt?: Date;
}
