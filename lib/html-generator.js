'use strict';

/**
 * @fileoverview Generates a standalone HTML report from api-diff results.
 * All styles are inlined — no external dependencies required.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const KIND_LABELS = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  type_changed: 'Type Changed',
};

const KIND_CLASSES = {
  added: 'kind-added',
  removed: 'kind-removed',
  changed: 'kind-changed',
  type_changed: 'kind-type-changed',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escapes a string for safe insertion into HTML.
 *
 * @param {*} value - Any value; will be coerced to string.
 * @returns {string}
 */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a value for display inside a table cell, truncating if necessary.
 *
 * @param {*} value
 * @param {number} [maxLen=120]
 * @returns {string} - HTML-escaped string
 */
function formatValue(value, maxLen) {
  maxLen = maxLen || 120;
  if (value === null) return '<em>null</em>';
  if (value === undefined) return '<em>undefined</em>';
  let str;
  if (typeof value === 'object') {
    try {
      str = JSON.stringify(value, null, 2);
    } catch (_) {
      str = String(value);
    }
  } else {
    str = String(value);
  }
  const truncated = str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
  return esc(truncated);
}

/**
 * Returns an inline CSS class name for an HTTP status code.
 *
 * @param {number|null} status
 * @returns {string}
 */
function statusClass(status) {
  if (status === null || status === undefined) return 'status-error';
  if (status >= 200 && status < 300) return 'status-2xx';
  if (status >= 300 && status < 400) return 'status-3xx';
  if (status >= 400 && status < 500) return 'status-4xx';
  return 'status-5xx';
}

/**
 * Returns a display string for a status code.
 *
 * @param {number|null} status
 * @returns {string}
 */
function formatStatus(status) {
  if (status === null || status === undefined) return 'N/A';
  return String(status);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

function getStyles() {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:           #0f1117;
      --surface:      #1a1d27;
      --surface2:     #22263a;
      --border:       #2e3250;
      --border-light: #3a3f60;
      --text:         #e2e8f0;
      --text-muted:   #8892b0;
      --text-dim:     #4a5568;
      --accent:       #7c83fd;
      --accent-glow:  rgba(124,131,253,0.15);

      --added:        #22c55e;
      --added-bg:     rgba(34,197,94,0.08);
      --removed:      #ef4444;
      --removed-bg:   rgba(239,68,68,0.08);
      --changed:      #f59e0b;
      --changed-bg:   rgba(245,158,11,0.08);
      --type-changed: #a855f7;
      --type-bg:      rgba(168,85,247,0.08);

      --breaking:     #ef4444;
      --breaking-bg:  rgba(239,68,68,0.12);
      --safe:         #22c55e;
      --safe-bg:      rgba(34,197,94,0.08);

      --status-2xx:   #22c55e;
      --status-3xx:   #06b6d4;
      --status-4xx:   #f59e0b;
      --status-5xx:   #ef4444;
      --status-err:   #ef4444;

      --radius-sm:    4px;
      --radius:       8px;
      --radius-lg:    12px;
      --shadow:       0 4px 24px rgba(0,0,0,0.4);
    }

    html { font-size: 15px; }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
      padding: 0 0 60px;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    code, pre {
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 0.85em;
    }

    /* ── Header ── */
    .header {
      background: linear-gradient(135deg, #1a1d27 0%, #12152a 100%);
      border-bottom: 1px solid var(--border);
      padding: 36px 48px 32px;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: -60px; right: -60px;
      width: 300px; height: 300px;
      background: radial-gradient(circle, rgba(124,131,253,0.08) 0%, transparent 70%);
      pointer-events: none;
    }
    .header-inner { max-width: 1100px; margin: 0 auto; }
    .header-top { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
    .logo {
      font-size: 1.6rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--accent);
    }
    .logo span { color: var(--text-muted); font-weight: 400; }
    .version-badge {
      background: var(--accent-glow);
      border: 1px solid var(--accent);
      color: var(--accent);
      font-size: 0.7rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 20px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .header-meta {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 4px;
    }
    .header-meta strong { color: var(--text); }

    /* ── Summary Bar ── */
    .summary-bar {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 20px 48px;
    }
    .summary-bar-inner {
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .summary-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .summary-pill .pill-count {
      font-size: 1rem;
      font-weight: 800;
    }
    .pill-breaking  { border-color: var(--breaking); color: var(--breaking); }
    .pill-added     { border-color: var(--added);    color: var(--added); }
    .pill-removed   { border-color: var(--removed);  color: var(--removed); }
    .pill-changed   { border-color: var(--changed);  color: var(--changed); }
    .pill-endpoints { border-color: var(--border-light); color: var(--text-muted); }

    /* ── Main Layout ── */
    .main { max-width: 1100px; margin: 0 auto; padding: 40px 48px 0; }

    /* ── Section ── */
    .section { margin-bottom: 40px; }
    .section-title {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    /* ── Endpoint Card ── */
    .endpoint-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      margin-bottom: 24px;
      overflow: hidden;
      box-shadow: var(--shadow);
      transition: border-color 0.2s;
    }
    .endpoint-card.has-breaking { border-color: rgba(239,68,68,0.4); }
    .endpoint-card.no-changes   { border-color: var(--border); opacity: 0.75; }

    .card-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 24px;
      background: var(--surface2);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .method-badge {
      font-size: 0.7rem;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 3px 9px;
      border-radius: var(--radius-sm);
      background: var(--accent-glow);
      border: 1px solid var(--accent);
      color: var(--accent);
      text-transform: uppercase;
      white-space: nowrap;
    }
    .endpoint-name {
      font-weight: 700;
      font-size: 1rem;
      color: var(--text);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .endpoint-url {
      font-size: 0.78rem;
      color: var(--text-muted);
      font-family: monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 340px;
    }
    .card-badges { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

    .badge {
      font-size: 0.68rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 20px;
      letter-spacing: 0.3px;
      white-space: nowrap;
    }
    .badge-breaking {
      background: var(--breaking-bg);
      border: 1px solid var(--breaking);
      color: var(--breaking);
    }
    .badge-safe {
      background: var(--safe-bg);
      border: 1px solid var(--safe);
      color: var(--safe);
    }
    .badge-no-changes {
      background: var(--surface2);
      border: 1px solid var(--border-light);
      color: var(--text-muted);
    }
    .badge-error {
      background: var(--breaking-bg);
      border: 1px solid var(--breaking);
      color: var(--breaking);
    }

    /* ── Status Row ── */
    .status-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 24px;
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
      flex-wrap: wrap;
    }
    .status-label { color: var(--text-muted); font-weight: 600; }
    .status-code {
      font-weight: 800;
      font-size: 0.95rem;
      padding: 1px 8px;
      border-radius: var(--radius-sm);
    }
    .status-2xx { color: var(--status-2xx); background: rgba(34,197,94,0.1); }
    .status-3xx { color: var(--status-3xx); background: rgba(6,182,212,0.1); }
    .status-4xx { color: var(--status-4xx); background: rgba(245,158,11,0.1); }
    .status-5xx { color: var(--status-5xx); background: rgba(239,68,68,0.1); }
    .status-error { color: var(--status-err); background: rgba(239,68,68,0.1); }

    .status-arrow { color: var(--text-dim); font-size: 0.9rem; }
    .status-change-note {
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-left: 4px;
    }
    .status-change-note.breaking { color: var(--breaking); font-weight: 600; }

    /* ── Error Box ── */
    .error-box {
      margin: 16px 24px;
      padding: 12px 16px;
      background: var(--breaking-bg);
      border: 1px solid rgba(239,68,68,0.3);
      border-radius: var(--radius);
      font-size: 0.83rem;
      color: var(--breaking);
    }
    .error-box strong { display: block; margin-bottom: 4px; }

    /* ── No Changes ── */
    .no-changes-msg {
      padding: 20px 24px;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-style: italic;
    }

    /* ── Diff Table ── */
    .diff-table-wrap {
      overflow-x: auto;
      padding: 0 0 4px;
    }
    .diff-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    .diff-table thead tr {
      background: var(--surface2);
      border-bottom: 1px solid var(--border);
    }
    .diff-table th {
      padding: 10px 16px;
      text-align: left;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .diff-table td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .diff-table tbody tr:last-child td { border-bottom: none; }
    .diff-table tbody tr:hover { background: rgba(255,255,255,0.02); }

    /* kind column */
    .diff-table td.col-kind { white-space: nowrap; }
    .kind-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 700;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 20px;
    }
    .kind-added       { background: var(--added-bg);   color: var(--added);   border: 1px solid rgba(34,197,94,0.3); }
    .kind-removed     { background: var(--removed-bg); color: var(--removed); border: 1px solid rgba(239,68,68,0.3); }
    .kind-changed     { background: var(--changed-bg); color: var(--changed); border: 1px solid rgba(245,158,11,0.3); }
    .kind-type-changed{ background: var(--type-bg);    color: var(--type-changed); border: 1px solid rgba(168,85,247,0.3); }

    /* path column */
    .col-path code {
      background: var(--surface2);
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: 0.8em;
      word-break: break-all;
    }

    /* value columns */
    .col-old-value, .col-new-value {
      max-width: 260px;
    }
    .col-old-value code { color: var(--removed); }
    .col-new-value code { color: var(--added); }
    .value-cell code {
      display: block;
      background: var(--surface2);
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      word-break: break-all;
      white-space: pre-wrap;
      font-size: 0.78em;
    }
    .value-empty { color: var(--text-dim); font-style: italic; font-size: 0.8em; }

    /* breaking column */
    .col-breaking { white-space: nowrap; }
    .breaking-yes {
      color: var(--breaking);
      font-weight: 700;
      font-size: 0.78rem;
    }
    .breaking-no {
      color: var(--safe);
      font-size: 0.78rem;
    }
    .breaking-reason {
      display: block;
      color: var(--text-muted);
      font-size: 0.72rem;
      margin-top: 2px;
      font-style: italic;
      max-width: 200px;
    }

    /* ── Latency ── */
    .latency-row {
      display: flex;
      gap: 24px;
      padding: 10px 24px;
      border-top: 1px solid var(--border);
      font-size: 0.78rem;
      color: var(--text-muted);
      background: var(--surface2);
    }
    .latency-item strong { color: var(--text); }

    /* ── Footer ── */
    .footer {
      max-width: 1100px;
      margin: 48px auto 0;
      padding: 0 48px;
      border-top: 1px solid var(--border);
      padding-top: 20px;
      font-size: 0.78rem;
      color: var(--text-dim);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }

    /* ── Responsive ── */
    @media (max-width: 700px) {
      .header, .summary-bar, .main { padding-left: 20px; padding-right: 20px; }
      .card-header { flex-direction: column; align-items: flex-start; }
      .endpoint-url { max-width: 100%; }
      .footer { flex-direction: column; }
    }
  `;
}

// ─── HTML Builders ────────────────────────────────────────────────────────────

/**
 * Builds the <head> section of the HTML document.
 *
 * @param {string} title
 * @returns {string}
 */
function buildHead(title) {
  return `
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <style>${getStyles()}</style>
  </head>`;
}

/**
 * Builds the page header section.
 *
 * @param {Object} diffReport - The full diff report object
 * @returns {string}
 */
function buildHeader(diffReport) {
  const version = esc(diffReport.diffVersion || '');
  const generatedAt = esc(diffReport.generatedAt || new Date().toISOString());
  const baselineAt = esc(
    (diffReport.baselineSnapshot && diffReport.baselineSnapshot.createdAt) || 'N/A'
  );
  const currentAt = esc(
    (diffReport.currentSnapshot && diffReport.currentSnapshot.createdAt) || 'N/A'
  );

  return `
  <header class="header">
    <div class="header-inner">
      <div class="header-top">
        <div class="logo">api<span>-diff</span></div>
        ${version ? `<span class="version-badge">v${version}</span>` : ''}
      </div>
      <div class="header-meta">
        Generated: <strong>${generatedAt}</strong>
        &nbsp;·&nbsp;
        Baseline: <strong>${baselineAt}</strong>
        &nbsp;→&nbsp;
        Current: <strong>${currentAt}</strong>
      </div>
    </div>
  </header>`;
}

/**
 * Computes aggregate counts from the diff report for the summary bar.
 *
 * @param {Object} diffReport
 * @returns {{ endpoints: number, breaking: number, added: number, removed: number, changed: number }}
 */
function computeSummary(diffReport) {
  const results = Array.isArray(diffReport.results) ? diffReport.results : [];
  let breaking = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const r of results) {
    if (r.hasBreakingChanges) breaking++;
    const diffs = Array.isArray(r.diffs) ? r.diffs : [];
    for (const d of diffs) {
      if (d.kind === 'added') added++;
      else if (d.kind === 'removed') removed++;
      else if (d.kind === 'changed' || d.kind === 'type_changed') changed++;
    }
    if (r.statusChangeBreaking) breaking = Math.max(breaking, 1);
  }

  return { endpoints: results.length, breaking, added, removed, changed };
}

/**
 * Builds the summary pill bar.
 *
 * @param {Object} diffReport
 * @returns {string}
 */
function buildSummaryBar(diffReport) {
  const s = computeSummary(diffReport);
  return `
  <div class="summary-bar">
    <div class="summary-bar-inner">
      <div class="summary-pill pill-endpoints">
        <span class="pill-count">${s.endpoints}</span> Endpoint${s.endpoints !== 1 ? 's' : ''}
      </div>
      <div class="summary-pill pill-breaking">
        <span class="pill-count">${s.breaking}</span> Breaking
      </div>
      <div class="summary-pill pill-added">
        <span class="pill-count">${s.added}</span> Added
      </div>
      <div class="summary-pill pill-removed">
        <span class="pill-count">${s.removed}</span> Removed
      </div>
      <div class="summary-pill pill-changed">
        <span class="pill-count">${s.changed}</span> Changed
      </div>
    </div>
  </div>`;
}

/**
 * Builds the status row for a single endpoint result.
 *
 * @param {Object} result - EndpointDiffResult
 * @returns {string}
 */
function buildStatusRow(result) {
  const oldStatus = result.oldStatus;
  const newStatus = result.newStatus;
  const changed = result.statusChanged;
  const breaking = result.statusChangeBreaking;
  const reason = result.statusChangeReason || '';

  const oldHtml = `<span class="status-code ${statusClass(oldStatus)}">${esc(formatStatus(oldStatus))}</span>`;
  const newHtml = `<span class="status-code ${statusClass(newStatus)}">${esc(formatStatus(newStatus))}</span>`;

  let changeNote = '';
  if (changed) {
    const cls = breaking ? 'breaking' : '';
    const label = breaking ? '⚠ Breaking status change' : 'Non-breaking status change';
    changeNote = `<span class="status-change-note ${cls}">${esc(label)}${reason ? ': ' + esc(reason) : ''}</span>`;
  }

  return `
    <div class="status-row">
      <span class="status-label">Status</span>
      ${oldHtml}
      <span class="status-arrow">→</span>
      ${newHtml}
      ${changeNote}
    </div>`;
}

/**
 * Builds a single diff table row.
 *
 * @param {Object} diff - DiffEntry
 * @returns {string}
 */
function buildDiffRow(diff) {
  const kindClass = KIND_CLASSES[diff.kind] || 'kind-changed';
  const kindLabel = KIND_LABELS[diff.kind] || esc(diff.kind);

  const oldVal = diff.oldValue !== undefined
    ? `<div class="value-cell"><code>${formatValue(diff.oldValue)}</code></div>`
    : `<span class="value-empty">—</span>`;

  const newVal = diff.newValue !== undefined
    ? `<div class="value-cell"><code>${formatValue(diff.newValue)}</code></div>`
    : `<span class="value-empty">—</span>`;

  const breakingHtml = diff.breaking
    ? `<span class="breaking-yes">⚠ Yes<span class="breaking-reason">${esc(diff.breakingReason || '')}</span></span>`
    : `<span class="breaking-no">✓ No</span>`;

  return `
      <tr>
        <td class="col-kind">
          <span class="kind-badge ${kindClass}">${kindLabel}</span>
        </td>
        <td class="col-path"><code>${esc(diff.path || '')}</code></td>
        <td class="col-old-value">${oldVal}</td>
        <td class="col-new-value">${newVal}</td>
        <td class="col-breaking">${breakingHtml}</td>
      </tr>`;
}

/**
 * Builds the diff table for a single endpoint result.
 *
 * @param {Object[]} diffs - Array of DiffEntry objects
 * @returns {string}
 */
function buildDiffTable(diffs) {
  if (!Array.isArray(diffs) || diffs.length === 0) {
    return '<div class="no-changes-msg">No field-level differences detected.</div>';
  }

  const rows = diffs.map(buildDiffRow).join('');

  return `
    <div class="diff-table-wrap">
      <table class="diff-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Path</th>
            <th>Old Value</th>
            <th>New Value</th>
            <th>Breaking</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
}

/**
 * Builds the latency footer row for a card.
 *
 * @param {Object} result - EndpointDiffResult
 * @returns {string}
 */
function buildLatencyRow(result) {
  const oldLatency = result.oldLatencyMs != null ? `${result.oldLatencyMs}ms` : 'N/A';
  const newLatency = result.newLatencyMs != null ? `${result.newLatencyMs}ms` : 'N/A';

  return `
    <div class="latency-row">
      <span class="latency-item">Baseline latency: <strong>${esc(oldLatency)}</strong></span>
      <span class="latency-item">Current latency: <strong>${esc(newLatency)}</strong></span>
    </div>`;
}

/**
 * Builds a single endpoint card.
 *
 * @param {Object} result - EndpointDiffResult
 * @returns {string}
 */
function buildEndpointCard(result) {
  const diffs = Array.isArray(result.diffs) ? result.diffs : [];
  const hasChanges = diffs.length > 0 || result.statusChanged;
  const hasBreaking = result.hasBreakingChanges;

  let cardClass = 'endpoint-card';
  if (hasBreaking) cardClass += ' has-breaking';
  else if (!hasChanges) cardClass += ' no-changes';

  // Badge
  let badgeHtml = '';
  if (hasBreaking) {
    badgeHtml = '<span class="badge badge-breaking">⚠ Breaking</span>';
  } else if (hasChanges) {
    badgeHtml = '<span class="badge badge-safe">✓ Changes</span>';
  } else {
    badgeHtml = '<span class="badge badge-no-changes">No Changes</span>';
  }

  // Error boxes
  let errorHtml = '';
  if (result.oldError) {
    errorHtml += `
    <div class="error-box">
      <strong>Baseline Error</strong>${esc(result.oldError)}
    </div>`;
  }
  if (result.newError) {
    errorHtml += `
    <div class="error-box">
      <strong>Current Error</strong>${esc(result.newError)}
    </div>`;
  }

  return `
  <div class="${cardClass}">
    <div class="card-header">
      <span class="method-badge">${esc(result.method || 'GET')}</span>
      <span class="endpoint-name">${esc(result.name || result.url || '')}</span>
      <span class="endpoint-url">${esc(result.url || '')}</span>
      <div class="card-badges">${badgeHtml}</div>
    </div>
    ${buildStatusRow(result)}
    ${errorHtml}
    ${hasChanges ? buildDiffTable(diffs) : '<div class="no-changes-msg">No differences detected for this endpoint.</div>'}
    ${buildLatencyRow(result)}
  </div>`;
}

/**
 * Builds the main content section with all endpoint cards.
 *
 * @param {Object} diffReport
 * @returns {string}
 */
function buildMain(diffReport) {
  const results = Array.isArray(diffReport.results) ? diffReport.results : [];

  if (results.length === 0) {
    return `
  <main class="main">
    <div class="section">
      <div class="section-title">Endpoints</div>
      <div class="no-changes-msg">No endpoint results found in this report.</div>
    </div>
  </main>`;
  }

  const cards = results.map(buildEndpointCard).join('\n');

  return `
  <main class="main">
    <div class="section">
      <div class="section-title">Endpoints (${results.length})</div>
      ${cards}
    </div>
  </main>`;
}

/**
 * Builds the page footer.
 *
 * @param {Object} diffReport
 * @returns {string}
 */
function buildFooter(diffReport) {
  const version = esc(diffReport.diffVersion || '');
  const year = new Date().getFullYear();
  return `
  <footer class="footer">
    <span>api-diff${version ? ' v' + version : ''} &mdash; Built with AI by Craftpipe</span>
    <span>&copy; ${year}</span>
  </footer>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates a complete standalone HTML report string from a diff report object.
 *
 * The returned string is a full HTML document with all styles inlined.
 * It has no external dependencies and can be saved directly to a `.html` file
 * and opened in any modern browser.
 *
 * @param {Object} diffReport - The diff report produced by lib/differ.js
 * @param {Object} [options={}] - Optional configuration
 * @param {string} [options.title='api-diff Report'] - The HTML document title
 * @returns {string} - Complete HTML document as a string
 */
function generateHtml(diffReport, options) {
  if (!diffReport || typeof diffReport !== 'object') {
    diffReport = { results: [] };
  }
  options = options || {};
  const title = options.title || 'api-diff Report';

  try {
    const html = `<!DOCTYPE html>
<html lang="en">
${buildHead(title)}
<body>
${buildHeader(diffReport)}
${buildSummaryBar(diffReport)}
${buildMain(diffReport)}
${buildFooter(diffReport)}
</body>
</html>`;
    return html;
  } catch (err) {
    // Return a minimal error page rather than throwing
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>api-diff Report — Error</title></head>
<body style="font-family:sans-serif;padding:40px;background:#0f1117;color:#ef4444;">
  <h1>Report Generation Error</h1>
  <pre>${esc(err && err.message ? err.message : String(err))}</pre>
</body>
</html>`;
  }
}

module.exports = { generateHtml };