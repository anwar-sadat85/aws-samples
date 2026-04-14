/**
 * k6 load test — AppSync GraphQL (Todo API)
 *
 * Operations covered (derived from amplify/data/resource.ts):
 *   listTodos    — list all todos for the authenticated user
 *   getTodo      — get a single todo by ID (uses TEST_TODO_ID env var)
 *   createTodo   — create a new todo
 *   updateTodo   — update the todo just created (mark completed, change title)
 *   deleteTodo   — delete the todo just created (cleanup)
 *
 * Required environment variables:
 *   APPSYNC_ENDPOINT      - AppSync GraphQL endpoint URL
 *   COGNITO_CLIENT_ID     - Cognito app client ID
 *   COGNITO_TEST_USER     - Test user email
 *   COGNITO_TEST_PASSWORD - Test user password
 *   TEST_TODO_ID          - ID of a pre-seeded Todo record used for getTodo
 *   AWS_REGION            - AWS region (default: ap-southeast-2)
 *   PROFILE               - smoke | load | stress | soak (default: smoke)
 *
 * Run locally:
 *   k6 run \
 *     --env PROFILE=smoke \
 *     --env APPSYNC_ENDPOINT=https://... \
 *     --env COGNITO_CLIENT_ID=... \
 *     --env COGNITO_TEST_USER=user@example.com \
 *     --env COGNITO_TEST_PASSWORD=... \
 *     --env TEST_TODO_ID=<uuid> \
 *     --summary-export=reports/graphql-smoke.json \
 *     tests/load/graphql.test.js
 *
 * Auth note: AppSync Cognito USER_POOLS auth expects the raw ID token in the
 * Authorization header — no "Bearer" prefix.
 */

import http  from 'k6/http';
import { sleep } from 'k6';

import { buildOptions } from './lib/profiles.js';
import { getIdToken }   from './lib/auth.js';
import { checkGraphQL } from './lib/checks.js';

// ─── Options ────────────────────────────────────────────────────────────────

const PROFILE = __ENV.PROFILE || 'smoke';

// p95 threshold for AppSync GraphQL: 2 000 ms
export const options = buildOptions(PROFILE, 2000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ENDPOINT = __ENV.APPSYNC_ENDPOINT;

function gqlHeaders(token) {
  return {
    'Content-Type': 'application/json',
    // AppSync USER_POOLS auth: raw ID token, no "Bearer" prefix
    'Authorization': token,
  };
}

function gqlPost(token, body, tagName) {
  return http.post(ENDPOINT, JSON.stringify(body), {
    headers: gqlHeaders(token),
    tags:    { name: tagName },
  });
}

// ─── Default function (runs per VU per iteration) ────────────────────────────

export default function () {
  // getIdToken() is cached per VU — no re-auth on every iteration
  const token = getIdToken();

  // ── 1. listTodos ──────────────────────────────────────────────────────────
  const listRes = gqlPost(token, {
    query: `
      query ListTodos {
        listTodos {
          items {
            id
            title
            description
            completed
            createdAt
            updatedAt
          }
          nextToken
        }
      }
    `,
  }, 'listTodos');

  checkGraphQL(listRes, 'listTodos');
  sleep(0.5);

  // ── 2. getTodo (pre-seeded record) ────────────────────────────────────────
  if (__ENV.TEST_TODO_ID) {
    const getRes = gqlPost(token, {
      query: `
        query GetTodo($id: ID!) {
          getTodo(id: $id) {
            id
            title
            description
            completed
            createdAt
            updatedAt
          }
        }
      `,
      variables: { id: __ENV.TEST_TODO_ID },
    }, 'getTodo');

    checkGraphQL(getRes, 'getTodo');
    sleep(0.5);
  }

  // ── 3. createTodo ─────────────────────────────────────────────────────────
  const createRes = gqlPost(token, {
    query: `
      mutation CreateTodo($input: CreateTodoInput!) {
        createTodo(input: $input) {
          id
          title
          description
          completed
          createdAt
          updatedAt
        }
      }
    `,
    variables: {
      input: {
        title:       `k6-load-test-${Date.now()}-VU${__VU}`,
        description: 'Created by k6 load test — safe to delete',
        completed:   false,
      },
    },
  }, 'createTodo');

  checkGraphQL(createRes, 'createTodo');

  // Extract the created record's ID for update and delete operations
  let createdId = null;
  try {
    const body = JSON.parse(createRes.body);
    if (body.data && body.data.createTodo) {
      createdId = body.data.createTodo.id;
    }
  } catch (_) { /* body parse failure already caught by checkGraphQL */ }

  sleep(0.5);

  if (createdId === null) {
    // createTodo failed — skip update/delete for this iteration
    sleep(1);
    return;
  }

  // ── 4. updateTodo ─────────────────────────────────────────────────────────
  const updateRes = gqlPost(token, {
    query: `
      mutation UpdateTodo($input: UpdateTodoInput!) {
        updateTodo(input: $input) {
          id
          title
          completed
          updatedAt
        }
      }
    `,
    variables: {
      input: {
        id:        createdId,
        title:     `k6-load-test-${Date.now()}-VU${__VU}-updated`,
        completed: true,
      },
    },
  }, 'updateTodo');

  checkGraphQL(updateRes, 'updateTodo');
  sleep(0.5);

  // ── 5. deleteTodo (cleanup) ───────────────────────────────────────────────
  const deleteRes = gqlPost(token, {
    query: `
      mutation DeleteTodo($input: DeleteTodoInput!) {
        deleteTodo(input: $input) {
          id
          title
        }
      }
    `,
    variables: {
      input: { id: createdId },
    },
  }, 'deleteTodo');

  checkGraphQL(deleteRes, 'deleteTodo');
  sleep(1);
}
