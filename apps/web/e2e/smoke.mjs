// Browser end-to-end check on a running stack (API + web) with the DEMO tenant seeded.
// Usage: E2E_PASSWORD=… [E2E_BASE_URL=http://localhost:3100] [SCREENSHOTS=dir] node e2e/smoke.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Secret, TOTP } from 'otpauth';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.SCREENSHOTS;
if (!PASSWORD) throw new Error('E2E_PASSWORD is required');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

async function axe(label) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const out = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag22aa'] });
    return out.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map(
        (v) =>
          `${v.id}(${v.nodes.length}): ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join(' ; ')}`,
      );
  });
  check(`axe: no serious or critical issues on ${label}`, r.length === 0, r.join(', '));
}
const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

// 1. Unauthenticated visit goes to sign-in
await page.goto(`${BASE}/users`);
await page.waitForURL(/\/login/);
check('signed-out visit redirects to /login with next', page.url().includes('next=%2Fusers'));
await axe('sign-in');
await shot('01-login');

// 2. Wrong password is refused with a message
await page.fill('#tenant', 'demo');
await page.fill('#email', 'tenant_admin@demo.example.invalid');
await page.fill('#password', 'wrong-password-000');
await page.click('button[type=submit]');
check('wrong password shows an error', await page.getByRole('alert').isVisible());

// 3. Correct password → MFA enrol (first time) or challenge
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForSelector('#code');
const secretText = await page
  .locator('code.font-mono')
  .first()
  .textContent()
  .catch(() => null);
const secret = secretText?.trim() || process.env.E2E_TOTP_SECRET;
if (!secret) throw new Error('Account already enrolled: set E2E_TOTP_SECRET');
console.log(`TOTP secret for this run: ${secret.slice(0, 4)}…`);
await shot('02-mfa-setup');
await page.fill('#code', new TOTP({ secret: Secret.fromBase32(secret), period: 30, digits: 6 }).generate());
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/users`);
check('MFA completes and returns to the page asked for', page.url().endsWith('/users'));
await page.getByRole('heading', { name: 'Users and roles' }).waitFor();
await page.locator('tbody tr').first().waitFor();
check('users page lists the DEMO accounts', (await page.locator('tbody tr').count()) >= 11);
await axe('users');
await shot('04-users');

// 4. Command centre, honest empty states
await page.goto(`${BASE}/`);
await page.getByText('Guardrails').waitFor();
check('dashboard shows no simulated QA data', await page.getByText('No executions yet').isVisible());
await axe('command centre');
await shot('03-command-centre');

// 5. Command palette with keyboard
await page.keyboard.press('Control+k');
await page.getByPlaceholder('Search modules, settings and commands…').fill('activity logs');
await page.keyboard.press('Enter');
await page.waitForURL(`${BASE}/audit`);
check('⌘K palette navigates by keyboard', page.url().endsWith('/audit'));
await page.locator('tbody tr').first().waitFor();
check('audit log shows the sign-in entries', (await page.getByText('auth.mfa_enrolled').count()) > 0);
await axe('audit');
await shot('05-audit');

// 6. Create a person through the dialog
await page.goto(`${BASE}/users`);
await page.getByRole('button', { name: 'Add person' }).click();
const stamp = Date.now();
await page.fill('#n-name', 'DEMO New Analyst');
await page.fill('#n-email', `analyst-${stamp}@demo.example.invalid`);
await page.fill('#n-pass', 'demo-analyst-password-1');
await page.getByRole('checkbox', { name: 'Quality Analyst' }).check();
await page.getByRole('dialog').getByRole('button', { name: 'Add person' }).click();
await page.getByText(`analyst-${stamp}@demo.example.invalid`).waitFor();
check('a new person can be added from the UI', true);

// 7. Settings, security, planned module, roles tab
await page.goto(`${BASE}/settings`);
await page.getByLabel('Display name').waitFor();
await axe('settings');
await shot('06-settings');
await page.goto(`${BASE}/security`);
await page.getByText('Controls').first().waitFor();
await axe('security');
await shot('07-security');
// 7b. Phase 6: authorized synthetic QA, end to end on the sandbox fixtures (DEMO seed)
const toastGone = async () => {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
};
await page.goto(`${BASE}/authorizations`);
await page.getByRole('heading', { name: 'Authorization Centre' }).waitFor();
await page.locator('[data-testid=auth-row]').first().waitFor();
check('authorization centre lists the DEMO authorizations', (await page.locator('[data-testid=auth-row]').count()) === 2);
const pendingRow = page.locator('[data-testid=auth-row]', { hasText: 'DEMO Retail Insights GmbH' });
await pendingRow.getByRole('button', { name: 'Approve' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
await pendingRow.getByText('approved', { exact: true }).waitFor();
check('a pending authorization recorded by someone else can be approved', true);
await page.getByRole('button', { name: 'Record authorization' }).click();
await page.fill('#a-owner', 'DEMO Owner Recorded In E2E');
await page.getByRole('dialog').getByRole('button', { name: 'Record for approval' }).click();
const mine = page.locator('[data-testid=auth-row]', { hasText: 'DEMO Owner Recorded In E2E' });
await mine.waitFor();
check('separation of duties: no approve button on my own request', (await mine.getByRole('button', { name: 'Approve' }).count()) === 0 && (await mine.getByText('Waiting for someone else to decide').isVisible()));
await toastGone();
await axe('authorization centre');
await shot('11-authorizations');

await page.goto(`${BASE}/qa-projects`);
await page.locator('[data-testid=scenario-row]').first().waitFor();
check('QA project and its DEMO scenarios are listed', (await page.locator('[data-testid=scenario-row]').count()) === 6);
await page.getByRole('button', { name: 'Add scenario' }).click();
await page.fill('#s-name', 'German profile, localization');
await page.selectOption('#s-profile', { label: 'Fictional profile FP-03: 41, Germany, German-language' });
await page.selectOption('#s-language', 'de');
await page.getByRole('dialog').getByRole('button', { name: 'Save scenario' }).click();
await page.getByText('German profile, localization').waitFor();
check('a scenario can be added in the scenario editor', (await page.locator('[data-testid=scenario-row]').count()) === 7);
await toastGone();
await axe('QA projects');
await shot('12-qa-projects');

await page.goto(`${BASE}/executions`);
await page.getByRole('heading', { name: 'AI Execution Engine' }).waitFor();
await page.getByRole('button', { name: 'Queue job' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Select all' }).click();
await page.fill('#j-n', '2');
await page.getByRole('dialog').getByRole('button', { name: 'Queue' }).click();
await page.locator('[data-testid=job-row]').first().waitFor();
await toastGone();
await page.getByRole('button', { name: 'Run worker pass now' }).click();
await page.getByText('Worker pass: 10 sessions').waitFor();
await page.getByRole('button', { name: 'Run worker pass now' }).click();
await page.getByText('Worker pass: 4 sessions').waitFor();
await page.locator('[data-testid=job-row]', { hasText: '14 / 14 sessions' }).waitFor();
check('a job of 14 synthetic sessions runs to the end', true);
await toastGone();
await axe('execution engine');
await shot('13-executions');

await page.goto(`${BASE}/response-audit`);
await page.locator('[data-testid=session-row]').first().waitFor();
check('response audit lists 14 sessions', (await page.locator('[data-testid=session-row]').count()) === 14);
await shot('14-response-audit');
await page.locator('[data-testid=session-row]', { hasText: 'Age range check fires' }).first().getByRole('link').click();
await page.locator('[data-testid=question-row]').first().waitFor();
check('the range check is shown rejected, then answered', (await page.getByText('rejected:Enter a number from 1 to 120').count()) === 1);
check('assertions are listed per session', (await page.locator('[data-testid=assertion]').count()) >= 3);
await axe('session detail');
await shot('15-session-detail');

await page.goto(`${BASE}/qa-projects`);
await page.getByRole('button', { name: 'Change links' }).click();
await page.selectOption('#v-client', { index: 1 });
await page.getByRole('dialog').getByRole('button', { name: 'Save links' }).click();
await page.getByText('/s/grocery-client/v2').waitFor();
await toastGone();
await page.goto(`${BASE}/executions`);
await page.getByRole('button', { name: 'Queue job' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Select all' }).click();
await page.fill('#j-n', '1');
await page.getByRole('dialog').getByRole('button', { name: 'Queue' }).click();
await page.getByText('Job queued: 7 synthetic sessions').waitFor();
await toastGone();
await page.getByRole('button', { name: 'Run worker pass now' }).click();
await page.getByText('Worker pass: 7 sessions').waitFor();
await toastGone();

await page.goto(`${BASE}/quality`);
await page.locator('[data-testid=regression-row]').first().waitFor();
const changed = page.locator('[data-testid=regression-row]', { hasText: '45 to 54 completes' });
check('regression shows 45 to 54 moving from complete to quota full on v2', (await changed.getByText('Quota full').count()) === 1 && (await changed.getByText('changed').count()) === 1);
check('regression shows the question added in v2', (await page.getByText('client:C8').count()) >= 1);
await axe('quality control');
await shot('16-quality-regression');

for (const [path, heading, name] of [
  ['/gate-surveys', 'Gate Survey Manager', '17-gate-surveys'],
  ['/client-surveys', 'Client Survey Manager', '18-client-surveys'],
  ['/synthetic', 'Synthetic Data Engine', '19-synthetic'],
  ['/ir', 'IR Management', '20-ir'],
  ['/loi', 'LOI Monitoring', '21-loi'],
  ['/ip-intelligence', 'IP Intelligence', '22-ip'],
  ['/schedule', 'Scheduling Engine', '23-schedule'],
  ['/intervals', 'Interval Controller', '24-intervals'],
  ['/integrations/samptrek', 'Samptrek Integration', '25-samptrek'],
]) {
  await page.goto(`${BASE}${path}`);
  await page.getByRole('heading', { name: heading }).waitFor();
  await page.waitForLoadState('networkidle');
  await axe(heading);
  await shot(name);
}
check('client survey manager flags the injection text', (await (async () => { await page.goto(`${BASE}/client-surveys`); await page.getByText('prompt injection suspected').first().waitFor(); return true; })()));
await page.goto(`${BASE}/ir`);
await page.getByText('Not human IR').first().waitFor();
check('IR is labelled synthetic, not human', true);

await page.goto(`${BASE}/providers`);
await page.locator('[data-testid=provider-fixture]').waitFor();
await page.locator('[data-testid=provider-fixture]').getByLabel('Use this provider for model answers (turns the others off)').check();
await page.locator('[data-testid=provider-fixture]').getByRole('button', { name: 'Save' }).click();
await page.locator('[data-testid=provider-fixture]').getByText('Answering').waitFor();
check('the FIXTURE provider can be turned on', true);
await toastGone();
await axe('AI API management');
await shot('26-providers');
await page.goto(`${BASE}/budgets`);
await page.getByRole('button', { name: 'Set budget' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
await page.locator('[data-testid=budget-row]').waitFor();
check('a workspace budget can be set', true);
await toastGone();
await axe('budgets');
await shot('27-budgets');

const csv = await page.evaluate(async () => {
  const projects = await (await fetch('/api/v1/qa/projects')).json();
  const r = await fetch(`/api/v1/qa/exports/questions.csv?projectId=${projects[0].id}`);
  return { type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), text: await r.text() };
});
check('question export is a SYNTHETIC CSV with wording withheld', csv.type.startsWith('text/csv') && csv.disp.includes('SYNTHETIC-QA-GROCERY-questions.csv') && csv.text.includes('[withheld:'));
const xl = await page.evaluate(async () => {
  const projects = await (await fetch('/api/v1/qa/projects')).json();
  const r = await fetch(`/api/v1/qa/exports/sessions.xlsx?projectId=${projects[0].id}`);
  const b = new Uint8Array(await r.arrayBuffer());
  return { type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), pk: b[0] === 0x50 && b[1] === 0x4b };
});
check('session export also comes as a SYNTHETIC Excel file', xl.pk && xl.type.includes('spreadsheetml') && xl.disp.includes('SYNTHETIC-QA-GROCERY-sessions.xlsx'));
await page.goto(`${BASE}/reports`);
await page.getByText('Export history').waitFor();
await page.getByRole('cell', { name: 'questions' }).first().waitFor();
await axe('reports');
await shot('28-reports');

await page.goto(`${BASE}/integrations/supply360`);
await page.getByRole('button', { name: 'Issue token' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Issue' }).click();
const token = (await page.locator('[data-testid=new-token]').textContent()).trim();
check('a Supply360 service token is shown once', token.startsWith('sik.'));
await page.keyboard.press('Escape');
const summary = await page.evaluate(async (t) => (await fetch('/api/v1/integration/qa-summary?projectRef=PRX10001', { headers: { authorization: `Bearer ${t}` } })).json(), token);
check('the token reads a synthetic-only summary', summary.classification === 'synthetic_qa' && summary.sessions === 21);
await axe('Supply360 link');
await shot('29-supply360-link');

await page.goto(`${BASE}/executions`);
await page.getByRole('button', { name: 'Emergency stop' }).click();
await page.fill('#k-reason', 'DEMO drill');
await page.getByRole('dialog').getByRole('button', { name: 'Stop everything' }).click();
await page.getByText('Emergency stop is on').waitFor();
check('the emergency stop turns on and blocks queueing', await page.getByRole('button', { name: 'Queue job' }).isDisabled());
await toastGone();
await shot('30-emergency-stop');
await page.getByRole('button', { name: 'Clear emergency stop' }).click();
await page.fill('#k-reason', 'DEMO drill over');
await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
await page.getByText('Emergency stop is off').waitFor();
await page.goto(`${BASE}/security`);
await page.locator('[data-testid=security-event]').first().waitFor();
check('security centre shows the stop and the injection attempt', (await page.getByText('emergency stop', { exact: true }).count()) >= 1 && (await page.getByText('prompt injection suspected').count()) >= 1);
await shot('31-security-events');
await page.goto(`${BASE}/`);
await page.getByText('Guardrails').waitFor();
await page.getByText('QA-GROCERY').first().waitFor();
await shot('32-dashboard-after');

// 8. Themes
for (const [i, t] of ['arctic', 'violet', 'emerald', 'midnight', 'glass'].entries()) {
  await page.evaluate((id) => localStorage.setItem('si-theme', id), t);
  await page.goto(`${BASE}/`);
  await page.getByText('Guardrails').waitFor();
  check(`theme ${t} applies`, (await page.evaluate(() => document.documentElement.dataset.theme)) === t);
  if (t !== 'midnight') await axe(`command centre (${t})`);
  await shot(`09-theme-${i + 1}-${t}`);
}

// 9. Phone width
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`);
await page.getByRole('button', { name: 'Open navigation' }).click();
await page.getByRole('dialog').getByRole('link', { name: 'Users and roles' }).click();
await page.waitForURL(`${BASE}/users`);
check('mobile navigation works', true);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('no horizontal page scroll at phone width', !overflow);
await page.goto(`${BASE}/`);
await page.getByText('Guardrails').waitFor();
await shot('10-mobile');

// 10. Sign out
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'Account menu' }).click();
await page.getByRole('menuitem', { name: 'Sign out' }).click();
await page.waitForURL(/\/login/);
check('sign out returns to sign-in', true);

check(
  'no console errors',
  consoleErrors.filter((e) => !e.includes('401')).length === 0,
  consoleErrors.slice(0, 3).join(' | '),
);
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
