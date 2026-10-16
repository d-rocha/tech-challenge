import { test as base, expect, type Page } from '@playwright/test';
import { persistedRecord } from './records.mjs';
import { loadState, assertRuntime, resetDatabase, restartApi } from './owned-stack.mjs';
export { expect };
export const bronze = '11111111-1111-1111-1111-111111111111';
export const prata = '22222222-2222-2222-2222-222222222222';
export const state = loadState();

export const test = base.extend<{ cleanDatabase: void }>({
  cleanDatabase: [async ({}, use) => {
    await resetDatabase(state);
    await use();
  }, { auto: true }],
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Assert at teardown even when the flow itself succeeds.
  (page as Page & { runtimeErrors?: string[] }).runtimeErrors = errors;
});
test.afterEach(async ({ page }) => {
  const errors = (page as Page & { runtimeErrors?: string[] }).runtimeErrors;
  if (errors) expect(errors).toEqual([]); // Setup failures have no browser session to inspect.
  if (!page.isClosed() && page.url().startsWith('http://localhost:4200')) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

export async function api(path: string, method = 'GET', data?: unknown, expected = 200) {
  assertRuntime(state); // Actual owned bindings must match before HTTP setup/verification/mutations.
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Relative API path required');
  const response = await fetch(`http://127.0.0.1:${state.apiPort}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: data === undefined ? {} : { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  expect(response.status, `${method} ${path}`).toBe(expected);
  return response.status === 204 ? null : await response.json();
}
let sequence = 0;
export function cpf() {
  const digits = String(700000000 + (++sequence)).split('').map(Number);
  for (let length = 9; length <= 10; length++) {
    const sum = digits.reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const remainder = sum % 11;
    digits.push(remainder < 2 ? 0 : 11 - remainder);
  }
  return digits.join('');
}
export function cadastro(name = 'Pessoa Sintetica QA', plan = bronze, identifier = cpf()) {
  return { nome_completo: name, cpf: identifier, data_nascimento: '1990-05-12', plano_id: plan };
}
export async function create(name?: string, plan = bronze) {
  return api('/beneficiarios', 'POST', cadastro(name, plan), 201);
}
export function updateData(record: any, changes: Record<string, unknown> = {}) {
  return { nome_completo: record.nome_completo, data_nascimento: record.data_nascimento,
    plano_id: record.plano_id, status: record.status, ...changes };
}
export async function open(page: Page) {
  const cors = page.waitForResponse(response => response.url().startsWith('http://localhost:9999/beneficiarios') && response.request().method() === 'GET');
  await page.goto('/');
  expect(page.url()).toBe('http://localhost:4200/');
  expect((await cors).headers()['access-control-allow-origin']).toBe('http://localhost:4200');
  await expect(page.getByRole('button', { name: 'Novo beneficiário', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Plano', { exact: true })).toBeEnabled();
}
export async function fill(page: Page, data: ReturnType<typeof cadastro>) {
  await page.getByLabel('Nome completo', { exact: true }).fill(data.nome_completo);
  await page.getByLabel('CPF', { exact: true }).fill(data.cpf);
  await page.getByLabel('Data de nascimento', { exact: true }).fill(data.data_nascimento);
  await page.getByLabel('Plano do beneficiário', { exact: true }).selectOption(data.plano_id);
}
export async function save(page: Page, method: 'POST' | 'PUT', status: number, payload: unknown) {
  const pending = page.waitForResponse(response => response.url().includes('/beneficiarios') && response.request().method() === method);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(status);
  expect(response.request().postDataJSON()).toEqual(payload);
  return response;
}
export function row(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
}
export async function restart() { await restartApi(state); }

export function expectRecord(actual: unknown, expected: unknown) {
  expect(persistedRecord(actual)).toEqual(persistedRecord(expected));
}
