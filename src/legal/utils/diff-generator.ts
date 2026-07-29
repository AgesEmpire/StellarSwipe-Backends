import { Injectable } from '@nestjs/common';

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: number;
}

@Injectable()
export class DiffGenerator {
  generateDiff(oldContent: string, newContent: string): DiffLine[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diff: DiffLine[] = [];

    // Simple line-by-line diff
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === undefined) {
        diff.push({ type: 'added', content: newLine, lineNumber: i + 1 });
      } else if (newLine === undefined) {
        diff.push({ type: 'removed', content: oldLine, lineNumber: i + 1 });
      } else if (oldLine !== newLine) {
        diff.push({ type: 'removed', content: oldLine, lineNumber: i + 1 });
        diff.push({ type: 'added', content: newLine, lineNumber: i + 1 });
      } else {
        diff.push({ type: 'unchanged', content: oldLine, lineNumber: i + 1 });
      }
    }

    return diff;
  }

  summarizeDiff(diff: DiffLine[]): { added: number; removed: number; unchanged: number } {
    return {
      added: diff.filter((l) => l.type === 'added').length,
      removed: diff.filter((l) => l.type === 'removed').length,
      unchanged: diff.filter((l) => l.type === 'unchanged').length,
    };
  }
}
