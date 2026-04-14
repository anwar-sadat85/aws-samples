/**
 * Shared k6 load test profiles.
 *
 * Provides stage definitions and per-profile error-rate thresholds. Latency
 * thresholds differ between GraphQL (2 000 ms) and REST (1 500 ms) so they are
 * applied by each test file via buildOptions().
 *
 * Select a profile at runtime:
 *   k6 run --env PROFILE=load tests/load/graphql.test.js
 *
 * Available profiles: smoke | load | stress | soak
 */

const STAGES = {
  /**
   * smoke — minimal traffic; 1 VU for 1 minute.
   * Purpose: confirm the script and endpoints are reachable before a real run.
   */
  smoke: [
    { duration: '30s', target: 1 },
    { duration: '30s', target: 1 },
  ],

  /**
   * load — typical expected production traffic.
   * Ramp to 20 VUs over 1 minute, sustain for 5 minutes, ramp down.
   */
  load: [
    { duration: '1m',  target: 20 },
    { duration: '5m',  target: 20 },
    { duration: '1m',  target: 0  },
  ],

  /**
   * stress — incremental ramp to find the breaking point.
   * Reaches 150 VUs, then ramps down gracefully.
   */
  stress: [
    { duration: '1m',  target: 20  },
    { duration: '2m',  target: 50  },
    { duration: '2m',  target: 100 },
    { duration: '2m',  target: 150 },
    { duration: '1m',  target: 0   },
  ],

  /**
   * soak — sustained moderate load to detect memory leaks and slow degradation.
   * 10 VUs for 30 minutes.
   */
  soak: [
    { duration: '2m',  target: 10 },
    { duration: '26m', target: 10 },
    { duration: '2m',  target: 0  },
  ],
};

/** Maximum acceptable error rate per profile. */
const ERROR_RATE_THRESHOLDS = {
  smoke:  'rate==0',
  load:   'rate==0',
  stress: 'rate<0.10',
  soak:   'rate==0',
};

/**
 * Build a k6 options object for the given profile.
 *
 * Uses custom error rate metrics (graphql_errors or rest_errors) instead of
 * k6's built-in http_req_failed. The built-in metric reports false negatives
 * when all requests succeed — its passes/fails fields track something different
 * from what the threshold engine expects, causing thresholds to resolve as
 * false even when no errors occurred.
 *
 * @param {string} profileName  - One of: smoke, load, stress, soak
 * @param {number} p95Ms        - p95 latency threshold in milliseconds
 *                                (2000 for GraphQL, 1500 for REST)
 * @param {string} errorMetric  - Custom Rate metric name to threshold on:
 *                                'graphql_errors' or 'rest_errors'
 * @returns {object} k6 options suitable for export const options = ...
 */
export function buildOptions(profileName, p95Ms, errorMetric) {
  const stages    = STAGES[profileName]                || STAGES.smoke;
  const errorRate = ERROR_RATE_THRESHOLDS[profileName] || ERROR_RATE_THRESHOLDS.smoke;

  return {
    stages,
    thresholds: {
      // Custom metric from checks.js — accurately reflects operation failures.
      // Falls back to http_req_failed if no errorMetric supplied.
      [errorMetric || 'http_req_failed']: [errorRate],
      http_req_duration: [`p(95)<${p95Ms}`],
    },
  };
}