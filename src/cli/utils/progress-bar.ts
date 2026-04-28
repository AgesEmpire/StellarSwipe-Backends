export function progressBar(current: number, total: number, width = 30): string {
  const pct = total === 0 ? 1 : current / total;
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `[${bar}] ${current}/${total} (${Math.round(pct * 100)}%)`;
}
