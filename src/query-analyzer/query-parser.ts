import * as crypto from 'crypto';

export interface ParsedQuery {
  type: QueryType;
  normalizedSql: string;
  hash: string;
  tables: string[];
  columns: string[];
  hasWhere: boolean;
  hasOrderBy: boolean;
  hasGroupBy: boolean;
  hasLimit: boolean;
  hasSubquery: boolean;
  hasDistinct: boolean;
  joinCount: number;
  joinTypes: JoinType[];
  aggregateFunctions: string[];
  estimatedComplexity: number;
  isParameterized: boolean;
}

export enum QueryType {
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  WITH = 'WITH', // CTE
  UNKNOWN = 'UNKNOWN',
}

export enum JoinType {
  INNER = 'INNER JOIN',
  LEFT = 'LEFT JOIN',
  RIGHT = 'RIGHT JOIN',
  FULL = 'FULL JOIN',
  CROSS = 'CROSS JOIN',
  LATERAL = 'LATERAL',
}

// ─── Regex Patterns ───────────────────────────────────────────────────────────

const PATTERNS = {
  lineComment: /--[^\r\n]*/g,
  blockComment: /\/\*[\s\S]*?\*\//g,
  stringLiterals: /'(?:[^']|'')*'/g,
  numericParams: /\$\d+/g,
  inlineNumbers: /\b\d+(?:\.\d+)?\b/g,
  whitespace: /\s+/g,

  tableFrom: /\bFROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
  tableJoin: /\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
  tableInto: /\bINTO\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
  tableUpdate: /\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
  tableDeleteFrom: /\bDELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi,
  subquery: /\(\s*SELECT\b/gi,

  innerJoin: /\bINNER\s+JOIN\b/gi,
  leftJoin: /\bLEFT\s+(OUTER\s+)?JOIN\b/gi,
  rightJoin: /\bRIGHT\s+(OUTER\s+)?JOIN\b/gi,
  fullJoin: /\bFULL\s+(OUTER\s+)?JOIN\b/gi,
  crossJoin: /\bCROSS\s+JOIN\b/gi,
  lateralJoin: /\bLATERAL\b/gi,

  aggregates: /\b(COUNT|SUM|AVG|MAX|MIN|STRING_AGG|ARRAY_AGG|JSON_AGG|BOOL_AND|BOOL_OR)\s*\(/gi,
};

export class QueryParser {
  /**
   * Full parse of a SQL query — normalizes it, extracts metadata, and computes a hash.
   */
  static parse(rawSql: string): ParsedQuery {
    const stripped = QueryParser.stripCommentsAndLiterals(rawSql);
    const normalized = QueryParser.normalize(stripped);
    const type = QueryParser.detectType(normalized);
    const tables = QueryParser.extractTables(normalized, type);
    const columns = QueryParser.extractSelectedColumns(normalized);
    const joinTypes = QueryParser.extractJoinTypes(normalized);
    const aggregates = QueryParser.extractAggregates(normalized);
    const subqueryMatches = normalized.match(PATTERNS.subquery) ?? [];
    const complexity = QueryParser.computeComplexity({
      joinCount: joinTypes.length,
      subqueryCount: subqueryMatches.length,
      aggregateCount: aggregates.length,
      hasGroupBy: /\bGROUP\s+BY\b/i.test(normalized),
      hasOrderBy: /\bORDER\s+BY\b/i.test(normalized),
      tableCount: tables.length,
    });

    return {
      type,
      normalizedSql: normalized,
      hash: QueryParser.hashQuery(normalized),
      tables,
      columns,
      hasWhere: /\bWHERE\b/i.test(normalized),
      hasOrderBy: /\bORDER\s+BY\b/i.test(normalized),
      hasGroupBy: /\bGROUP\s+BY\b/i.test(normalized),
      hasLimit: /\bLIMIT\b/i.test(normalized),
      hasSubquery: subqueryMatches.length > 0,
      hasDistinct: /\bDISTINCT\b/i.test(normalized),
      joinCount: joinTypes.length,
      joinTypes,
      aggregateFunctions: aggregates,
      estimatedComplexity: complexity,
      isParameterized: PATTERNS.numericParams.test(rawSql),
    };
  }

  // ─── Normalisation ──────────────────────────────────────────────────────────

  static normalize(sql: string): string {
    return sql
      .replace(PATTERNS.stringLiterals, "'?'")
      .replace(PATTERNS.inlineNumbers, '?')
      .replace(PATTERNS.whitespace, ' ')
      .trim()
      .toUpperCase();
  }

  static stripCommentsAndLiterals(sql: string): string {
    return sql
      .replace(PATTERNS.blockComment, ' ')
      .replace(PATTERNS.lineComment, ' ');
  }

  // ─── Type Detection ─────────────────────────────────────────────────────────

  static detectType(normalizedSql: string): QueryType {
    const first = normalizedSql.trimStart().substring(0, 10).toUpperCase();
    if (first.startsWith('SELECT')) return QueryType.SELECT;
    if (first.startsWith('INSERT')) return QueryType.INSERT;
    if (first.startsWith('UPDATE')) return QueryType.UPDATE;
    if (first.startsWith('DELETE')) return QueryType.DELETE;
    if (first.startsWith('WITH')) return QueryType.WITH;
    return QueryType.UNKNOWN;
  }

  // ─── Table Extraction ───────────────────────────────────────────────────────

  static extractTables(normalizedSql: string, type: QueryType): string[] {
    const found = new Set<string>();
    const patterns = [
      PATTERNS.tableFrom,
      PATTERNS.tableJoin,
      ...(type === QueryType.INSERT ? [PATTERNS.tableInto] : []),
      ...(type === QueryType.UPDATE ? [PATTERNS.tableUpdate] : []),
      ...(type === QueryType.DELETE ? [PATTERNS.tableDeleteFrom] : []),
    ];

    for (const pattern of patterns) {
      // reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(normalizedSql)) !== null) {
        const table = match[1].replace(/^public\./i, '').toLowerCase();
        if (!['WHERE', 'SET', 'ON', 'AND', 'OR', 'SELECT'].includes(table.toUpperCase())) {
          found.add(table);
        }
      }
    }

    return [...found];
  }

  // ─── Column Extraction ──────────────────────────────────────────────────────

  static extractSelectedColumns(normalizedSql: string): string[] {
    const selectMatch = normalizedSql.match(/^SELECT\s+([\s\S]+?)\s+FROM\b/i);
    if (!selectMatch) return [];
    const raw = selectMatch[1];
    if (raw.trim() === '*') return ['*'];

    return raw
      .split(',')
      .map((col) => col.trim().split(/\s+AS\s+/i)[0].trim())
      .map((col) => col.split('.').pop() ?? col)
      .filter((col) => col.length > 0 && col !== '?');
  }

  // ─── Join Analysis ──────────────────────────────────────────────────────────

  static extractJoinTypes(normalizedSql: string): JoinType[] {
    const types: JoinType[] = [];
    const checks: [RegExp, JoinType][] = [
      [PATTERNS.innerJoin, JoinType.INNER],
      [PATTERNS.leftJoin, JoinType.LEFT],
      [PATTERNS.rightJoin, JoinType.RIGHT],
      [PATTERNS.fullJoin, JoinType.FULL],
      [PATTERNS.crossJoin, JoinType.CROSS],
      [PATTERNS.lateralJoin, JoinType.LATERAL],
    ];

    for (const [pattern, joinType] of checks) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(normalizedSql)) !== null) {
        types.push(joinType);
      }
    }

    return types;
  }

  // ─── Aggregate Extraction ───────────────────────────────────────────────────

  static extractAggregates(normalizedSql: string): string[] {
    const found: string[] = [];
    PATTERNS.aggregates.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATTERNS.aggregates.exec(normalizedSql)) !== null) {
      found.push(match[1].toUpperCase());
    }
    return found;
  }

  // ─── Complexity Score ───────────────────────────────────────────────────────

  static computeComplexity(opts: {
    joinCount: number;
    subqueryCount: number;
    aggregateCount: number;
    hasGroupBy: boolean;
    hasOrderBy: boolean;
    tableCount: number;
  }): number {
    let score = 0;
    score += opts.tableCount * 2;
    score += opts.joinCount * 5;
    score += opts.subqueryCount * 8;
    score += opts.aggregateCount * 3;
    if (opts.hasGroupBy) score += 4;
    if (opts.hasOrderBy) score += 2;
    return score;
  }

  // ─── Hashing ────────────────────────────────────────────────────────────────

  static hashQuery(normalizedSql: string): string {
    return crypto.createHash('sha256').update(normalizedSql).digest('hex');
  }
}
