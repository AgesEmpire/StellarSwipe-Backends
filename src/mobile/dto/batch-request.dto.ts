import { IsArray, IsString, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BatchRequestItem {
  @IsString()
  id: string;

  @IsString()
  path: string;
}

export class BatchRequestDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BatchRequestItem)
  requests: BatchRequestItem[];
}

export class BatchResponseItem<T = unknown> {
  id: string;
  status: number;
  body: T;
}
