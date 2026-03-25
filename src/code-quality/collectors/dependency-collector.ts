import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DependencyStatsDto } from '../dto/quality-report.dto';

const execAsync = promisify(exec);

@Injectable()
export class DependencyCollector {
  private readonly logger = new Logger(DependencyCollector.name);

  async collect(): Promise<DependencyStatsDto> {
    try {
      const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
      const total = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;

      let outdated = 0;
      let vulnerable = 0;

      try {
        const { stdout: outdatedOut } = await execAsync('npm outdated --json', { cwd: process.cwd(), timeout: 30000 });
        outdated = Object.keys(JSON.parse(outdatedOut || '{}')).length;
      } catch (e) {
        outdated = Object.keys(JSON.parse(e.stdout || '{}')).length;
      }

      try {
        const { stdout: auditOut } = await execAsync('npm audit --json', { cwd: process.cwd(), timeout: 60000 });
        const audit = JSON.parse(auditOut || '{}');
        vulnerable = audit.metadata?.vulnerabilities
          ? Object.values<number>(audit.metadata.vulnerabilities).reduce((a, b) => a + b, 0)
          : 0;
      } catch (e) {
        try {
          const audit = JSON.parse(e.stdout || '{}');
          vulnerable = audit.metadata?.vulnerabilities
            ? Object.values<number>(audit.metadata.vulnerabilities).reduce((a, b) => a + b, 0)
            : 0;
        } catch { /* ignore */ }
      }

      return { total, outdated, vulnerable, collectedAt: new Date() };
    } catch (err) {
      this.logger.warn(`Dependency collection failed: ${err.message}`);
      return { total: 0, outdated: 0, vulnerable: 0, collectedAt: new Date() };
    }
  }
}
