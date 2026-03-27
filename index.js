#!/usr/bin/env node

'use strict';

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { diff } = require('deep-diff');
const chalk = require('chalk');

const pkg = require('./package.json');

// ─── Utilities ───────────────────────────────────────────────────────────────

function loadJson(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${abs}: ${e.message}`);
  }
}

function saveJson(filePath, data) {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8');
}

function timestamp() {
  return new Date().toISOString();
}

function slugify(url) {
  return url.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// ─── HTTP Fetcher ─────────────────────────────────────────────────────────────

async function fetchEndpoint(endpointCfg, globalHeaders) {
  const {
    url,
    method = 'GET',
    headers: localHeaders = {},
    body = undefined,
    name = url,
  } = endpointCfg;

  const mergedHeaders = Object.assign({}, globalHeaders, localHeaders);
  const options = {
    method: method.toUpperCase(),
    headers: mergedHeaders,
    timeout: 15000,
  };

  if (body && !['GET', 'HEAD'].includes(options.method)) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!mergedHeaders['Content-Type'] && !mergedHeaders['content-type']) {
      options.headers['Content-Type'] = 'application/json';
    }
  }

  let status = null;
  let responseBody = null;
  let responseHeaders = {};
  let error = null;
  let latencyMs = null;

  const start = Date.now();
  try {
    const res = await fetch(url, options);
    latencyMs = Date.now() - start;
    status = res.status;
    responseHeaders = Object.fromEntries(res.headers.entries());
    const text = await res.text();
    try {
      responseBody = JSON.parse(text);
    } catch (_) {
      responseBody = text;
    }
  } catch (e) {
    latencyMs = Date.now() - start;
    error = e.message;
  }

  return {
    name,
    url,
    method: options.method,
    status,
    headers: responseHeaders,
    body: responseBody,
    error,
    latencyMs,
    fetchedAt: timestamp(),
  };
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

async function runSnapshot(configPath, outputPath) {
  console.log(chalk.cyan.bold('\n  api-diff — Snapshot Mode\n'));

  let config;
  try {
    config = loadJson(configPath);
  } catch (e) {
    console.error(chalk.red(`✖  Failed to load config: ${e.message}`));
    process.exit(1);
  }

  const endpoints = config.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    console.error(chalk.red('✖  Config must have a non-empty "endpoints" array.'));
    process.exit(1);
  }

  const globalHeaders = config.headers || {};
  const results = [];

  for (const ep of endpoints) {
    const label = ep.name || ep.url;
    process.stdout.write(chalk.gray(`  Fetching ${chalk.white(label)} ... `));
    const result = await fetchEndpoint(ep, globalHeaders);
    if (result.error) {
      console.log(chalk.red(`✖  ERROR: ${result.error}`));
    } else {
      console.log(chalk.green(`✔  ${result.status}`) + chalk.gray(` (${result.latencyMs}ms)`));
    }
    results.push(result);
  }

  const snapshot = {
    snapshotVersion: pkg.version,
    createdAt: timestamp(),
    configPath: path.resolve(configPath),
    results,
  };

  const out = outputPath || `snapshot-${Date.now()}.json`;
  try {
    saveJson(out, snapshot);
    console.log(chalk.green.bold(`\n  ✔  Snapshot saved → ${path.resolve(out)}\n`));
  } catch (e) {
    console.error(chalk.red(`✖  Failed to save snapshot: ${e.message}`));
    process.exit(1);
  }
}

// ─── Diff ────────────────────────────────────────────────────────────────────

function classifyDiff(d) {
  // Returns 'breaking' or 'non-breaking' based on diff kind
  // D = deleted, E = edited, N = new, A = array
  if (d.kind === 'D') return 'breaking';
  if (d.kind === 'E') return 'breaking';
  if (d.kind === 'N') return 'non-breaking';
  if (d.kind === 'A') return 'non-breaking';
  return 'non-breaking';
}

function diffSnapshots(snapA, snapB) {
  const resultsA = {};
  const resultsB = {};

  for (const r of snapA.results) {
    resultsA[r.name] = r;
  }
  for (const r of snapB.results) {
    resultsB[r.name] = r;
  }

  const allNames = new Set([...Object.keys(resultsA), ...Object.keys(resultsB)]);
  const endpointDiffs = [];

  for (const name of allNames) {
    const a = resultsA[name];
    const b = resultsB[name];

    if (!a) {
      endpointDiffs.push({ name, status: 'added', breaking: false, changes: [] });
      continue;
    }
    if (!b) {
      endpointDiffs.push({ name, status: 'removed', breaking: true, changes: [] });
      continue;
    }

    const changes = [];
    let hasBreaking = false;

    // Status code change
    if (a.status !== b.status) {
      const breaking = (a.status >= 200 && a.status < 300) && !(b.status >= 200 && b.status < 300);
      if (breaking) hasBreaking = true;
      changes.push({
        type: 'status',
        breaking,
        from: a.status,
        to: b.status,
        description: `Status changed from ${a.status} to ${b.status}`,
      });
    }

    // Body diff
    if (typeof a.body === 'object' && typeof b.body === 'object') {
      const bodyDiffs = diff(a.body, b.body) || [];
      for (const d of bodyDiffs) {
        const classification = classifyDiff(d);
        if (classification === 'breaking') hasBreaking = true;
        changes.push({
          type: 'body',
          breaking: classification === 'breaking',
          kind: d.kind,
          path: d.path ? d.path.join('.') : '(root)',
          from: d.lhs,
          to: d.rhs,
          description: `Body field "${d.path ? d.path.join('.') : '(root)'}" ${d.kind === 'D' ? 'deleted' : d.kind === 'N' ? 'added' : 'changed'}`,
        });
      }
    } else if (a.body !== b.body) {
      hasBreaking = true;
      changes.push({
        type: 'body',
        breaking: true,
        from: a.body,
        to: b.body,
        description: 'Response body changed',
      });
    }

    endpointDiffs.push({
      name,
      status: changes.length === 0 ? 'unchanged' : 'changed',
      breaking: hasBreaking,
      changes,
    });
  }

  return {
    diffVersion: pkg.version,
    createdAt: timestamp(),
    snapshotA: snapA.createdAt,
    snapshotB: snapB.createdAt,
    summary: {
      total: endpointDiffs.length,
      unchanged: endpointDiffs.filter(e => e.status === 'unchanged').length,
      changed: endpointDiffs.filter(e => e.status === 'changed').length,
      added: endpointDiffs.filter(e => e.status === 'added').length,
      removed: endpointDiffs.filter(e => e.status === 'removed').length,
      breaking: endpointDiffs.filter(e => e.breaking).length,
    },
    endpoints: endpointDiffs,
  };
}

async function runDiff(snapshotAPath, snapshotBPath, outputPath) {
  console.log(chalk.cyan.bold('\n  api-diff — Diff Mode\n'));

  let snapA, snapB;
  try {
    snapA = loadJson(snapshotAPath);
  } catch (e) {
    console.error(chalk.red(`✖  Failed to load snapshot A: ${e.message}`));
    process.exit(1);
  }
  try {
    snapB = loadJson(snapshotBPath);
  } catch (e) {
    console.error(chalk.red(`✖  Failed to load snapshot B: ${e.message}`));
    process.exit(1);
  }

  const result = diffSnapshots(snapA, snapB);

  const out = outputPath || `diff-${Date.now()}.json`;
  try {
    saveJson(out, result);
    console.log(chalk.green.bold(`\n  ✔  Diff saved → ${path.resolve(out)}\n`));
  } catch (e) {
    console.error(chalk.red(`✖  Failed to save diff: ${e.message}`));
    process.exit(1);
  }

  // Print summary
  const s = result.summary;
  console.log(chalk.bold('  Summary:'));
  console.log(`    Total endpoints : ${s.total}`);
  console.log(`    Unchanged       : ${chalk.green(s.unchanged)}`);
  console.log(`    Changed         : ${chalk.yellow(s.changed)}`);
  console.log(`    Added           : ${chalk.blue(s.added)}`);
  console.log(`    Removed         : ${chalk.red(s.removed)}`);
  console.log(`    Breaking        : ${s.breaking > 0 ? chalk.red.bold(s.breaking) : chalk.green(s.breaking)}`);
  console.log();
}

// ─── Report ──────────────────────────────────────────────────────────────────

function buildHtmlReport(diffData) {
  const s = diffData.summary;
  const rows = diffData.endpoints.map(ep => {
    const statusColor = ep.status === 'unchanged' ? '#22c55e'
      : ep.status === 'added' ? '#3b82f6'
      : ep.status === 'removed' ? '#ef4444'
      : ep.breaking ? '#ef4444' : '#f59e0b';

    const changesHtml = ep.changes.length === 0
      ? '<em style="color:#6b7280">No changes</em>'
      : ep.changes.map(c => {
          const color = c.breaking ? '#ef4444' : '#f59e0b';
          return `<div style="margin:4px 0;padding:4px 8px;border-left:3px solid ${color};background:#1e1e2e">
            <span style="color:${color};font-weight:bold">${c.breaking ? '⚠ BREAKING' : '~ non-breaking'}</span>
            <span style="color:#cdd6f4;margin-left:8px">${escapeHtml(c.description)}</span>
            ${c.from !== undefined ? `<div style="color:#6b7280;font-size:0.85em;margin-top:2px">from: <code>${escapeHtml(JSON.stringify(c.from))}</code> → to: <code>${escapeHtml(JSON.stringify(c.to))}</code></div>` : ''}
          </div>`;
        }).join('');

    return `<tr>
      <td style="padding:10px 12px;font-weight:bold;color:#cdd6f4">${escapeHtml(ep.name)}</td>
      <td style="padding:10px 12px;text-align:center">
        <span style="background:${statusColor};color:#fff;padding:2px 10px;border-radius:12px;font-size:0.85em;font-weight:bold">${ep.status.toUpperCase()}</span>
      </td>
      <td style="padding:10px 12px;text-align:center;color:${ep.breaking ? '#ef4444' : '#22c55e'}">${ep.breaking ? '⚠ Yes' : '✔ No'}</td>
      <td style="padding:10px 12px">${changesHtml}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>api-diff Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #11111b; color: #cdd6f4; padding: 32px; }
    h1 { font-size: 1.8rem; color: #89b4fa; margin-bottom: 8px; }
    .meta { color: #6b7280; font-size: 0.9em; margin-bottom: 24px; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 32px; }
    .stat { background: #1e1e2e; border-radius: 10px; padding: 16px 24px; min-width: 120px; text-align: center; }
    .stat .num { font-size: 2rem; font-weight: bold; }
    .stat .label { font-size: 0.8em; color: #6b7280; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #1e1e2e; border-radius: 10px; overflow: hidden; }
    th { background: #181825; color: #89b4fa; padding: 12px; text-align: left; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; }
    tr:nth-child(even) td { background: #181825; }
    td { vertical-align: top; }
    code { background: #313244; padding: 1px 4px; border-radius: 4px; font-size: 0.85em; }
    footer { margin-top: 32px; color: #6b7280; font-size: 0.8em; text-align: center; }
  </style>
</head>
<body>
  <h1>🔍 api-diff Report</h1>
  <div class="meta">
    Snapshot A: ${escapeHtml(diffData.snapshotA)} &nbsp;→&nbsp; Snapshot B: ${escapeHtml(diffData.snapshotB)}<br>
    Generated: ${escapeHtml(diffData.createdAt)}
  </div>
  <div class="summary">
    <div class="stat"><div class="num" style="color:#cdd6f4">${s.total}</div><div class="label">Total</div></div>
    <div class="stat"><div class="num" style="color:#22c55e">${s.unchanged}</div><div class="label">Unchanged</div></div>
    <div class="stat"><div class="num" style="color:#f59e0b">${s.changed}</div><div class="label">Changed</div></div>
    <div class="stat"><div class="num" style="color:#3b82f6">${s.added}</div><div class="label">Added</div></div>
    <div class="stat"><div class="num" style="color:#ef4444">${s.removed}</div><div class="label">Removed</div></div>
    <div class="stat"><div class="num" style="color:${s.breaking > 0 ? '#ef4444' : '#22c55e'}">${s.breaking}</div><div class="label">Breaking</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Endpoint</th>
        <th style="text-align:center">Status</th>
        <th style="text-align:center">Breaking</th>
        <th>Changes</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <footer>Generated by api-diff v${escapeHtml(pkg.version)} &mdash; Built with AI by Craftpipe</footer>
</body>
</html>`;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function runReport(diffPath, outputPath) {
  console.log(chalk.cyan.bold('\n  api-diff — Report Mode\n'));

  let diffData;
  try {
    diffData = loadJson(diffPath);
  } catch (e) {
    console.error(chalk.red(`✖  Failed to load diff file: ${e.message}`));
    process.exit(1);
  }

  const html = buildHtmlReport(diffData);
  const out = outputPath || `report-${Date.now()}.html`;

  try {
    fs.writeFileSync(path.resolve(out), html, 'utf8');
    console.log(chalk.green.bold(`\n  ✔  HTML report saved → ${path.resolve(out)}\n`));
  } catch (e) {
    console.error(chalk.red(`✖  Failed to save report: ${e.message}`));
    process.exit(1);
  }
}

// ─── Run (full pipeline) ─────────────────────────────────────────────────────

async function runPipeline(configPath, opts) {
  console.log(chalk.cyan.bold('\n  api-diff — Full Pipeline\n'));

  const snapAPath = opts.baseline || null;
  const outDir = opts.outDir || '.';

  // Step 1: Take new snapshot
  const snapBFile = path.join(outDir, `snapshot-${Date.now()}.json`);
  await runSnapshot(configPath, snapBFile);

  if (!snapAPath) {
    console.log(chalk.yellow('  ℹ  No baseline snapshot provided. Skipping diff and report.'));
    console.log(chalk.gray(`  Tip: Re-run with --baseline ${snapBFile} to compare against this snapshot.\n`));
    return;
  }

  // Step 2: Diff
  const diffFile = path.join(outDir, `diff-${Date.now()}.json`);
  await runDiff(snapAPath, snapBFile, diffFile);

  // Step 3: Report
  const reportFile = path.join(outDir, `report-${Date.now()}.html`);
  await runReport(diffFile, reportFile);

  console.log(chalk.cyan.bold('  Pipeline complete.\n'));
}

// ─── Init ────────────────────────────────────────────────────────────────────

function runInit(outputPath) {
  const out = outputPath || 'api-diff.config.json';
  const abs = path.resolve(out);

  if (fs.existsSync(abs)) {
    console.error(chalk.red(`✖  File already exists: ${abs}`));
    console.error(chalk.gray('  Delete it or specify a different path.'));
    process.exit(1);
  }

  const template = {
    headers: {
      Authorization: 'Bearer YOUR_TOKEN_HERE',
      Accept: 'application/json',
    },
    endpoints: [
      {
        name: 'Health Check',
        url: 'https://api.example.com/health',
        method: 'GET',
      },
      {
        name: 'List Items',
        url: 'https://api.example.com/items',
        method: 'GET',
      },
    ],
  };

  try {
    saveJson(abs, template);
    console.log(chalk.green.bold(`\n  ✔  Config created → ${abs}\n`));
    console.log(chalk.gray('  Edit the file to add your endpoints, then run:'));
    console.log(chalk.white(`    api-diff snapshot --config ${out}\n`));
  } catch (e) {
    console.error(chalk.red(`✖  Failed to create config: ${e.message}`));
    process.exit(1);
  }
}

// ─── CLI Setup ───────────────────────────────────────────────────────────────

program
  .name('api-diff')
  .description('Snapshot, diff, and visualize REST API response changes')
  .version(pkg.version);

// Prevent Commander from calling process.exit(1) on --help, --version, or
// unknown commands — we handle exits ourselves for clean CI behaviour.
program.exitOverride();

program
  .command('init')
  .description('Create a starter config file')
  .option('-o, --output <path>', 'Output path for the config file', 'api-diff.config.json')
  .action((opts) => {
    runInit(opts.output);
  });

program
  .command('snapshot')
  .description('Fetch all endpoints and save a snapshot')
  .requiredOption('-c, --config <path>', 'Path to config JSON file')
  .option('-o, --output <path>', 'Output path for the snapshot file')
  .action(async (opts) => {
    await runSnapshot(opts.config, opts.output);
  });

program
  .command('diff')
  .description('Compare two snapshots and output a diff file')
  .requiredOption('-a, --snapshot-a <path>', 'Path to the baseline snapshot')
  .requiredOption('-b, --snapshot-b <path>', 'Path to the new snapshot')
  .option('-o, --output <path>', 'Output path for the diff file')
  .action(async (opts) => {
    await runDiff(opts.snapshotA, opts.snapshotB, opts.output);
  });

program
  .command('report')
  .description('Generate an HTML report from a diff file')
  .requiredOption('-d, --diff <path>', 'Path to the diff JSON file')
  .option('-o, --output <path>', 'Output path for the HTML report')
  .action(async (opts) => {
    await runReport(opts.diff, opts.output);
  });

program
  .command('run')
  .description('Run the full pipeline: snapshot → diff → report')
  .requiredOption('-c, --config <path>', 'Path to config JSON file')
  .option('-b, --baseline <path>', 'Path to baseline snapshot for comparison')
  .option('--out-dir <path>', 'Directory for output files', '.')
  .action(async (opts) => {
    await runPipeline(opts.config, opts);
  });

// ─── Entry Point ─────────────────────────────────────────────────────────────

// Show help and exit cleanly when called with no arguments.
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

// Wrap parse() so that the exitOverride exceptions thrown by Commander for
// --help and --version are caught and result in a clean exit (code 0).
try {
  program.parse(process.argv);
} catch (err) {
  // Commander throws a CommanderError with code 'commander.helpDisplayed' or
  // 'commander.version' when exitOverride() is active and --help / --version
  // are passed.  Both are normal user-requested actions → exit 0.
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  }
  // Any other error (unknown command, missing required option, etc.) is a real
  // problem — print it and exit 1 so CI pipelines catch genuine failures.
  console.error(chalk.red(`✖  ${err.message}`));
  process.exit(1);
}
