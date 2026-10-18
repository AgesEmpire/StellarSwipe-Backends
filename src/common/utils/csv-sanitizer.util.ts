/**
 * CSV Cell Sanitizer — prevents spreadsheet formula injection (CSV Injection / DDE).
 *
 * When a CSV cell begins with `=`, `+`, `-`, `@`, `\t`, `\r`, or `\n` a
 * spreadsheet application may evaluate the remainder as a formula.  An attacker
 * who controls user-facing data (usernames, asset codes, memo fields, etc.) can
 * craft payloads such as `=CMD|'/C calc'!A0` to execute arbitrary commands on
 * the machine of whoever opens the exported file.
 *
 * This utility neutralises the threat by:
 *   1. Stripping leading whitespace (spaces, tabs, carriage-returns, newlines)
 *      that could mask a formula prefix.
 *   2. Prepending a single-quote (`'`) when the (trimmed) value starts with a
 *      known formula trigger character.  The single-quote is the standard
 *      "text prefix" recognised by Excel / Google Sheets / LibreOffice Calc and
 *      prevents formula evaluation while keeping the visible cell value intact.
 *
 * The function is intentionally a **pure, dependency-free** helper so it can be
 * called from every CSV export path without pulling in framework modules.
 *
 * @see https://owasp.org/www-community/attacks/CSV_Injection
 */

/** Characters that trigger formula evaluation in major spreadsheet apps. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r', '\n']);

/**
 * Sanitise a single CSV cell value to prevent formula injection.
 *
 * @param value — the raw cell value (string, number, Date, null, or undefined).
 * @returns      the sanitised string safe for embedding in a CSV field.
 */
export function sanitizeCsvCell(
  value: string | number | Date | null | undefined,
): string {
  if (value === null || value === undefined) return '';

  const str = value instanceof Date ? value.toISOString() : String(value);

  if (str.length === 0) return '';

  // 1. Direct trigger check on raw string (handles \t, \r, \n, =, +, -, @)
  if (FORMULA_TRIGGERS.has(str[0])) {
    return `'${str}`;
  }

  // 2. Strip leading whitespace that could hide a trigger character
  const trimmed = str.replace(/^[\s\uFEFF\xA0]+/, '');

  if (trimmed.length === 0) return str;

  if (FORMULA_TRIGGERS.has(trimmed[0])) {
    return `'${trimmed}`;
  }

  return str;
}

/**
 * Convenience wrapper: sanitise **and** RFC-4180–escape a cell in one call.
 *
 * 1. Neutralises formula triggers via {@link sanitizeCsvCell}.
 * 2. Wraps the result in double-quotes and escapes embedded quotes when the
 *    value contains a comma, double-quote, or newline.
 */
export function sanitizeAndEscapeCsvCell(
  value: string | number | Date | null | undefined,
): string {
  const safe = sanitizeCsvCell(value);
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
