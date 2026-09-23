export interface RecoveryCodeStatus {
  remainingCodes: number;
  generatedAt: Date | null;
  totalUsed: number;
}

export interface RecoveryCodeConsumeResult {
  remainingCodes: number;
}

export interface RecoveryCodeGenerationResult {
  codes: string[];
  count: number;
}
