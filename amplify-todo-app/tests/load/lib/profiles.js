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

/**
 * Build a k6 options object for the given profile.
 *
 * The checks threshold ('rate==1') is used for error detection rather than a
 * custom Rate metric. k6 custom Rate metrics misreport their threshold result
 * in --summary-export when passes=0 (i.e. every add() call was add(false),
 * which is the normal state when there are no errors). The built-in checks
 * metric does not have this bug and evaluates correctly in all k6 versions.
 *
 * graphqlErrors / restErrors in checks.js are still recorded and visible in
 * the summary output as observability signals; they are just not threshold
 * targets.
 *
 * @param {string} profileName - One of: smoke, load, stress, soak
 * @param {number} p95Ms       - p95 latency threshold in milliseconds
 *                               (2000 for GraphQL, 1500 for REST)
 * @returns {object} k6 options suitable for export const options = ...
 */
export function buildOptions(profileName, p95Ms) {
  const stages = STAGES[profileName] || STAGES.smoke;

  return {
    stages,
    thresholds: {
      // 100% of all check() calls must pass — k6 evaluates this correctly.
      checks:            ['rate==1'],
      http_req_duration: [`p(95)<${p95Ms}`],
    },
  };
}