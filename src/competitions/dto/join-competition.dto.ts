import { IsNotEmpty, IsUUID } from 'class-validator';

export class JoinCompetitionDto {
  @IsUUID()
  @IsNotEmpty()
  userId!: string;
}
