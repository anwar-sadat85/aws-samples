import { chromium } from '@playwright/test';
import { Amplify } from 'aws-amplify';
import { signIn, fetchAuthSession } from 'aws-amplify/auth';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load amplify_outputs.json from the project root at runtime (not via static
// import) so this Node.js script does not go through the Vite bundler.
const outputs = JSON.parse(
  readFileSync(resolve(__dirname, 'amplify_outputs.json'), 'utf-8')
) as {
  auth: { user_pool_client_id: string; aws_region: string };
  data: { url: string };
  custom: { tasksApiUrl: string };
};

export default async function globalSetup() {
  const testUser = process.env.COGNITO_TEST_USER;
  const testPassword = process.env.COGNITO_TEST_PASSWORD;

  if (!testUser || !testPassword) {
    throw new Error(
      'COGNITO_TEST_USER and COGNITO_TEST_PASSWORD must be set before running Playwright tests.'
    );
  }

  // Configure Amplify in this Node.js process so signIn() knows which
  // User Pool to talk to.
  Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

  // Authenticate against Cognito — no browser needed at this point.
  await signIn({ username: testUser, password: testPassword });

  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken?.toString() ?? '';
  const accessToken = session.tokens?.accessToken?.toString() ?? '';

  if (!idToken || !accessToken) {
    throw new Error('fetchAuthSession() returned no tokens — check credentials.');
  }

  // Open a headless browser, navigate to the app, and inject the Cognito
  // tokens into localStorage using the key format that Amplify v6 writes
  // in a real browser session.  This avoids interacting with the sign-in UI
  // and gives us a storage state we can reuse across every spec file.
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:3000');

  const clientId = outputs.auth.user_pool_client_id;

  await page.evaluate(
    ({ clientId, username, idToken, accessToken }) => {
      const prefix = `CognitoIdentityServiceProvider.${clientId}`;
      localStorage.setItem(`${prefix}.LastAuthUser`, username);
      localStorage.setItem(`${prefix}.${username}.idToken`, idToken);
      localStorage.setItem(`${prefix}.${username}.accessToken`, accessToken);
      // clockDrift tells Amplify the token was issued "right now" relative to
      // the local clock; 0 is correct for freshly-issued tokens.
      localStorage.setItem(`${prefix}.${username}.clockDrift`, '0');
    },
    { clientId, username: testUser, idToken, accessToken }
  );

  // Reload so Amplify picks up the tokens and the <Authenticator> renders the
  // authenticated shell.
  await page.reload();

  // Wait for the authenticated header element that App.tsx renders.
  await page.locator('.user-email').waitFor({ timeout: 30_000 });

  // Persist the full browser storage (cookies + localStorage) so every test
  // worker can start already authenticated.
  mkdirSync(resolve(__dirname, 'playwright', '.auth'), { recursive: true });
  await context.storageState({ path: 'playwright/.auth/user.json' });

  await browser.close();
}
