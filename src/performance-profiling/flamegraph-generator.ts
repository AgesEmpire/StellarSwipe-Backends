import { Injectable, Logger } from '@nestjs/common';
import { CpuSample } from '../collectors/cpu-profiler';

export interface FlameNode {
  name: string;
  value: number; // self time
  children: FlameNode[];
}

export interface FlameGraphData {
  root: FlameNode;
  totalSamples: number;
  generatedAt: Date;
  hotspots: Array<{ name: string; selfTimePercent: number; totalTimePercent: number }>;
}

@Injectable()
export class FlameGraphGenerator {
  private readonly logger = new Logger(FlameGraphGenerator.name);

  /**
   * Generate a flame-graph-compatible data structure from CPU samples.
   *
   * In production you'd integrate with v8-profiler-next or 0x to get real
   * V8 profiler stacks. Here we build a representative tree from the OS-level
   * CPU time breakdown so the structure is always available without native addons.
   */
  generate(samples: CpuSample[]): FlameGraphData {
    if (!samples.length) {
      return {
        root: { name: 'root', value: 0, children: [] },
        totalSamples: 0,
        generatedAt: new Date(),
        hotspots: [],
      };
    }

    const root: FlameNode = { name: 'root', value: 0, children: [] };
    let totalValue = 0;

    for (const sample of samples) {
      const { usagePercent, userTimeMs, systemTimeMs } = sample.snapshot;

      const sampleValue = Math.round(usagePercent);
      totalValue += sampleValue;

      // Build a two-level synthetic call tree: user / system split
      this.mergeNode(root, 'process', sampleValue);

      const processNode = root.children.find((c) => c.name === 'process')!;
      if (userTimeMs > systemTimeMs) {
        this.mergeNode(processNode, 'userland', Math.round((userTimeMs / (userTimeMs + systemTimeMs)) * sampleValue));
        this.mergeNode(processNode, 'kernel', Math.round((systemTimeMs / (userTimeMs + systemTimeMs)) * sampleValue));
      } else {
        this.mergeNode(processNode, 'kernel', Math.round(sampleValue * 0.6));
        this.mergeNode(processNode, 'userland', Math.round(sampleValue * 0.4));
      }
    }

    root.value = totalValue;

    const hotspots = this.extractHotspots(root, totalValue);

    return {
      root,
      totalSamples: samples.length,
      generatedAt: new Date(),
      hotspots,
    };
  }

  /**
   * Emit the flame graph in the Brendan Gregg collapsed stack format.
   * Compatible with flamegraph.pl and speedscope.
   */
  toCollapsedFormat(data: FlameGraphData): string {
    const lines: string[] = [];
    this.walkCollapsed(data.root, [], lines);
    return lines.join('\n');
  }

  /**
   * Convert to a format consumable by d3-flame-graph / speedscope.
   */
  toSpeedscopeFormat(data: FlameGraphData): Record<string, any> {
    return {
      $schema: 'https://www.speedscope.app/file-formats/0.0.1/',
      shared: { frames: this.extractFrames(data.root) },
      profiles: [
        {
          type: 'sampled',
          name: 'CPU Profile',
          unit: 'none',
          startValue: 0,
          endValue: data.totalSamples,
          samples: [[0]],
          weights: [data.totalSamples],
        },
      ],
      name: 'NestJS CPU Profile',
      activeProfileIndex: 0,
      exporter: 'nestjs-profiler',
    };
  }

  private mergeNode(parent: FlameNode, name: string, value: number): void {
    let child = parent.children.find((c) => c.name === name);
    if (!child) {
      child = { name, value: 0, children: [] };
      parent.children.push(child);
    }
    child.value += value;
  }

  private walkCollapsed(
    node: FlameNode,
    stack: string[],
    lines: string[],
  ): void {
    const current = [...stack, node.name];
    if (node.children.length === 0 && node.value > 0) {
      lines.push(`${current.join(';')} ${node.value}`);
      return;
    }
    for (const child of node.children) {
      this.walkCollapsed(child, current, lines);
    }
    // Self time
    const childrenValue = node.children.reduce((s, c) => s + c.value, 0);
    const selfValue = node.value - childrenValue;
    if (selfValue > 0) {
      lines.push(`${current.join(';')} ${selfValue}`);
    }
  }

  private extractHotspots(
    root: FlameNode,
    total: number,
  ): Array<{ name: string; selfTimePercent: number; totalTimePercent: number }> {
    const map: Record<string, { self: number; total: number }> = {};

    const walk = (node: FlameNode): void => {
      if (!map[node.name]) map[node.name] = { self: 0, total: 0 };
      const childTotal = node.children.reduce((s, c) => s + c.value, 0);
      map[node.name].self += Math.max(0, node.value - childTotal);
      map[node.name].total += node.value;
      node.children.forEach(walk);
    };
    walk(root);

    return Object.entries(map)
      .map(([name, { self, total: t }]) => ({
        name,
        selfTimePercent: total > 0 ? Math.round((self / total) * 10000) / 100 : 0,
        totalTimePercent: total > 0 ? Math.round((t / total) * 10000) / 100 : 0,
      }))
      .filter((h) => h.selfTimePercent > 0)
      .sort((a, b) => b.selfTimePercent - a.selfTimePercent)
      .slice(0, 20);
  }

  private extractFrames(root: FlameNode): Array<{ name: string }> {
    const frames: Array<{ name: string }> = [];
    const walk = (node: FlameNode): void => {
      frames.push({ name: node.name });
      node.children.forEach(walk);
    };
    walk(root);
    return frames;
  }
}
