import { IsInt, Min } from 'class-validator';

export class ThrottleConfigDto {
  @IsInt()
  @Min(1)
  limit: number;

  @IsInt()
  @Min(1)
  ttlSeconds: number;
}
