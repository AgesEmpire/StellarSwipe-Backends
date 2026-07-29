export interface BatchableTransaction {
  id: string;
  amount: number;
  asset: string;
  userId: string;
  priority?: number;
}

export interface TransactionBatch {
  batchId: string;
  transactions: BatchableTransaction[];
  totalAmount: number;
  estimatedFee: number;
}

export function groupByAsset(transactions: BatchableTransaction[]): Map<string, BatchableTransaction[]> {
  const groups = new Map<string, BatchableTransaction[]>();
  for (const tx of transactions) {
    const group = groups.get(tx.asset) ?? [];
    group.push(tx);
    groups.set(tx.asset, group);
  }
  return groups;
}

export function buildBatch(transactions: BatchableTransaction[], batchId: string): TransactionBatch {
  const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const estimatedFee = Math.max(0.001, totalAmount * 0.0001);
  return { batchId, transactions, totalAmount, estimatedFee };
}

export function sortByPriority(transactions: BatchableTransaction[]): BatchableTransaction[] {
  return [...transactions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}
