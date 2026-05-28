import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class InvalidateSessionDto {
  @ValidateIf((dto: InvalidateSessionDto) => !dto.userId)
  @IsString()
  @IsNotEmpty()
  sessionId?: string;

  @ValidateIf((dto: InvalidateSessionDto) => !dto.sessionId)
  @IsString()
  @IsNotEmpty()
  userId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
