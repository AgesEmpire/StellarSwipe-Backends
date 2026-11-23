export interface ContractEvent {
  type: string;
  contractId?: string;
  topics?: unknown[];
  data?: unknown;
}

export interface ContractResult {
  success: boolean;
  hash?: string;
  status?: string;
  result?: unknown;
  events?: ContractEvent[];
  feeCharged?: string;
  error?: string;
  /** Last ledger (inclusive) in which the submitted envelope could be included. */
  lastValidLedger?: number;
}
