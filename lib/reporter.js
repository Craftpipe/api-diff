'use strict';

const chalk = require('chalk');

// ─── Constants ────────────────────────────────────────────────────────────────

const INDENT = '  ';
const SEPARATOR = chalk.gray('─'.repeat(60));
const THIN_SEPARATOR = chalk.gray('·'.repeat(40));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a chalk-colored string for an HTTP status code.
 * 2xx → green, 3xx → cyan, 4xx → yellow, 5xx → red, null → red.
 *
 * @param {number|null} status
 * @returns {string}
 */
function colorStatus(status) {
  if (status === null || status === undefined) return chalk.red('(none)');
  if (status >= 200 && status < 300) return chalk.green(String(status));
  if (status >= 300 && status < 400) return chalk.cyan(String(status));
  if (status >= 400 && status < 500) return chalk.yellow(String(status));
  return chalk.red(String(status));
}

/**
 * Formats a value for inline display, truncating long strings/objects.
 *
 * @param {*} value
 * @param {number} [maxLen=80]
 * @returns {string}
 */
function formatValue(value, maxLen) {
  maxLen = maxLen || 80;
  if (value === null) return chalk.italic('null');
  if (value === undefined) return chalk.italic('undefined');
  let str;
  if (typeof value === 'object') {
    try {
      str = JSON.stringify(value);
    } catch (_) {
      str = String(value);
    }
  } else {
    str = String(value);
  }
  if (str.length > maxLen) {
    str = str.slice(0, maxLen - 3) + '...';
  }
  return str;
}

/**
 * Returns a colored kind badge for a diff entry kind string.
 *
 * @param {string} kind - 'added' | 'removed' | 'changed' | 'type_changed'
 * @returns {string}
 */
function kindBadge(kind) {
  switch (kind) {
    case 'added':        return chalk.green.bold('[+]');
    case 'removed':      return chalk.red.bold('[-]');
    case 'changed':      return chalk.yellow.bold('[~]');
    case 'type_changed': return chalk.magenta.bold('[T]');
    default:             return chalk.gray(`[${kind}]`);
  }
}

/**
 * Returns a colored breaking indicator string.
 *
 * @param {boolean} breaking
 * @param {string} [reason]
 * @returns {string}
 */
function breakingLabel(breaking, reason) {
  if (breaking) {
    const tag = chalk.bgRed.white.bold(' BREAKING ');
    return reason ? `${tag} ${chalk.red.dim(reason)}` : tag;
  }
  return chalk.green.dim('non-breaking');
}

/**
 * Pads a label string to a fixed width for aligned columns.
 *
 * @param {string} label
 * @param {number} width
 * @returns {string}
 */
function padLabel(label, width) {
  return label.length >= width ? label : label + ' '.repeat(width - label.length);
}

// ─── Section Printers ─────────────────────────────────────────────────────────

/**
 * Prints the top-level report header.
 *
 * @param {Object} reportMeta
 * @param {string} reportMeta.baselineFile
 * @param {string} reportMeta.currentFile
 * @param {string} reportMeta.generatedAt
 * @param {number} reportMeta.totalEndpoints
 * @param {number} reportMeta.totalDiffs
 * @param {number} reportMeta.breakingCount
 * @param {number} reportMeta.nonBreakingCount
 * @param {number} reportMeta.unchangedCount
 * @param {number} reportMeta.errorCount
 */
function printReportHeader(reportMeta) {
  const {
    baselineFile,
    currentFile,
    generatedAt,
    totalEndpoints,
    totalDiffs,
    breakingCount,
    nonBreakingCount,
    unchangedCount,
    errorCount,
  } = reportMeta;

  console.log('');
  console.log(SEPARATOR);
  console.log(chalk.cyan.bold('  api-diff — Comparison Report'));
  console.log(SEPARATOR);
  console.log('');
  console.log(`  ${chalk.gray(padLabel('Baseline:', 14))} ${chalk.white(baselineFile)}`);
  console.log(`  ${chalk.gray(padLabel('Current:', 14))}  ${chalk.white(currentFile)}`);
  console.log(`  ${chalk.gray(padLabel('Generated:', 14))} ${chalk.white(generatedAt)}`);
  console.log('');
  console.log(THIN_SEPARATOR);
  console.log('');

  const endpointStr = chalk.white.bold(String(totalEndpoints));
  const diffStr     = totalDiffs > 0 ? chalk.yellow.bold(String(totalDiffs)) : chalk.green.bold('0');
  const breakStr    = breakingCount > 0 ? chalk.red.bold(String(breakingCount)) : chalk.green.bold('0');
  const nonBreakStr = chalk.green.bold(String(nonBreakingCount));
  const unchangedStr = chalk.gray(String(unchangedCount));
  const errorStr    = errorCount > 0 ? chalk.red.bold(String(errorCount)) : chalk.gray('0');

  console.log(`  ${chalk.gray('Endpoints:')}    ${endpointStr}`);
  console.log(`  ${chalk.gray('Total diffs:')} ${diffStr}`);
  console.log(`  ${chalk.gray('Breaking:')}    ${breakStr}`);
  console.log(`  ${chalk.gray('Non-breaking:')} ${nonBreakStr}`);
  console.log(`  ${chalk.gray('Unchanged:')}   ${unchangedStr}`);
  if (errorCount > 0) {
    console.log(`  ${chalk.gray('Errors:')}      ${errorStr}`);
  }
  console.log('');
}

/**
 * Prints a single diff entry line with path, kind badge, values, and breaking status.
 *
 * @param {import('./differ').DiffEntry} entry
 * @param {string} indent
 */
function printDiffEntry(entry, indent) {
  indent = indent || INDENT + INDENT;

  const badge = kindBadge(entry.kind);
  const pathStr = chalk.white(entry.path || '(root)');
  const breaking = breakingLabel(entry.breaking, entry.breakingReason);

  let valueLine = '';
  switch (entry.kind) {
    case 'added':
      valueLine = `${chalk.green('+')} ${chalk.green(formatValue(entry.newValue))}`;
      break;
    case 'removed':
      valueLine = `${chalk.red('-')} ${chalk.red(formatValue(entry.oldValue))}`;
      break;
    case 'changed':
      valueLine = (
        `${chalk.red(formatValue(entry.oldValue))}` +
        chalk.gray(' → ') +
        `${chalk.green(formatValue(entry.newValue))}`
      );
      break;
    case 'type_changed':
      valueLine = (
        `${chalk.red(formatValue(entry.oldValue))}` +
        chalk.gray(` (${entry.oldType}) → `) +
        `${chalk.green(formatValue(entry.newValue))}` +
        chalk.gray(` (${entry.newType})`)
      );
      break;
    default:
      valueLine = formatValue(entry.newValue !== undefined ? entry.newValue : entry.oldValue);
  }

  console.log(`${indent}${badge} ${pathStr}`);
  console.log(`${indent}   ${chalk.gray('value:')}   ${valueLine}`);
  console.log(`${indent}   ${chalk.gray('impact:')}  ${breaking}`);
}

/**
 * Prints the diff section for a single endpoint result.
 *
 * @param {import('./differ').EndpointDiffResult} result
 * @param {number} index - 1-based index for display
 * @param {number} total - total number of endpoints
 */
function printEndpointResult(result, index, total) {
  const {
    name,
    url,
    method,
    oldStatus,
    newStatus,
    statusChanged,
    statusChangeBreaking,
    statusChangeReason,
    diffs,
    error,
    hasChanges,
    breakingChanges,
    nonBreakingChanges,
  } = result;

  const counter = chalk.gray(`[${index}/${total}]`);
  const methodStr = chalk.cyan.bold((method || 'GET').toUpperCase());
  const nameStr = chalk.white.bold(name || url);

  console.log(SEPARATOR);
  console.log(`  ${counter} ${methodStr} ${nameStr}`);
  console.log(`  ${chalk.gray('URL:')} ${chalk.gray.underline(url)}`);
  console.log('');

  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    console.log(`  ${chalk.red.bold('✖  Error:')} ${chalk.red(error)}`);
    console.log('');
    return;
  }

  // ── Status codes ─────────────────────────────────────────────────────────
  const oldStatusStr = colorStatus(oldStatus);
  const newStatusStr = colorStatus(newStatus);

  if (statusChanged) {
    const arrow = chalk.gray('→');
    const changeTag = statusChangeBreaking
      ? chalk.bgRed.white.bold(' BREAKING ')
      : chalk.green.dim('non-breaking');
    console.log(
      `  ${chalk.gray('Status:')} ${oldStatusStr} ${arrow} ${newStatusStr}  ${changeTag}`
    );
    if (statusChangeReason) {
      console.log(`  ${chalk.gray('         ')} ${chalk.red.dim(statusChangeReason)}`);
    }
  } else {
    console.log(`  ${chalk.gray('Status:')} ${newStatusStr} ${chalk.gray.dim('(unchanged)')}`);
  }

  console.log('');

  // ── No body diffs ─────────────────────────────────────────────────────────
  if (!Array.isArray(diffs) || diffs.length === 0) {
    if (!statusChanged) {
      console.log(`  ${chalk.green('✔')}  ${chalk.gray('No changes detected.')}`);
    } else {
      console.log(`  ${chalk.gray('No body-level changes detected.')}`);
    }
    console.log('');
    return;
  }

  // ── Summary counts ────────────────────────────────────────────────────────
  const bCount  = typeof breakingChanges === 'number' ? breakingChanges : diffs.filter(d => d.breaking).length;
  const nbCount = typeof nonBreakingChanges === 'number' ? nonBreakingChanges : diffs.filter(d => !d.breaking).length;

  const bStr  = bCount > 0 ? chalk.red.bold(`${bCount} breaking`) : null;
  const nbStr = nbCount > 0 ? chalk.green(`${nbCount} non-breaking`) : null;
  const parts = [bStr, nbStr].filter(Boolean).join(chalk.gray(', '));

  console.log(`  ${chalk.yellow.bold(`${diffs.length} diff(s)`)} — ${parts}`);
  console.log('');

  // ── Diff entries ──────────────────────────────────────────────────────────
  const breaking    = diffs.filter(d => d.breaking);
  const nonBreaking = diffs.filter(d => !d.breaking);

  if (breaking.length > 0) {
    console.log(`  ${chalk.red.bold('Breaking Changes:')}`);
    for (const entry of breaking) {
      printDiffEntry(entry, INDENT + INDENT);
      console.log('');
    }
  }

  if (nonBreaking.length > 0) {
    console.log(`  ${chalk.yellow('Non-Breaking Changes:')}`);
    for (const entry of nonBreaking) {
      printDiffEntry(entry, INDENT + INDENT);
      console.log('');
    }
  }
}

/**
 * Prints the final summary footer of the report.
 *
 * @param {Object} summary
 * @param {number} summary.totalEndpoints
 * @param {number} summary.breakingCount
 * @param {number} summary.nonBreakingCount
 * @param {number} summary.unchangedCount
 * @param {number} summary.errorCount
 */
function printReportFooter(summary) {
  const {
    totalEndpoints,
    breakingCount,
    nonBreakingCount,
    unchangedCount,
    errorCount,
  } = summary;

  console.log(SEPARATOR);
  console.log('');
  console.log(chalk.cyan.bold('  Summary'));
  console.log('');

  console.log(`  ${chalk.gray(padLabel('Endpoints checked:', 22))} ${chalk.white.bold(String(totalEndpoints))}`);
  console.log(`  ${chalk.gray(padLabel('Breaking changes:', 22))} ${breakingCount > 0 ? chalk.red.bold(String(breakingCount)) : chalk.green.bold('0')}`);
  console.log(`  ${chalk.gray(padLabel('Non-breaking changes:', 22))} ${chalk.green(String(nonBreakingCount))}`);
  console.log(`  ${chalk.gray(padLabel('Unchanged endpoints:', 22))} ${chalk.gray(String(unchangedCount))}`);

  if (errorCount > 0) {
    console.log(`  ${chalk.gray(padLabel('Errors:', 22))} ${chalk.red.bold(String(errorCount))}`);
  }

  console.log('');

  if (breakingCount > 0) {
    console.log(`  ${chalk.bgRed.white.bold(' ✖  BREAKING CHANGES DETECTED ')}  ${chalk.red(`${breakingCount} endpoint(s) affected`)}`);
  } else if (nonBreakingCount > 0 || unchangedCount === totalEndpoints) {
    console.log(`  ${chalk.green.bold('✔  No breaking changes detected.')}`);
  } else {
    console.log(`  ${chalk.green.bold('✔  All endpoints unchanged.')}`);
  }

  console.log('');
  console.log(SEPARATOR);
  console.log('');
}

/**
 * Renders a full diff report to the terminal.
 *
 * Accepts the structured report object produced by `lib/differ.js` and
 * prints a color-coded, hierarchical summary to stdout using chalk.
 *
 * @param {Object} report - The full diff report object
 * @param {Object} report.meta - Report metadata (files, timestamps, counts)
 * @param {import('./differ').EndpointDiffResult[]} report.results - Per-endpoint diff results
 */
function printReport(report) {
  if (!report || typeof report !== 'object') {
    console.error(chalk.red('✖  reporter.printReport: invalid report object'));
    return;
  }

  const meta    = report.meta    || {};
  const results = report.results || [];

  // ── Header ────────────────────────────────────────────────────────────────
  printReportHeader({
    baselineFile:    meta.baselineFile    || '(unknown)',
    currentFile:     meta.currentFile     || '(unknown)',
    generatedAt:     meta.generatedAt     || new Date().toISOString(),
    totalEndpoints:  meta.totalEndpoints  || results.length,
    totalDiffs:      meta.totalDiffs      || 0,
    breakingCount:   meta.breakingCount   || 0,
    nonBreakingCount: meta.nonBreakingCount || 0,
    unchangedCount:  meta.unchangedCount  || 0,
    errorCount:      meta.errorCount      || 0,
  });

  // ── Per-endpoint sections ─────────────────────────────────────────────────
  results.forEach(function (result, i) {
    printEndpointResult(result, i + 1, results.length);
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  printReportFooter({
    totalEndpoints:   meta.totalEndpoints  || results.length,
    breakingCount:    meta.breakingCount   || 0,
    nonBreakingCount: meta.nonBreakingCount || 0,
    unchangedCount:   meta.unchangedCount  || 0,
    errorCount:       meta.errorCount      || 0,
  });
}

/**
 * Prints a simple one-line status for a snapshot fetch operation.
 * Used during the snapshot phase to give live feedback per endpoint.
 *
 * @param {string} label - Endpoint name or URL
 * @param {number|null} status - HTTP status code, or null on error
 * @param {number|null} latencyMs - Round-trip latency in ms
 * @param {string|null} [error] - Error message if the request failed
 */
function printSnapshotLine(label, status, latencyMs, error) {
  const prefix = chalk.gray(`  Fetching ${chalk.white(label)} ... `);
  if (error) {
    console.log(prefix + chalk.red(`✖  ERROR: ${error}`));
  } else {
    const statusStr  = colorStatus(status);
    const latencyStr = latencyMs !== null && latencyMs !== undefined
      ? chalk.gray(` (${latencyMs}ms)`)
      : '';
    console.log(prefix + chalk.green('✔  ') + statusStr + latencyStr);
  }
}

/**
 * Prints a styled header for snapshot mode.
 */
function printSnapshotHeader() {
  console.log('');
  console.log(chalk.cyan.bold('  api-diff — Snapshot Mode'));
  console.log('');
}

/**
 * Prints a success message after a snapshot is saved.
 *
 * @param {string} outputPath - Absolute or relative path to the saved file
 */
function printSnapshotSaved(outputPath) {
  console.log(chalk.green.bold(`\n  ✔  Snapshot saved → ${outputPath}\n`));
}

/**
 * Prints a styled error message to stderr.
 *
 * @param {string} message
 */
function printError(message) {
  console.error(chalk.red(`✖  ${message}`));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  printReport,
  printEndpointResult,
  printDiffEntry,
  printReportHeader,
  printReportFooter,
  printSnapshotLine,
  printSnapshotHeader,
  printSnapshotSaved,
  printError,
  colorStatus,
  formatValue,
};