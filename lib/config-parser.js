'use strict';

/**
 * @fileoverview Parses endpoint configuration from JSON/YAML file or CLI
 * arguments and validates endpoint URLs and request options.
 *
 * Supported config shape (JSON):
 * {
 *   "headers": { "Authorization": "Bearer ..." },
 *   "endpoints": [
 *     {
 *       "name": "List users",
 *       "url": "https://api.example.com/users",
 *       "method": "GET",
 *       "headers": { "X-Custom": "value" },
 *       "body": { "key": "value" }
 *     }
 *   ]
 * }
 */

const fs = require('fs');
const path = require('path');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const BODY_FORBIDDEN_METHODS = ['GET', 'HEAD'];

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Attempts to parse a string as JSON.
 *
 * @param {string} raw - Raw file contents.
 * @param {string} filePath - File path used only for error messages.
 * @returns {{ ok: boolean, data?: *, error?: string }}
 */
function tryParseJson(raw, filePath) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: `Invalid JSON in ${filePath}: ${e.message}` };
  }
}

/**
 * Determines whether a string is a plausible absolute URL (http or https).
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Validates a single endpoint configuration object and returns a list of
 * human-readable error strings.  An empty array means the endpoint is valid.
 *
 * @param {*} ep - The endpoint value to validate.
 * @param {number} index - Position in the endpoints array (for error messages).
 * @returns {string[]}
 */
function validateEndpoint(ep, index) {
  const errors = [];
  const label = `endpoints[${index}]`;

  if (ep === null || typeof ep !== 'object' || Array.isArray(ep)) {
    errors.push(`${label}: must be a plain object`);
    return errors;
  }

  // url
  if (!ep.url) {
    errors.push(`${label}: missing required field "url"`);
  } else if (!isValidUrl(ep.url)) {
    errors.push(
      `${label}: "url" must be an absolute http/https URL, got: ${JSON.stringify(ep.url)}`
    );
  }

  // method
  if (ep.method !== undefined) {
    if (typeof ep.method !== 'string') {
      errors.push(`${label}: "method" must be a string`);
    } else if (!VALID_METHODS.includes(ep.method.toUpperCase())) {
      errors.push(
        `${label}: "method" must be one of ${VALID_METHODS.join(', ')}, got: ${ep.method}`
      );
    }
  }

  // headers
  if (ep.headers !== undefined) {
    if (ep.headers === null || typeof ep.headers !== 'object' || Array.isArray(ep.headers)) {
      errors.push(`${label}: "headers" must be a plain object`);
    } else {
      for (const [k, v] of Object.entries(ep.headers)) {
        if (typeof v !== 'string') {
          errors.push(
            `${label}: header "${k}" value must be a string, got ${typeof v}`
          );
        }
      }
    }
  }

  // body
  if (ep.body !== undefined) {
    const method = (ep.method || 'GET').toUpperCase();
    if (BODY_FORBIDDEN_METHODS.includes(method)) {
      errors.push(
        `${label}: "body" is not allowed for ${method} requests`
      );
    }
    if (typeof ep.body !== 'string' && (typeof ep.body !== 'object' || ep.body === null)) {
      errors.push(`${label}: "body" must be a string or a plain object`);
    }
  }

  // name
  if (ep.name !== undefined && typeof ep.name !== 'string') {
    errors.push(`${label}: "name" must be a string`);
  }

  return errors;
}

/**
 * Validates the top-level configuration object.
 *
 * @param {*} config - Parsed configuration value.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(config) {
  const errors = [];

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    errors.push('Config root must be a plain object');
    return { valid: false, errors };
  }

  // global headers
  if (config.headers !== undefined) {
    if (
      config.headers === null ||
      typeof config.headers !== 'object' ||
      Array.isArray(config.headers)
    ) {
      errors.push('Top-level "headers" must be a plain object');
    } else {
      for (const [k, v] of Object.entries(config.headers)) {
        if (typeof v !== 'string') {
          errors.push(
            `Global header "${k}" value must be a string, got ${typeof v}`
          );
        }
      }
    }
  }

  // endpoints
  if (!Array.isArray(config.endpoints)) {
    errors.push('"endpoints" must be an array');
  } else if (config.endpoints.length === 0) {
    errors.push('"endpoints" array must not be empty');
  } else {
    config.endpoints.forEach((ep, i) => {
      const epErrors = validateEndpoint(ep, i);
      errors.push(...epErrors);
    });
  }

  return { valid: errors.length === 0, errors };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Loads and parses an endpoint configuration file (JSON only; YAML support
 * is noted for future extension).  Validates the parsed structure and returns
 * a normalised configuration object.
 *
 * The returned object always has the shape:
 * {
 *   headers: Object,          // global headers (may be empty)
 *   endpoints: EndpointConfig[]
 * }
 *
 * Each endpoint is normalised so that:
 *   - `method` is upper-cased
 *   - `headers` defaults to {}
 *   - `name` defaults to the endpoint URL when omitted
 *
 * @param {string} filePath - Path to the JSON configuration file.
 * @returns {{ ok: boolean, config?: Object, errors?: string[] }}
 */
function parseConfigFile(filePath) {
  const abs = path.resolve(filePath);

  if (!fs.existsSync(abs)) {
    return { ok: false, errors: [`Config file not found: ${abs}`] };
  }

  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return { ok: false, errors: [`Failed to read config file: ${e.message}`] };
  }

  const parsed = tryParseJson(raw, abs);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error] };
  }

  const { valid, errors } = validateConfig(parsed.data);
  if (!valid) {
    return { ok: false, errors };
  }

  const config = normaliseConfig(parsed.data);
  return { ok: true, config };
}

/**
 * Builds a configuration object from individual CLI arguments rather than a
 * config file.  Useful when the caller wants to diff a single endpoint
 * specified entirely on the command line.
 *
 * @param {Object} opts
 * @param {string}   opts.url            - Endpoint URL (required).
 * @param {string}   [opts.method='GET'] - HTTP method.
 * @param {string[]} [opts.headers=[]]   - Header strings in "Name: Value" format.
 * @param {string}   [opts.body]         - Raw request body string.
 * @param {string}   [opts.name]         - Human-readable label.
 * @returns {{ ok: boolean, config?: Object, errors?: string[] }}
 */
function parseConfigFromArgs(opts) {
  if (!opts || typeof opts !== 'object') {
    return { ok: false, errors: ['opts must be a plain object'] };
  }

  const errors = [];

  if (!isValidUrl(opts.url)) {
    errors.push(
      `"url" must be an absolute http/https URL, got: ${JSON.stringify(opts.url)}`
    );
  }

  const method = (opts.method || 'GET').toUpperCase();
  if (!VALID_METHODS.includes(method)) {
    errors.push(`"method" must be one of ${VALID_METHODS.join(', ')}, got: ${opts.method}`);
  }

  // Parse header strings "Name: Value"
  const parsedHeaders = {};
  const rawHeaders = Array.isArray(opts.headers) ? opts.headers : [];
  for (const h of rawHeaders) {
    if (typeof h !== 'string') {
      errors.push(`Each header entry must be a string, got: ${typeof h}`);
      continue;
    }
    const colonIdx = h.indexOf(':');
    if (colonIdx === -1) {
      errors.push(`Header "${h}" is not in "Name: Value" format`);
      continue;
    }
    const name = h.slice(0, colonIdx).trim();
    const value = h.slice(colonIdx + 1).trim();
    if (!name) {
      errors.push(`Header "${h}" has an empty name`);
      continue;
    }
    parsedHeaders[name] = value;
  }

  if (opts.body !== undefined && BODY_FORBIDDEN_METHODS.includes(method)) {
    errors.push(`"body" is not allowed for ${method} requests`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const endpoint = {
    url: opts.url.trim(),
    method,
    headers: parsedHeaders,
    name: typeof opts.name === 'string' && opts.name.trim() ? opts.name.trim() : opts.url.trim(),
  };

  if (opts.body !== undefined) {
    endpoint.body = opts.body;
  }

  const config = {
    headers: {},
    endpoints: [endpoint],
  };

  return { ok: true, config };
}

/**
 * Validates a pre-parsed configuration object without loading it from disk.
 * Useful for callers that construct config objects programmatically.
 *
 * @param {*} config - The configuration object to validate.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfigObject(config) {
  return validateConfig(config);
}

// ─── Internal Normalisation ───────────────────────────────────────────────────

/**
 * Returns a new, normalised copy of a validated configuration object.
 * Assumes the config has already passed `validateConfig`.
 *
 * @param {Object} config
 * @returns {Object}
 */
function normaliseConfig(config) {
  const globalHeaders = Object.assign({}, config.headers || {});

  const endpoints = config.endpoints.map((ep) => {
    const method = (ep.method || 'GET').toUpperCase();
    const normalised = {
      url: ep.url.trim(),
      method,
      headers: Object.assign({}, ep.headers || {}),
      name: typeof ep.name === 'string' && ep.name.trim() ? ep.name.trim() : ep.url.trim(),
    };
    if (ep.body !== undefined) {
      normalised.body = ep.body;
    }
    return normalised;
  });

  return { headers: globalHeaders, endpoints };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  parseConfigFile,
  parseConfigFromArgs,
  validateConfigObject,
};