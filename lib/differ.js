'use strict';

const { diff } = require('deep-diff');

/**
 * @typedef {Object} FetchResult
 * @property {string} name - Label for the endpoint
 * @property {string} url - The URL that was fetched
 * @property {string} method - HTTP method used
 * @property {number|null} status - HTTP status code, or null on network error
 * @property {Object} headers - Response headers as a plain object
 * @property {Object|string|null} body - Parsed JSON body, raw text, or null on error
 * @property {string|null} error - Error message if the request failed, otherwise null
 * @property {number|null} latencyMs - Round-trip time in milliseconds
 * @property {string} fetchedAt - ISO 8601 timestamp of when the fetch completed
 */

/**
 * @typedef {Object} DiffEntry
 * @property {string} kind - 'added' | 'removed' | 'changed' | 'type_changed'
 * @property {string} path - Dot-notation path to the changed field
 * @property {*} [oldValue] - Previous value (for removed/changed/type_changed)
 * @property {*} [newValue] - New value (for added/changed/type_changed)
 * @property {string} [oldType] - Previous JS type (for type_changed)
 * @property {string} [newType] - New JS type (for type_changed)
 * @property {boolean} breaking - Whether this change is considered breaking
 * @property {string} breakingReason - Human-readable reason for breaking classification
 */

/**
 * @typedef {Object} EndpointDiffResult
 * @property {string} name - Endpoint label
 * @property {string} url - Endpoint URL
 * @property {string} method - HTTP method
 * @property {number|null} oldStatus - Status code from the baseline snapshot
 * @property {number|null} newStatus - Status code from the current snapshot
 * @property {boolean} statusChanged - Whether the status code changed
 * @property {boolean} statusChangeBreaking - Whether the status code change is breaking
 * @property {string|null} statusChangeReason - Reason for status change classification
 * @property {DiffEntry[]} diffs - List of field-level differences
 * @property {number} breakingCount - Number of breaking changes
 * @property {number} nonBreakingCount - Number of non-breaking changes
 * @property {boolean} hasErrors - Whether either snapshot had a network error
 * @property {string|null} oldError - Error from baseline snapshot
 * @property {string|null} newError - Error from current snapshot
 */

/**
 * @typedef {Object} DiffReport
 * @property {string} diffedAt - ISO 8601 timestamp of when the diff was run
 * @property {string} baselineSnapshot - Path or label of the baseline snapshot
 * @property {string} currentSnapshot - Path or label of the current snapshot
 * @property {EndpointDiffResult[]} endpoints - Per-endpoint diff results
 * @property {number} totalBreaking - Total breaking changes across all endpoints
 * @property {number} totalNonBreaking - Total non-breaking changes across all endpoints
 * @property {number} totalEndpoints - Total number of endpoints compared
 * @property {number} endpointsWithChanges - Number of endpoints that have any changes
 * @property {number} endpointsWithBreaking - Number of endpoints with breaking changes
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * HTTP status code ranges considered "success" (2xx).
 */
const SUCCESS_RANGE = { min: 200, max: 299 };

/**
 * Status code transitions that are always considered breaking.
 * Key: `${oldStatus}->${newStatus}` or category transitions like `2xx->4xx`.
 */
const BREAKING_STATUS_TRANSITIONS = new Set([
  '2xx->4xx',
  '2xx->5xx',
  '2xx->3xx', // redirect where there wasn't one before
  '3xx->4xx',
  '3xx->5xx',
  '4xx->5xx',
]);

/**
 * Status code transitions that are non-breaking.
 */
const NON_BREAKING_STATUS_TRANSITIONS = new Set([
  '4xx->2xx', // fix
  '5xx->2xx', // fix
  '5xx->4xx', // more specific error
  '2xx->2xx', // e.g. 200 -> 201
  '3xx->3xx',
  '4xx->4xx',
  '5xx->5xx',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the broad category of an HTTP status code as a string like '2xx'.
 *
 * @param {number|null} status
 * @returns {string}
 */
function statusCategory(status) {
  if (status === null || status === undefined) return 'null';
  if (status >= 200 && status <= 299) return '2xx';
  if (status >= 300 && status <= 399) return '3xx';
  if (status >= 400 && status <= 499) return '4xx';
  if (status >= 500 && status <= 599) return '5xx';
  return 'other';
}

/**
 * Converts a deep-diff path array to a dot-notation string.
 * Array indices are represented as `[n]`.
 *
 * @param {Array<string|number>} pathArr
 * @returns {string}
 */
function pathToString(pathArr) {
  if (!Array.isArray(pathArr) || pathArr.length === 0) return '(root)';
  return pathArr.reduce((acc, segment, idx) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    return idx === 0 ? segment : `${acc}.${segment}`;
  }, '');
}

/**
 * Returns the JavaScript type of a value as a human-readable string.
 * Distinguishes between null, array, object, and primitives.
 *
 * @param {*} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Determines whether a field-level change is breaking.
 *
 * Rules:
 *  - Removed field           → breaking (consumers may depend on it)
 *  - Type changed            → breaking (consumers will misparse)
 *  - null → non-null         → breaking (consumers may not handle null)
 *  - non-null → null         → breaking (consumers may not handle null)
 *  - Added required-looking field → non-breaking (additive)
 *  - Value changed (same type) → non-breaking by default, UNLESS it is a
 *    status/code/type/kind/error field at the root level (heuristic)
 *
 * @param {string} kind - 'added' | 'removed' | 'changed' | 'type_changed'
 * @param {string} path - Dot-notation path
 * @param {*} oldValue
 * @param {*} newValue
 * @returns {{ breaking: boolean, reason: string }}
 */
function classifyFieldChange(kind, path, oldValue, newValue) {
  if (kind === 'removed') {
    return {
      breaking: true,
      reason: `Field "${path}" was removed; consumers relying on it will break`,
    };
  }

  if (kind === 'type_changed') {
    return {
      breaking: true,
      reason: `Field "${path}" changed type from ${typeOf(oldValue)} to ${typeOf(newValue)}; consumers will misparse`,
    };
  }

  if (kind === 'changed') {
    // null transitions
    if (oldValue === null && newValue !== null) {
      return {
        breaking: true,
        reason: `Field "${path}" changed from null to ${typeOf(newValue)}; consumers handling null will break`,
      };
    }
    if (oldValue !== null && newValue === null) {
      return {
        breaking: true,
        reason: `Field "${path}" changed to null; consumers not handling null will break`,
      };
    }

    // Heuristic: certain field names carry semantic weight
    const lowerPath = path.toLowerCase();
    const semanticFields = ['status', 'code', 'type', 'kind', 'error', 'errorcode', 'error_code', 'statuscode', 'status_code'];
    const isSemanticField = semanticFields.some(f => lowerPath === f || lowerPath.endsWith(`.${f}`));
    if (isSemanticField) {
      return {
        breaking: true,
        reason: `Semantic field "${path}" changed value from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`,
      };
    }

    return {
      breaking: false,
      reason: `Field "${path}" value changed (same type); treated as non-breaking`,
    };
  }

  if (kind === 'added') {
    return {
      breaking: false,
      reason: `Field "${path}" was added; additive change is non-breaking`,
    };
  }

  return { breaking: false, reason: 'Unknown change kind; treated as non-breaking' };
}

/**
 * Classifies a status code change as breaking or non-breaking.
 *
 * @param {number|null} oldStatus
 * @param {number|null} newStatus
 * @returns {{ breaking: boolean, reason: string }}
 */
function classifyStatusChange(oldStatus, newStatus) {
  if (oldStatus === newStatus) {
    return { breaking: false, reason: 'Status code unchanged' };
  }

  const oldCat = statusCategory(oldStatus);
  const newCat = statusCategory(newStatus);

  // Exact same category
  if (oldCat === newCat) {
    // Within 2xx: e.g. 200 -> 201 is non-breaking
    if (oldCat === '2xx') {
      return {
        breaking: false,
        reason: `Status changed within 2xx range (${oldStatus} → ${newStatus}); non-breaking`,
      };
    }
    // Within error ranges: still a change but not newly breaking
    return {
      breaking: false,
      reason: `Status changed within ${oldCat} range (${oldStatus} → ${newStatus}); non-breaking`,
    };
  }

  const transition = `${oldCat}->${newCat}`;

  if (BREAKING_STATUS_TRANSITIONS.has(transition)) {
    return {
      breaking: true,
      reason: `Status changed from ${oldStatus} (${oldCat}) to ${newStatus} (${newCat}); this is a breaking transition`,
    };
  }

  if (NON_BREAKING_STATUS_TRANSITIONS.has(transition)) {
    return {
      breaking: false,
      reason: `Status changed from ${oldStatus} (${oldCat}) to ${newStatus} (${newCat}); treated as non-breaking (fix or improvement)`,
    };
  }

  // Null transitions (network errors)
  if (oldStatus === null && newStatus !== null) {
    return {
      breaking: false,
      reason: `Endpoint previously errored (no status); now returns ${newStatus}`,
    };
  }
  if (oldStatus !== null && newStatus === null) {
    return {
      breaking: true,
      reason: `Endpoint previously returned ${oldStatus}; now has a network error (no status)`,
    };
  }

  // Fallback
  return {
    breaking: true,
    reason: `Status changed from ${oldStatus} to ${newStatus}; unknown transition, treating as breaking`,
  };
}

// ─── Core Diff Logic ──────────────────────────────────────────────────────────

/**
 * Produces a flat list of DiffEntry objects by running deep-diff on two JSON
 * values and enriching each raw diff item with kind, path, type info, and
 * breaking classification.
 *
 * @param {*} oldBody - The baseline response body
 * @param {*} newBody - The current response body
 * @returns {DiffEntry[]}
 */
function diffBodies(oldBody, newBody) {
  const entries = [];

  // If both are non-objects (strings, null, primitives), handle directly
  const oldIsObject = oldBody !== null && typeof oldBody === 'object';
  const newIsObject = newBody !== null && typeof newBody === 'object';

  if (!oldIsObject && !newIsObject) {
    if (oldBody !== newBody) {
      const oldT = typeOf(oldBody);
      const newT = typeOf(newBody);
      const kind = oldT !== newT ? 'type_changed' : 'changed';
      const { breaking, reason } = classifyFieldChange(kind, '(root)', oldBody, newBody);
      entries.push({
        kind,
        path: '(root)',
        oldValue: oldBody,
        newValue: newBody,
        oldType: oldT,
        newType: newT,
        breaking,
        breakingReason: reason,
      });
    }
    return entries;
  }

  // One side is an object, the other is not
  if (oldIsObject !== newIsObject) {
    const oldT = typeOf(oldBody);
    const newT = typeOf(newBody);
    const { breaking, reason } = classifyFieldChange('type_changed', '(root)', oldBody, newBody);
    entries.push({
      kind: 'type_changed',
      path: '(root)',
      oldValue: oldBody,
      newValue: newBody,
      oldType: oldT,
      newType: newT,
      breaking,
      breakingReason: reason,
    });
    return entries;
  }

  // Both are objects/arrays — use deep-diff
  let rawDiffs;
  try {
    rawDiffs = diff(oldBody, newBody);
  } catch (e) {
    // deep-diff can throw on circular structures; treat as unknown change
    entries.push({
      kind: 'changed',
      path: '(root)',
      oldValue: null,
      newValue: null,
      breaking: false,
      breakingReason: `Could not compute deep diff: ${e.message}`,
    });
    return entries;
  }

  if (!rawDiffs || rawDiffs.length === 0) {
    return entries;
  }

  for (const d of rawDiffs) {
    const pathStr = pathToString(d.path);

    switch (d.kind) {
      case 'N': {
        // New — field added
        const { breaking, reason } = classifyFieldChange('added', pathStr, undefined, d.rhs);
        entries.push({
          kind: 'added',
          path: pathStr,
          newValue: d.rhs,
          newType: typeOf(d.rhs),
          breaking,
          breakingReason: reason,
        });
        break;
      }

      case 'D': {
        // Deleted — field removed
        const { breaking, reason } = classifyFieldChange('removed', pathStr, d.lhs, undefined);
        entries.push({
          kind: 'removed',
          path: pathStr,
          oldValue: d.lhs,
          oldType: typeOf(d.lhs),
          breaking,
          breakingReason: reason,
        });
        break;
      }

      case 'E': {
        // Edited — value changed
        const oldT = typeOf(d.lhs);
        const newT = typeOf(d.rhs);
        const isTypeChange = oldT !== newT;
        const kind = isTypeChange ? 'type_changed' : 'changed';
        const { breaking, reason } = classifyFieldChange(kind, pathStr, d.lhs, d.rhs);
        entries.push({
          kind,
          path: pathStr,
          oldValue: d.lhs,
          newValue: d.rhs,
          oldType: oldT,
          newType: newT,
          breaking,
          breakingReason: reason,
        });
        break;
      }

      case 'A': {
        // Array item change — recurse into the item diff
        const arrayPath = `${pathStr}[${d.index}]`;
        const itemDiff = d.item;

        if (itemDiff.kind === 'N') {
          const { breaking, reason } = classifyFieldChange('added', arrayPath, undefined, itemDiff.rhs);
          entries.push({
            kind: 'added',
            path: arrayPath,
            newValue: itemDiff.rhs,
            newType: typeOf(itemDiff.rhs),
            breaking,
            breakingReason: reason,
          });
        } else if (itemDiff.kind === 'D') {
          const { breaking, reason } = classifyFieldChange('removed', arrayPath, itemDiff.lhs, undefined);
          entries.push({
            kind: 'removed',
            path: arrayPath,
            oldValue: itemDiff.lhs,
            oldType: typeOf(itemDiff.lhs),
            breaking,
            breakingReason: reason,
          });
        } else if (itemDiff.kind === 'E') {
          const oldT = typeOf(itemDiff.lhs);
          const newT = typeOf(itemDiff.rhs);
          const isTypeChange = oldT !== newT;
          const kind = isTypeChange ? 'type_changed' : 'changed';
          const { breaking, reason } = classifyFieldChange(kind, arrayPath, itemDiff.lhs, itemDiff.rhs);
          entries.push({
            kind,
            path: arrayPath,
            oldValue: itemDiff.lhs,
            newValue: itemDiff.rhs,
            oldType: oldT,
            newType: newT,
            breaking,
            breakingReason: reason,
          });
        }
        break;
      }

      default:
        // Unknown kind — skip
        break;
    }
  }

  return entries;
}

/**
 * Compares two individual endpoint FetchResult objects and returns a structured
 * EndpointDiffResult describing all detected changes.
 *
 * @param {FetchResult} oldResult - Baseline endpoint result
 * @param {FetchResult} newResult - Current endpoint result
 * @returns {EndpointDiffResult}
 */
function diffEndpoint(oldResult, newResult) {
  const name = newResult.name || oldResult.name || newResult.url || oldResult.url;
  const url = newResult.url || oldResult.url;
  const method = newResult.method || oldResult.method || 'GET';

  const oldStatus = oldResult.status !== undefined ? oldResult.status : null;
  const newStatus = newResult.status !== undefined ? newResult.status : null;

  const statusChanged = oldStatus !== newStatus;
  let statusChangeBreaking = false;
  let statusChangeReason = null;

  if (statusChanged) {
    const classification = classifyStatusChange(oldStatus, newStatus);
    statusChangeBreaking = classification.breaking;
    statusChangeReason = classification.reason;
  }

  // Diff the bodies
  const diffs = diffBodies(oldResult.body, newResult.body);

  const breakingCount = diffs.filter(d => d.breaking).length + (statusChangeBreaking ? 1 : 0);
  const nonBreakingCount = diffs.filter(d => !d.breaking).length + (statusChanged && !statusChangeBreaking ? 1 : 0);

  return {
    name,
    url,
    method,
    oldStatus,
    newStatus,
    statusChanged,
    statusChangeBreaking,
    statusChangeReason,
    diffs,
    breakingCount,
    nonBreakingCount,
    hasErrors: !!(oldResult.error || newResult.error),
    oldError: oldResult.error || null,
    newError: newResult.error || null,
  };
}

/**
 * Deep-diffs two full snapshot objects (as produced by the snapshot command).
 *
 * Matches endpoints between snapshots by URL + method. Endpoints present in
 * one snapshot but not the other are flagged as added or removed (both
 * considered breaking changes).
 *
 * @param {Object} baselineSnapshot - The older snapshot object
 * @param {Object} currentSnapshot - The newer snapshot object
 * @param {Object} [options={}] - Optional configuration
 * @param {string} [options.baselineLabel] - Human label for the baseline
 * @param {string} [options.currentLabel] - Human label for the current snapshot
 * @returns {DiffReport}
 */
function diffSnapshots(baselineSnapshot, currentSnapshot, options = {}) {
  const baselineLabel = options.baselineLabel || baselineSnapshot.configPath || 'baseline';
  const currentLabel = options.currentLabel || currentSnapshot.configPath || 'current';

  const baselineResults = Array.isArray(baselineSnapshot.results) ? baselineSnapshot.results : [];
  const currentResults = Array.isArray(currentSnapshot.results) ? currentSnapshot.results : [];

  // Build lookup maps keyed by `METHOD:URL`
  function makeKey(r) {
    return `${(r.method || 'GET').toUpperCase()}:${r.url}`;
  }

  const baselineMap = new Map();
  for (const r of baselineResults) {
    baselineMap.set(makeKey(r), r);
  }

  const currentMap = new Map();
  for (const r of currentResults) {
    currentMap.set(makeKey(r), r);
  }

  const allKeys = new Set([...baselineMap.keys(), ...currentMap.keys()]);
  const endpointResults = [];

  for (const key of allKeys) {
    const oldResult = baselineMap.get(key);
    const newResult = currentMap.get(key);

    if (oldResult && newResult) {
      // Both present — do a full diff
      endpointResults.push(diffEndpoint(oldResult, newResult));
    } else if (oldResult && !newResult) {
      // Endpoint was removed entirely — breaking
      endpointResults.push({
        name: oldResult.name || oldResult.url,
        url: oldResult.url,
        method: oldResult.method || 'GET',
        oldStatus: oldResult.status,
        newStatus: null,
        statusChanged: true,
        statusChangeBreaking: true,
        statusChangeReason: `Endpoint ${key} was present in baseline but is missing from current snapshot`,
        diffs: [],
        breakingCount: 1,
        nonBreakingCount: 0,
        hasErrors: !!oldResult.error,
        oldError: oldResult.error || null,
        newError: null,
      });
    } else if (!oldResult && newResult) {
      // Endpoint was added — non-breaking
      endpointResults.push({
        name: newResult.name || newResult.url,
        url: newResult.url,
        method: newResult.method || 'GET',
        oldStatus: null,
        newStatus: newResult.status,
        statusChanged: true,
        statusChangeBreaking: false,
        statusChangeReason: `Endpoint ${key} is new in current snapshot; additive change`,
        diffs: [],
        breakingCount: 0,
        nonBreakingCount: 1,
        hasErrors: !!newResult.error,
        oldError: null,
        newError: newResult.error || null,
      });
    }
  }

  const totalBreaking = endpointResults.reduce((sum, e) => sum + e.breakingCount, 0);
  const totalNonBreaking = endpointResults.reduce((sum, e) => sum + e.nonBreakingCount, 0);
  const endpointsWithChanges = endpointResults.filter(
    e => e.statusChanged || e.diffs.length > 0
  ).length;
  const endpointsWithBreaking = endpointResults.filter(e => e.breakingCount > 0).length;

  return {
    diffedAt: new Date().toISOString(),
    baselineSnapshot: baselineLabel,
    currentSnapshot: currentLabel,
    endpoints: endpointResults,
    totalBreaking,
    totalNonBreaking,
    totalEndpoints: endpointResults.length,
    endpointsWithChanges,
    endpointsWithBreaking,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  diffSnapshots,
  diffEndpoint,
  diffBodies,
  classifyStatusChange,
  classifyFieldChange,
  statusCategory,
  pathToString,
  typeOf,
};