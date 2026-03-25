import { Injectable, Logger } from '@nestjs/common';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { ComplexityMetricsDto } from '../dto/complexity-metrics.dto';

@Injectable()
export class ComplexityCollector {
  private readonly logger = new Logger(ComplexityCollector.name);

  async collect(): Promise<ComplexityMetricsDto> {
    try {
      const srcPath = join(process.cwd(), 'src');
      const files = await this.getTypeScriptFiles(srcPath);
      const results = await Promise.all(files.map(f => this.analyzeFile(f)));

      const valid = results.filter(r => r.complexity > 0);
      const avg = valid.length ? valid.reduce((s, r) => s + r.complexity, 0) / valid.length : 0;
      const max = valid.length ? Math.max(...valid.map(r => r.complexity)) : 0;
      const highComplexityFiles = valid.filter(r => r.complexity > 10).map(r => ({ file: r.file, complexity: r.complexity }));
      const technicalDebtMinutes = highComplexityFiles.reduce((s, f) => s + (f.complexity - 10) * 30, 0);

      return {
        averageCyclomaticComplexity: Math.round(avg * 10) / 10,
        maxCyclomaticComplexity: max,
        highComplexityFiles,
        technicalDebtMinutes,
        collectedAt: new Date(),
      };
    } catch (err) {
      this.logger.warn(`Complexity collection failed: ${err.message}`);
      return { averageCyclomaticComplexity: 0, maxCyclomaticComplexity: 0, highComplexityFiles: [], technicalDebtMinutes: 0, collectedAt: new Date() };
    }
  }

  private async analyzeFile(filePath: string): Promise<{ file: string; complexity: number }> {
    try {
      const content = await readFile(filePath, 'utf8');
      // Count decision points: if, else if, for, while, case, catch, &&, ||, ternary
      const matches = content.match(/\b(if|else if|for|while|case|catch)\b|&&|\|\||(?<!\?)\?(?!\?)/g);
      return { file: filePath.replace(process.cwd(), ''), complexity: 1 + (matches?.length ?? 0) };
    } catch {
      return { file: filePath, complexity: 0 };
    }
  }

  private async getTypeScriptFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !['node_modules', 'dist', 'coverage'].includes(entry.name)) {
          files.push(...(await this.getTypeScriptFiles(full)));
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          files.push(full);
        }
      }
    } catch { /* skip unreadable dirs */ }
    return files;
  }
}
