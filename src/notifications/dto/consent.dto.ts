import { IsEnum, IsBoolean } from 'class-validator';
import { ConsentCategory } from '../entities/user-consent.entity';

export class UpdateConsentDto {
  @IsEnum(ConsentCategory)
  category!: ConsentCategory;

  @IsBoolean()
  optedIn!: boolean;
}

export interface ConsentStateDto {
  userId: string;
  consents: Array<{
    category: ConsentCategory;
    optedIn: boolean;
    updatedAt: Date;
  }>;
}
