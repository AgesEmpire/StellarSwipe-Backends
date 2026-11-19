import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TicketPriority,
  TicketCategory,
  TicketStatus,
} from './support-ticket.entity';

export class CreateTicketDto {
  @IsString()
  @MinLength(5)
  @MaxLength(150)
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @IsEnum(TicketCategory)
  category: TicketCategory;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsString()
  customerId: string;

  @IsEmail()
  customerEmail: string;

  @IsString()
  customerName: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

export class UpdateTicketDto {
  @IsEnum(TicketCategory)
  @IsOptional()
  category?: TicketCategory;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsString()
  @IsOptional()
  assignedAgentId?: string;

  @IsString()
  @IsOptional()
  assignedAgentName?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

export class AddNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;

  @IsString()
  authorId: string;

  @IsString()
  authorName: string;

  @IsOptional()
  isInternal?: boolean;
}

export class FilterTicketsDto {
  @IsEnum(TicketCategory)
  @IsOptional()
  category?: TicketCategory;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsString()
  @IsOptional()
  assignedAgentId?: string;

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsOptional()
  slaBreached?: boolean;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

export class SearchTicketsDto {
  @IsString()
  @IsNotEmpty()
  requesterId: string;

  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsDateString()
  @IsOptional()
  createdAfter?: string;

  @IsDateString()
  @IsOptional()
  createdBefore?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
