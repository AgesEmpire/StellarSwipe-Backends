export function calculateConversionRate(entered: number, completed: number): number {
  if (entered === 0) return 0;
  return parseFloat(((completed / entered) * 100).toFixed(2));
}

export function calculateStepConversions(
  stepCounts: { stepOrder: number; count: number }[],
): { stepOrder: number; entered: number; conversionRate: number; dropOffRate: number }[] {
  return stepCounts.map((step, index) => {
    const entered = index === 0 ? step.count : stepCounts[index - 1].count;
    const conversionRate = calculateConversionRate(entered, step.count);
    return {
      stepOrder: step.stepOrder,
      entered,
      conversionRate,
      dropOffRate: parseFloat((100 - conversionRate).toFixed(2)),
    };
  });
}
