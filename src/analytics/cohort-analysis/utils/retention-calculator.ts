export const calculateRetentionRates = (
  activeUsersByPeriod: number[],
  cohortSize: number,
): number[] => {
  if (cohortSize <= 0) {
    return activeUsersByPeriod.map(() => 0);
  }
  return activeUsersByPeriod.map((activeUsers) =>
    Number(((activeUsers / cohortSize) * 100).toFixed(2)),
  );
};
