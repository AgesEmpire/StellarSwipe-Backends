import { IsString, Length } from 'class-validator';

export class ClaimReferralDto {
  @IsString()
  @Length(8, 8, { message: 'Referral code must be exactly 8 characters' })
  referralCode!: string;
}
