/**
 * k6 load test — API Gateway REST (Tasks API)
 *
 * Routes covered (derived from amplify/functions/tasks-api/handler.ts and
 * the OpenAPI spec served at /swagger.json):
 *
 *   GET    /tasks           — list all tasks for the authenticated user (200)
 *   POST   /tasks           — create a new task (201)
 *   GET    /tasks/{taskId}  — get a single task by ID (200)
 *   DELETE /tasks/{taskId}  — delete a task (200, body: {"message":"Task deleted"})
 *
 * NOTE: PUT / PATCH routes do not exist in this API. The Lambda handler only
 * implements GET collection, POST, GET by ID, and DELETE. No update route was
 * found in the codebase; this test covers all four implemented routes.
 *
 * Required environment variables:
 *   APIGW_BASE_URL        - API Gateway base URL (no trailing slash)
 *   COGNITO_CLIENT_ID     - Cognito app client ID
 *   COGNITO_TEST_USER     - Test user email
 *   COGNITO_TEST_PASSWORD - Test user password
 *   AWS_REGION            - AWS region (default: ap-southeast-2)
 *   PROFILE               - smoke | load | stress | soak (default: smoke)
 *
 * Run locally:
 *   k6 run \
 *     --env PROFILE=smoke \
 *     --env APIGW_BASE_URL=https://... \
 *     --env COGNITO_CLIENT_ID=... \
 *     --env COGNITO_TEST_USER=user@example.com \
 *     --env COGNITO_TEST_PASSWORD=... \
 *     --summary-export=reports/rest-smoke.json \
 *     tests/load/rest.test.js
 *
 * Auth note: API Gateway Cognito authorizer expects the ID token as a Bearer
 * token — "Authorization: Bearer <idToken>".
 */

import http  from 'k6/http';
import { sleep } from 'k6';

import { buildOptions } from './lib/profiles.js';
import { getIdToken }   from './lib/auth.js';
import { checkREST }    from './lib/checks.js';

// ─── Options ─────────────────────────────────────────────────────────────────

const PROFILE = __ENV.PROFILE || 'smoke';

// p95 threshold for REST API: 1 500 ms
export const options = buildOptions(PROFILE, 1500);

// ─── Default function (runs per VU per iteration) ─────────────────────────────

export default function () {
  // getIdToken() is cached per VU — no re-auth on every iteration
  const token   = getIdToken();
  const baseUrl = __ENV.APIGW_BASE_URL;

  const headers = {
    'Content-Type': 'application/json',
    // API Gateway Cognito authorizer requires the Bearer prefix
    'Authorization': `Bearer ${token}`,
  };

  // ── 1. GET /tasks — list all tasks ────────────────────────────────────────
  const listRes = http.get(`${baseUrl}/tasks`, {
    headers,
    tags: { name: 'GET_tasks' },
  });
  checkREST(listRes, 200, /* checkBody */ true);
  sleep(0.5);

  // ── 2. POST /tasks — create a task ────────────────────────────────────────
  // Fields: title (required, string), description (optional, string)
  const createRes = http.post(
    `${baseUrl}/tasks`,
    JSON.stringify({
      title:       `k6-load-test-${Date.now()}-VU${__VU}`,
      description: 'Created by k6 load test — safe to delete',
    }),
    {
      headers,
      tags: { name: 'POST_tasks' },
    }
  );
  checkREST(createRes, 201, /* checkBody */ true);

  // Extract taskId from the created record for GET-by-ID and DELETE
  let createdTaskId = null;
  try {
    const body = JSON.parse(createRes.body);
    if (body.taskId) {
      createdTaskId = body.taskId;
    }
  } catch (_) { /* parse failure already caught by checkREST */ }

  sleep(0.5);

  if (createdTaskId === null) {
    // POST failed — skip per-task operations for this iteration
    sleep(1);
    return;
  }

  // ── 3. GET /tasks/{taskId} — get by ID ───────────────────────────────────
  const getRes = http.get(`${baseUrl}/tasks/${createdTaskId}`, {
    headers,
    tags: { name: 'GET_tasks_id' },
  });
  checkREST(getRes, 200, /* checkBody */ true);
  sleep(0.5);

  // ── 4. DELETE /tasks/{taskId} — delete (cleanup) ─────────────────────────
  // The Lambda returns HTTP 200 with body {"message":"Task deleted"} — not 204.
  const deleteRes = http.del(`${baseUrl}/tasks/${createdTaskId}`, null, {
    headers,
    tags: { name: 'DELETE_tasks_id' },
  });
  checkREST(deleteRes, 200, /* checkBody */ false);

  sleep(1);
}
