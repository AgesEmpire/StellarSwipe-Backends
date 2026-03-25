import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CoverageStatsDto } from '../dto/coverage-stats.dto';

const execAsync = promisify(exec);

@Injectable()
export class CoverageCollector {
  private readonly logger = new Logger(CoverageCollector.name);

  async collect(): Promise<CoverageStatsDto> {
    try {
      const { stdout } = await execAsync('npx jest --coverage --coverageReporters=json-summary --passWithNoTests 2>/dev/null', {
        cwd: process.cwd(),
        timeout: 120000,
      });

      const summaryMatch = stdout.match(/coverage-summary\.json/);
      if (summaryMatch) {
        const { readFile } = await import('fs/promises');
        const raw = JSON.parse(await readFile('coverage/coverage-summary.json', 'utf8'));
        const total = raw.total;
        return {
          lines: total.lines.pct,
          statements: total.statements.pct,
          functions: total.functions.pct,
          branches: total.branches.pct,
          uncoveredFiles: Object.keys(raw).filter(k => k !== 'total' && raw[k].lines.pct < 50),
          collectedAt: new Date(),
        };
      }
    } catch (err) {
      this.logger.warn(`Coverage collection failed: ${err.message}`);
    }

    return { lines: 0, statements: 0, functions: 0, branches: 0, uncoveredFiles: [], collectedAt: new Date() };
  }
}
