export class CompetitionLeaderboardEntryDto {
  participantId!: string;
  userId!: string;
  username!: string;
  rank!: number;
  score!: number;
  tradeCount!: number;
}

export class CompetitionLeaderboardDto {
  competitionId!: string;
  competitionName!: string;
  status!: string;
  updatedAt!: Date;
  entries!: CompetitionLeaderboardEntryDto[];
}
