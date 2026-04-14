/**
 * Cognito USER_PASSWORD_AUTH token helper for k6.
 *
 * Fetches an ID token from Cognito on the first call within a VU and caches
 * it for the lifetime of that VU — no re-authentication on every iteration.
 *
 * Required environment variables:
 *   COGNITO_CLIENT_ID      - App client ID (no client secret)
 *   COGNITO_TEST_USER      - Test user email / username
 *   COGNITO_TEST_PASSWORD  - Test user password
 *   AWS_REGION             - e.g. ap-southeast-2  (defaults to ap-southeast-2)
 *
 * Usage:
 *   import { getIdToken } from './lib/auth.js';
 *   const token = getIdToken();   // cached after first call per VU
 */

import http from 'k6/http';

// Module-level variable — each k6 VU has its own JS runtime, so this is
// effectively per-VU storage. The first call fetches; subsequent calls return
// the cached value without making a network request.
let _cachedToken = null;

/**
 * Return the Cognito ID token for the current VU, fetching it on first call.
 *
 * @returns {string} JWT ID token
 * @throws  {Error}  if Cognito returns a non-200 response
 */
export function getIdToken() {
  if (_cachedToken !== null) {
    return _cachedToken;
  }

  const region   = __ENV.AWS_REGION || 'ap-southeast-2';
  const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;

  const payload = JSON.stringify({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: __ENV.COGNITO_CLIENT_ID,
    AuthParameters: {
      USERNAME: __ENV.COGNITO_TEST_USER,
      PASSWORD: __ENV.COGNITO_TEST_PASSWORD,
    },
  });

  const res = http.post(endpoint, payload, {
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    // Tag so Cognito auth traffic is excluded from the main latency thresholds.
    tags: { name: 'cognito_initiate_auth' },
  });

  if (res.status !== 200) {
    throw new Error(
      `Cognito InitiateAuth failed [VU ${__VU}]: HTTP ${res.status} — ${res.body}`
    );
  }

  let body;
  try {
    body = JSON.parse(res.body);
  } catch (e) {
    throw new Error(`Cognito response is not valid JSON: ${res.body}`);
  }

  if (!body.AuthenticationResult || !body.AuthenticationResult.IdToken) {
    throw new Error(
      `Cognito response missing IdToken — check credentials and USER_PASSWORD_AUTH is enabled. Body: ${res.body}`
    );
  }

  _cachedToken = body.AuthenticationResult.IdToken;
  return _cachedToken;
}
