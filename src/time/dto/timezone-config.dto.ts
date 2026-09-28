import { IsString, IsOptional } from 'class-validator';

export class TimezoneConfigDto {
  @IsString()
  timezone!: string;

  @IsOptional()
  @IsString()
  locale?: string;
}
