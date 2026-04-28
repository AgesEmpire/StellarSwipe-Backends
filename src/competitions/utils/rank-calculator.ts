export function assignRanks<T>(
  items: T[],
  scoreOf: (item: T) => number,
  higherIsBetter = true,
): Map<T, number> {
  const sorted = [...items].sort((a, b) =>
    higherIsBetter ? scoreOf(b) - scoreOf(a) : scoreOf(a) - scoreOf(b),
  );
  const rankByItem = new Map<T, number>();
  let rank = 1;
  let i = 0;
  while (i < sorted.length) {
    const score = scoreOf(sorted[i]!);
    let j = i + 1;
    while (j < sorted.length && scoreOf(sorted[j]!) === score) {
      j += 1;
    }
    for (let k = i; k < j; k += 1) {
      rankByItem.set(sorted[k]!, rank);
    }
    rank += j - i;
    i = j;
  }
  return rankByItem;
}
