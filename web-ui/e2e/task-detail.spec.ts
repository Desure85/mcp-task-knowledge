import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'node:path';

const MCP_URL = process.env.E2E_MCP_URL ?? 'http://127.0.0.1:3001';
const USER = process.env.E2E_LOGIN_USER ?? 'admin';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? 'demo';

let client: Client;
let project = '';
let statuses: Array<{ id: string; label: string; category: string; archived?: boolean }> = [];
let originalTransitions: Record<string, string[]> | null = null;
let token = '';
let todoStatus = '';
let inProgressStatus = '';
let doneStatus = '';
let forbiddenStatus = '';
let allDoneStatuses: string[] = [];
let allowedStatus = '';

async function tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '{}';
  const env = JSON.parse(text) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!env.ok) throw new Error(`${name}: ${env.error?.message ?? 'unknown'}`);
  return env.data as T;
}

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${MCP_URL}/auth/login`, { data: { username: USER, password: PASSWORD } });
  expect(response.ok(), 'login for task page').toBe(true);
  token = ((await response.json()) as { token: string }).token;

  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'ui37-e2e', version: '1.0.0' });
  await client.connect(transport);
  await tool('mcp.authenticate', { token });

  let current: { project: string };
  try {
    current = await tool<{ project: string }>('project_get_current');
  } catch {
    const projects = await tool<Array<{ id: string }>>('projects_list');
    current = { project: projects[0]?.id ?? 'mcp' };
    await tool('project_set_current', { project: current.project });
  }
  project = current.project;
  const data = await tool<{ statuses: typeof statuses; closeStatus: string }>('project_statuses_get', { project });
  statuses = data.statuses;
  const active = statuses.filter((status) => !status.archived);
  todoStatus = active.find((status) => status.category === 'todo')?.id ?? active[0].id;
  inProgressStatus = active.find((status) => status.category === 'in_progress')?.id ?? todoStatus;
  doneStatus = data.closeStatus ?? active.find((status) => status.category === 'done')?.id ?? todoStatus;
  forbiddenStatus = active.find((status) => status.category === 'done' && status.id !== doneStatus)?.id ?? doneStatus;

  const previous = await tool<{ transitions: Record<string, string[]> | null }>('project_transitions_get', { project });
  originalTransitions = previous.transitions;
  const allDone = active.filter((status) => status.category === 'done').map((status) => status.id);
  allDoneStatuses = allDone;
  forbiddenStatus = doneStatus;
  allowedStatus = allDone.find((statusId) => statusId !== doneStatus) ?? doneStatus;
});

test.afterAll(async () => {
  try {
    if (project && originalTransitions !== null) {
      await tool('project_transitions_set', { project, transitions: originalTransitions });
    } else if (project) {
      await tool('project_transitions_set', { project, transitions: null });
    }
  } finally {
    await client?.close();
  }
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((value) => sessionStorage.setItem('mcp.auth.token', value), token);
});

async function createTask(title: string, description: string): Promise<string> {
  const task = await tool<{ id: string }>('tasks_create', {
    project,
    title,
    description,
    priority: 'high',
    tags: ['ui37'],
  });
  return task.id;
}

test('UI-37: direct URL, full description, forbidden transition and claim lease', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `UI37-detail-${stamp}`;
  const description = `Line one ${stamp}\nLine two of the full description\nLine three`;
  const id = await createTask(title, description);
  // Move into in_progress while transitions are still unrestricted, then pin a
  // graph where in_progress may only reach doneStatus.
  await tool('tasks_update', { project, id, status: inProgressStatus });
  const transitions: Record<string, string[]> = {};
  for (const status of statuses.filter((item) => !item.archived)) transitions[status.id] = [];
  for (const statusId of [todoStatus, inProgressStatus, doneStatus, ...statuses.filter((s) => s.category === 'done').map((s) => s.id)]) {
    transitions[statusId] = transitions[statusId] ?? [];
  }
  transitions[todoStatus] = allDoneStatuses.length > 0 ? allDoneStatuses : [doneStatus];
  // No outgoing edge from the task's current status: every target is forbidden.\n  transitions[inProgressStatus] = [];
  for (const statusId of allDoneStatuses) transitions[statusId] = [statusId];
  await tool('project_transitions_set', { project, transitions });
  if (!forbiddenStatus) throw new Error('project has no second done status to test a forbidden transition');

  await page.goto(`/tasks/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveText(title);
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue(description);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('main h1')).toHaveText(title);
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue(description);

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.prose').first()).toContainText(`Line one ${stamp}`);
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue(description);

  await page.getByRole('combobox', { name: 'Status' }).selectOption(forbiddenStatus);
  await page.getByRole('button', { name: 'Save changes' }).click();
  const transitionAlert = page.getByText(/Transition rejected by the server/);
  await expect(transitionAlert).toBeVisible();
  await expect(transitionAlert).toContainText('TRANSITION_NOT_ALLOWED');
  await expect(page.getByText(/allowed from/i)).toBeVisible();

  await page.getByRole('button', { name: 'Claim task' }).click();
  await expect(page.getByText('Claimed', { exact: true })).toBeVisible();
  await expect(page.getByText(/Expires:/)).toBeVisible();
  await page.getByRole('button', { name: 'Renew' }).click();
  await expect(page.getByText('Claim renewed.')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.resolve('..', 'docs/ui/screens/ui-37/task-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.resolve('..', 'docs/ui/screens/ui-37/task-390.png'), fullPage: true });
});

test('UI-37: unknown id is a 404-style empty state', async ({ page }) => {
  await page.goto('/tasks/does-not-exist-ui37', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main h1')).toHaveText('Task not found');
  await expect(page.getByRole('link', { name: 'Back to tasks' })).toBeVisible();
});

test('UI-37: archive and trash require a destructive confirmation', async ({ page }) => {
  const id = await createTask(`UI37-destructive-${Date.now().toString(36)}`, 'Temporary task for archive/trash.');
  await page.goto(`/tasks/${id}`, { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Archive' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Archive this task?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Trash' }).click();
  await expect(page.getByRole('dialog')).toContainText('Move this task to trash?');
  await page.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await tool('tasks_bulk_restore', { project, ids: [id] });
});
