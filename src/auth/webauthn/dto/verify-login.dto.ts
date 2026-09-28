import { IsNotEmpty, IsObject } from 'class-validator';

export class VerifyWebauthnLoginDto {
  @IsNotEmpty({ message: 'assertionResponse is required' })
  @IsObject()
  assertionResponse!: Record<string, unknown>;
}
