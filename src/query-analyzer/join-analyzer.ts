import { Injectable } from '@nestjs/common';
import { ParsedQuery, JoinType } from '../utils/query-parser';
import { PlanSummary } from '../utils/execution-plan-reader';
import { CreateOptimizationDto } from '../dto/optimization-suggestion.dto';
import {
  OptimizationType,
  OptimizationPriority,
} from '../entities/query-optimization.entity';

export interface JoinIssue {
  type: JoinIssueType;
  description: string;
  rewriteSuggestion?: string;
  estimatedImprovement: number;
}

export enum JoinIssueType {
  CARTESIAN_PRODUCT = 'cartesian_product',
  NESTED_LOOP_ON_LARGE_SET = 'nested_loop_on_large_set',
  MISSING_JOIN_CONDITION = 'missing_join_condition',
  IMPLICIT_CROSS_JOIN = 'implicit_cross_join',
  SUBOPTIMAL_ORDER = 'suboptimal_order',
  N_PLUS_ONE_PATTERN = 'n_plus_one_pattern',
  REDUNDANT_JOIN = 'redundant_join',
}

@Injectable()
export class JoinAnalyzer {
  analyze(
    parsedQuery: ParsedQuery,
    planSummary: PlanSummary,
    slowQueryId: string,
  ): CreateOptimizationDto[] {
    const issues = this.detectIssues(parsedQuery, planSummary);
    return issues.map((issue) => this.toOptimizationDto(issue, slowQueryId));
  }

  // ─── Issue Detection ──────────────────────────────────────────────────────────

  private detectIssues(
    parsedQuery: ParsedQuery,
    planSummary: PlanSummary,
  ): JoinIssue[] {
    const issues: JoinIssue[] = [];

    // 1. Cartesian product (CROSS JOIN or missing ON)
    if (parsedQuery.joinTypes.includes(JoinType.CROSS)) {
      issues.push({
        type: JoinIssueType.CARTESIAN_PRODUCT,
        description:
          'CROSS JOIN detected. This produces a row for every combination of the joined tables and will explode in size as data grows.',
        rewriteSuggestion:
          'Replace CROSS JOIN with an INNER JOIN and add an ON clause matching the related foreign keys.',
        estimatedImprovement: 80,
      });
    }

    // 2. Nested loop on large result set
    if (planSummary.nestedLoopCount > 0 && planSummary.maxRows > 10_000) {
      issues.push({
        type: JoinIssueType.NESTED_LOOP_ON_LARGE_SET,
        description: `Nested Loop join detected over ${planSummary.maxRows.toLocaleString()} rows. Nested loops are O(n×m) and degrade severely at this scale.`,
        rewriteSuggestion:
          'Ensure both join sides have indexes on the join keys. The planner will then prefer a Hash Join or Merge Join. Alternatively, materialise the smaller side with a CTE.',
        estimatedImprovement: 60,
      });
    }

    // 3. Inefficient hash join (large hash table for tiny result)
    if (planSummary.isInefficientHashJoin) {
      issues.push({
        type: JoinIssueType.SUBOPTIMAL_ORDER,
        description:
          'Hash Join was chosen for a join that returns very few rows. The planner may have incorrect row estimates, leading to a hash table build that is disproportionally expensive.',
        rewriteSuggestion:
          'Run `ANALYZE <table>` to refresh planner statistics, or add `enable_hashjoin = off` to a targeted `SET LOCAL` to force a Nested Loop with index support.',
        estimatedImprovement: 30,
      });
    }

    // 4. N+1 pattern: many identical queries differing only in a parameter
    if (parsedQuery.tables.length === 1 && parsedQuery.joinCount === 0 && parsedQuery.hasWhere) {
      issues.push({
        type: JoinIssueType.N_PLUS_ONE_PATTERN,
        description:
          'Single-table lookup with a WHERE clause executed in a hot path. This is a common sign of an N+1 query pattern where a loop runs this query once per parent record.',
        rewriteSuggestion:
          'Batch all IDs into a single query using `WHERE id = ANY($1::uuid[])` or rewrite with a JOIN to the parent query.',
        estimatedImprovement: 70,
      });
    }

    // 5. RIGHT JOIN (usually a code smell — LEFT JOIN is conventional)
    if (parsedQuery.joinTypes.includes(JoinType.RIGHT)) {
      issues.push({
        type: JoinIssueType.SUBOPTIMAL_ORDER,
        description:
          'RIGHT JOIN detected. While functionally correct, right joins are unconventional and may confuse the query planner into choosing a sub-optimal join order.',
        rewriteSuggestion:
          'Rewrite as a LEFT JOIN by swapping the table order. The result is identical but the planner has better heuristics for left joins.',
        estimatedImprovement: 10,
      });
    }

    // 6. More than 5 joins — risk of bad ordering
    if (parsedQuery.joinCount > 5) {
      issues.push({
        type: JoinIssueType.SUBOPTIMAL_ORDER,
        description: `${parsedQuery.joinCount} joins detected. PostgreSQL's join-ordering heuristics become exponentially less reliable above 8 tables (controlled by join_collapse_limit).`,
        rewriteSuggestion:
          'Break the query into CTEs (WITH clauses) to give the planner deterministic ordering, or raise `join_collapse_limit` carefully in a session.',
        estimatedImprovement: 25,
      });
    }

    return issues;
  }

  // ─── DTO Mapping ──────────────────────────────────────────────────────────────

  private toOptimizationDto(
    issue: JoinIssue,
    slowQueryId: string,
  ): CreateOptimizationDto {
    const priorityMap: Record<JoinIssueType, OptimizationPriority> = {
      [JoinIssueType.CARTESIAN_PRODUCT]: OptimizationPriority.CRITICAL,
      [JoinIssueType.NESTED_LOOP_ON_LARGE_SET]: OptimizationPriority.HIGH,
      [JoinIssueType.N_PLUS_ONE_PATTERN]: OptimizationPriority.HIGH,
      [JoinIssueType.MISSING_JOIN_CONDITION]: OptimizationPriority.CRITICAL,
      [JoinIssueType.IMPLICIT_CROSS_JOIN]: OptimizationPriority.CRITICAL,
      [JoinIssueType.SUBOPTIMAL_ORDER]: OptimizationPriority.MEDIUM,
      [JoinIssueType.REDUNDANT_JOIN]: OptimizationPriority.LOW,
    };

    const titleMap: Record<JoinIssueType, string> = {
      [JoinIssueType.CARTESIAN_PRODUCT]: 'Remove Cartesian Product (CROSS JOIN)',
      [JoinIssueType.NESTED_LOOP_ON_LARGE_SET]: 'Optimise Nested Loop on Large Dataset',
      [JoinIssueType.N_PLUS_ONE_PATTERN]: 'Eliminate N+1 Query Pattern',
      [JoinIssueType.MISSING_JOIN_CONDITION]: 'Add Missing JOIN Condition',
      [JoinIssueType.IMPLICIT_CROSS_JOIN]: 'Fix Implicit Cross Join',
      [JoinIssueType.SUBOPTIMAL_ORDER]: 'Improve Join Ordering / Strategy',
      [JoinIssueType.REDUNDANT_JOIN]: 'Remove Redundant JOIN',
    };

    return {
      slowQueryId,
      type: OptimizationType.JOIN_OPTIMIZATION,
      priority: priorityMap[issue.type],
      title: titleMap[issue.type],
      description: `${issue.description}${issue.rewriteSuggestion ? `\n\nSuggestion: ${issue.rewriteSuggestion}` : ''}`,
      estimatedImprovement: issue.estimatedImprovement,
      estimatedTimeSavedMs: undefined,
      metadata: { issueType: issue.type },
    };
  }
}
