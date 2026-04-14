/**
 * Reusable k6 check helpers and custom metrics.
 *
 * Custom metrics:
 *   graphql_errors  — Rate of failed GraphQL operations (non-200 or errors[] present)
 *   rest_errors     — Rate of failed REST operations (unexpected status codes)
 *   graphql_req_duration — Trend of GraphQL request durations (ms)
 *   rest_req_duration    — Trend of REST request durations (ms)
 *
 * Usage:
 *   import { checkGraphQL, checkREST } from './lib/checks.js';
 *   checkGraphQL(res, 'listTodos');
 *   checkREST(res, 200, true);     // 200, check body is non-empty
 *   checkREST(res, 201, true);     // 201 created
 *   checkREST(res, 200, false);    // 200, skip body check (e.g. DELETE)
 */

import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/** Rate of GraphQL operations that returned an error or unexpected status. */
export const graphqlErrors = new Rate('graphql_errors');

/** Rate of REST operations that returned an unexpected status code. */
export const restErrors = new Rate('rest_errors');

/**
 * Trend of raw HTTP durations for GraphQL requests (milliseconds).
 * Second argument `true` signals to k6 that values are time-based.
 */
export const graphqlReqDuration = new Trend('graphql_req_duration', true);

/**
 * Trend of raw HTTP durations for REST requests (milliseconds).
 */
export const restReqDuration = new Trend('rest_req_duration', true);

/**
 * Run standard checks on an AppSync GraphQL response.
 *
 * AppSync always returns HTTP 200, even for application-level errors.
 * Errors appear in the response body as `{ errors: [...] }`.
 *
 * @param {object} res           - k6 http response object
 * @param {string} operationName - Label for the check output (e.g. 'createTodo')
 * @returns {boolean} true if all checks passed
 */
export function checkGraphQL(res, operationName) {
  const label = operationName || 'graphql';

  const passed = check(res, {
    [`${label}: status is 200`]: (r) => r.status === 200,

    [`${label}: response is valid JSON`]: (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch (_) {
        return false;
      }
    },

    [`${label}: no GraphQL errors`]: (r) => {
      try {
        const body = JSON.parse(r.body);
        return !body.errors || body.errors.length === 0;
      } catch (_) {
        return false;
      }
    },

    [`${label}: data field present`]: (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data !== undefined;
      } catch (_) {
        return false;
      }
    },
  });

  graphqlErrors.add(!passed);
  graphqlReqDuration.add(res.timings.duration);
  return passed;
}

/**
 * Run standard checks on a REST API response.
 *
 * @param {object}  res            - k6 http response object
 * @param {number}  expectedStatus - Expected HTTP status code (200, 201, 204…)
 * @param {boolean} checkBody      - When true, also assert the response body is non-empty
 * @returns {boolean} true if all checks passed
 */
export function checkREST(res, expectedStatus, checkBody) {
  const checkDefs = {
    [`REST: status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
  };

  if (checkBody) {
    checkDefs['REST: body is non-empty'] = (r) =>
      r.body !== null && r.body !== undefined && r.body.length > 0;
  }

  const passed = check(res, checkDefs);
  restErrors.add(!passed);
  restReqDuration.add(res.timings.duration);
  return passed;
}
