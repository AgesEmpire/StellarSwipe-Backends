import { IsString, IsNotEmpty } from 'class-validator';

export class FreighterChallengeDto {
  @IsString()
  @IsNotEmpty()
  publicKey!: string;
}

export class FreighterVerifyDto {
  @IsString()
  @IsNotEmpty()
  publicKey!: string;

  @IsString()
  @IsNotEmpty()
  signature!: string;

  @IsString()
  @IsNotEmpty()
  challenge!: string;
}

export class FreighterActionDto {
  @IsString()
  @IsNotEmpty()
  publicKey!: string;

  @IsString()
  @IsNotEmpty()
  signature!: string;

  @IsString()
  @IsNotEmpty()
  payload!: string;
}
