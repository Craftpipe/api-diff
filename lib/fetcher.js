'use strict';

const fetch = require('node-fetch');

/**
 * @typedef {Object} EndpointConfig
 * @property {string} url - The URL to fetch
 * @property {string} [method='GET'] - HTTP method
 * @property {Object} [headers={}] - Per-endpoint headers
 * @property {string|Object} [body] - Request body (for POST/PUT/PATCH etc.)
 * @property {string} [name] - Human-readable label for this endpoint
 */

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
 * Returns the current time as an ISO 8601 string.
 *
 * @returns {string}
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Fetches a single REST endpoint and returns a structured result object
 * containing the HTTP status, response headers, parsed body, latency, and
 * any network-level error that occurred.
 *
 * Global headers are merged with per-endpoint headers; per-endpoint headers
 * take precedence.  A `Content-Type: application/json` header is added
 * automatically when a body is present and no content-type has been set.
 *
 * The function never throws — all errors are captured in the `error` field of
 * the returned object so callers can handle them uniformly.
 *
 * @param {EndpointConfig} endpointCfg - Configuration for the endpoint to fetch
 * @param {Object} [globalHeaders={}] - Headers to apply to every request
 * @returns {Promise<FetchResult>}
 */
async function fetchEndpoint(endpointCfg, globalHeaders) {
  if (!endpointCfg || typeof endpointCfg.url !== 'string' || !endpointCfg.url.trim()) {
    return {
      name: (endpointCfg && endpointCfg.name) || 'unknown',
      url: (endpointCfg && endpointCfg.url) || '',
      method: 'GET',
      status: null,
      headers: {},
      body: null,
      error: 'Invalid endpoint configuration: "url" is required and must be a non-empty string.',
      latencyMs: null,
      fetchedAt: timestamp(),
    };
  }

  const {
    url,
    method = 'GET',
    headers: localHeaders = {},
    body = undefined,
    name = url,
  } = endpointCfg;

  const safeGlobalHeaders = (globalHeaders && typeof globalHeaders === 'object') ? globalHeaders : {};
  const safeLocalHeaders = (localHeaders && typeof localHeaders === 'object') ? localHeaders : {};

  const mergedHeaders = Object.assign({}, safeGlobalHeaders, safeLocalHeaders);

  const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : 'GET';

  const options = {
    method: normalizedMethod,
    headers: mergedHeaders,
    timeout: 15000,
  };

  const methodAllowsBody = !['GET', 'HEAD'].includes(normalizedMethod);

  if (body !== undefined && body !== null && methodAllowsBody) {
    if (typeof body === 'string') {
      options.body = body;
    } else {
      try {
        options.body = JSON.stringify(body);
      } catch (serializeErr) {
        return {
          name,
          url,
          method: normalizedMethod,
          status: null,
          headers: {},
          body: null,
          error: `Failed to serialize request body: ${serializeErr.message}`,
          latencyMs: null,
          fetchedAt: timestamp(),
        };
      }
    }

    const hasContentType = Object.keys(mergedHeaders).some(
      (k) => k.toLowerCase() === 'content-type'
    );
    if (!hasContentType) {
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

    try {
      responseHeaders = Object.fromEntries(res.headers.entries());
    } catch (_) {
      responseHeaders = {};
    }

    let text = '';
    try {
      text = await res.text();
    } catch (bodyErr) {
      error = `Failed to read response body: ${bodyErr.message}`;
      return {
        name,
        url,
        method: normalizedMethod,
        status,
        headers: responseHeaders,
        body: null,
        error,
        latencyMs,
        fetchedAt: timestamp(),
      };
    }

    if (text && text.trim().length > 0) {
      try {
        responseBody = JSON.parse(text);
      } catch (_) {
        responseBody = text;
      }
    } else {
      responseBody = null;
    }
  } catch (e) {
    latencyMs = Date.now() - start;
    error = e.message || 'Unknown network error';
  }

  return {
    name,
    url,
    method: normalizedMethod,
    status,
    headers: responseHeaders,
    body: responseBody,
    error,
    latencyMs,
    fetchedAt: timestamp(),
  };
}

/**
 * Fetches multiple endpoints in sequence and returns an array of FetchResult
 * objects.  Each endpoint is fetched one after the other (not in parallel) so
 * that rate-limited APIs are not overwhelmed.
 *
 * Errors on individual endpoints are captured inside each result object; this
 * function itself will not throw unless the `endpoints` argument is not an
 * array.
 *
 * @param {EndpointConfig[]} endpoints - Array of endpoint configurations
 * @param {Object} [globalHeaders={}] - Headers merged into every request
 * @param {Function} [onResult] - Optional callback invoked with each FetchResult as it completes
 * @returns {Promise<FetchResult[]>}
 */
async function fetchAll(endpoints, globalHeaders, onResult) {
  if (!Array.isArray(endpoints)) {
    throw new TypeError('"endpoints" must be an array of endpoint configuration objects.');
  }

  const safeGlobalHeaders = (globalHeaders && typeof globalHeaders === 'object') ? globalHeaders : {};
  const results = [];

  for (const ep of endpoints) {
    const result = await fetchEndpoint(ep, safeGlobalHeaders);
    results.push(result);
    if (typeof onResult === 'function') {
      try {
        onResult(result);
      } catch (_) {
        // Swallow errors thrown by the caller's callback so the loop continues.
      }
    }
  }

  return results;
}

module.exports = {
  fetchEndpoint,
  fetchAll,
};