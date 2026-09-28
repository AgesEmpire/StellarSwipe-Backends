import { IsString, IsOptional, IsObject } from 'class-validator';

export class TicketRoutingRequestDto {
  @IsString()
  ticketId!: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString({ each: true })
  requiredSkills?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export interface TeamAssignment {
  ticketId: string;
  teamId: string;
  teamName: string;
  assignedAt: Date;
  routingRuleId: string | null;
  routingStrategy: string;
  confidence: number;
}
