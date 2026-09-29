import { IsHexadecimal, Length } from 'class-validator';

export class VerifyWebhookEndpointDto {
  @IsHexadecimal()
  @Length(64, 64)
  token!: string;
}
