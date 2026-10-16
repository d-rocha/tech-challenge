import { test, expect, expectRecord, api, bronze, prata, cadastro, cpf, create, updateData, open, fill, save, row, restart } from './helpers';

test('fresh migrations, fixed seed, Swagger and restart preserve data and deleted plan', async ({ page }) => {
  expect(await api('/health')).toEqual({ status: 'ok', banco: 'ok' });
  const expected = [
    [bronze, 'Bronze', '100001'], [prata, 'Prata', '100002'],
    ['33333333-3333-3333-3333-333333333333', 'Ouro', '100003'],
    ['44444444-4444-4444-4444-444444444444', 'Diamante', '100004'],
    ['55555555-5555-5555-5555-555555555555', 'Executivo', '100005'],
  ];
  const plans = await api('/planos');
  expect(plans.map((plan: any) => [plan.id, plan.nome, plan.codigo_registro_ans]).sort()).toEqual(expected.sort());
  expect((await api('/beneficiarios')).total).toBe(0);
  const swagger = await api('/swagger/v1/swagger.json');
  for (const path of ['/beneficiarios', '/beneficiarios/{id}', '/planos', '/planos/{id}', '/health']) {
    expect(swagger.paths[path]).toBeTruthy();
  }
  expect(Object.keys(swagger.paths['/beneficiarios/{id}']).sort()).toEqual(['delete', 'get', 'put']);
  expect(swagger.paths['/beneficiarios'].post.responses['201']).toBeTruthy();
  await open(page);
  await expect(page.getByRole('heading', { name: 'Planos', exact: true })).toBeVisible();
  await expect(page.getByText('Nenhum beneficiário encontrado.', { exact: true })).toBeVisible();
  const person = await create('Historico Persistente QA');
  await api(`/planos/${bronze}`, 'DELETE', undefined, 204);
  await restart();
  expect((await api('/planos')).length).toBe(4);
  await api(`/planos/${bronze}`, 'GET', undefined, 404);
  expectRecord(await api(`/beneficiarios/${person.id}`), person);
  expect((await api('/beneficiarios')).dados[0].plano_nome).toBe('Bronze');
  await page.reload();
  await expect(row(page, person.nome_completo).getByRole('cell', { name: 'Bronze', exact: true })).toBeVisible();
  await restart();
  expect((await api('/planos')).map((plan: any) => plan.id).sort()).toEqual(expected.filter(plan => plan[0] !== bronze).map(plan => plan[0]).sort());
  expect((await api('/beneficiarios')).total).toBe(1);
});

test('UI CRUD persists exact payloads, immutable CPF, freeze and reactivation', async ({ page }, testInfo) => {
  await open(page);
  await page.getByRole('button', { name: 'Novo beneficiário', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Nome completo', { exact: true })).toBeVisible();
  const data = cadastro('Cadastro Navegador QA');
  await fill(page, data);
  const created = await save(page, 'POST', 201, data);
  const person = await created.json();
  expect(created.headers()['access-control-allow-origin']).toBe('http://localhost:4200');
  expect(created.headers()['location']).toContain(`/beneficiarios/${person.id}`);
  expectRecord(await api(`/beneficiarios/${person.id}`), person);
  await expect(row(page, data.nome_completo)).toBeVisible();
  await expect(row(page, data.nome_completo).getByRole('cell', { name: '12/05/1990', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Editar ${data.nome_completo}`, exact: true }).click();
  await expect(page.getByLabel('CPF', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByLabel('Nome completo', { exact: true }).fill('Cadastro Editado QA');
  await page.getByLabel('Data de nascimento', { exact: true }).fill('1988-02-20');
  await page.getByLabel('Plano do beneficiário', { exact: true }).selectOption(prata);
  const modified = updateData(person, { nome_completo: 'Cadastro Editado QA', data_nascimento: '1988-02-20', plano_id: prata });
  await save(page, 'PUT', 200, modified);
  const persisted = await api(`/beneficiarios/${person.id}`);
  expectRecord(persisted, { ...person, ...modified });
  await expect(row(page, modified.nome_completo).getByRole('cell', { name: 'Prata', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Editar ${modified.nome_completo}`, exact: true }).click();
  await page.getByLabel('Situação do beneficiário', { exact: true }).selectOption('INATIVO');
  await save(page, 'PUT', 200, { ...modified, status: 'INATIVO' });
  expect((await api(`/beneficiarios/${person.id}`)).status).toBe('INATIVO');
  await expect(row(page, modified.nome_completo).getByRole('cell', { name: 'INATIVO', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Editar ${modified.nome_completo}`, exact: true }).click();
  for (const label of ['Nome completo', 'Data de nascimento', 'Plano do beneficiário']) {
    await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
  }
  await page.getByLabel('Situação do beneficiário', { exact: true }).selectOption('ATIVO');
  await save(page, 'PUT', 200, modified);
  expectRecord(await api(`/beneficiarios/${person.id}`), persisted);
  await expect(row(page, modified.nome_completo).getByRole('cell', { name: 'ATIVO', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Editar ${modified.nome_completo}`, exact: true }).click();
  await expect(page.getByLabel('Nome completo', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue(modified.nome_completo);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('beneficiarios.png'), fullPage: true });
});

for (const scenario of ['invalid CPF 400', 'duplicate CPF 409', 'deleted plan after form open 422'] as const) {
  test(`real ${scenario} is visible and preserves input`, async ({ page }) => {
    const data = cadastro(`Erro Real QA ${scenario.slice(-3)}`);
    let status: number;
    if (scenario.startsWith('duplicate')) {
      await api('/beneficiarios', 'POST', data, 201);
      status = 409;
    } else if (scenario.startsWith('invalid')) {
      data.cpf = '11111111111'; // Valid client format, invalid real backend check digits.
      status = 400;
    } else { status = 422; }
    await open(page);
    await page.getByRole('button', { name: 'Novo beneficiário', exact: true }).click();
    await fill(page, data);
    if (status === 422) await api(`/planos/${bronze}`, 'DELETE', undefined, 204);
    const response = await save(page, 'POST', status, data);
    const error = await response.json();
    await expect(page.getByRole('alert')).toContainText(error.mensagem);
    expect(error.detalhes.length).toBeGreaterThan(0);
    await expect(page.getByRole('alert')).toContainText(error.detalhes[0].campo);
    await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue(data.nome_completo);
    await expect(page.getByLabel('CPF', { exact: true })).toHaveValue(data.cpf);
    await expect(page.getByLabel('Data de nascimento', { exact: true })).toHaveValue(data.data_nascimento);
    await expect(page.getByLabel('Plano do beneficiário', { exact: true })).toHaveValue(data.plano_id);
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeEnabled();
    expect((await api('/beneficiarios')).total).toBe(status === 409 ? 1 : 0);
  });
}

test('real frozen-record conflict preserves unsaved form and server data', async ({ page }) => {
  const person = await create('Concorrencia Congelada QA');
  await open(page);
  await page.getByRole('button', { name: `Editar ${person.nome_completo}`, exact: true }).click();
  await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue(person.nome_completo);
  const frozen = updateData(person, { status: 'INATIVO' });
  await api(`/beneficiarios/${person.id}`, 'PUT', frozen);
  await page.getByLabel('Nome completo', { exact: true }).fill('Alteracao Recusada QA');
  const response = await save(page, 'PUT', 409, updateData(person, { nome_completo: 'Alteracao Recusada QA' }));
  await expect(page.getByRole('alert')).toContainText((await response.json()).mensagem);
  await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue('Alteracao Recusada QA');
  expectRecord(await api(`/beneficiarios/${person.id}`), { ...person, status: 'INATIVO' });
});

test('inactive historical plan retains real name and blocks reactivation with actual 422', async ({ page }) => {
  const person = await create('Plano Historico Inativo QA');
  await api(`/beneficiarios/${person.id}`, 'PUT', updateData(person, { status: 'INATIVO' }));
  await api(`/planos/${bronze}`, 'DELETE', undefined, 204);
  await open(page);
  await expect(row(page, person.nome_completo).getByRole('cell', { name: 'Bronze', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Editar ${person.nome_completo}`, exact: true }).click();
  await expect(page.getByText(/A reativação fica bloqueada/)).toBeVisible();
  await expect(page.getByLabel('Plano do beneficiário', { exact: true })).toBeDisabled();
  await page.getByLabel('Situação do beneficiário', { exact: true }).selectOption('ATIVO');
  const response = await save(page, 'PUT', 422, updateData(person));
  await expect(page.getByRole('alert')).toContainText((await response.json()).mensagem);
  expect((await api(`/beneficiarios/${person.id}`)).status).toBe('INATIVO');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  await expect(row(page, person.nome_completo).getByRole('cell', { name: 'Bronze', exact: true })).toBeVisible();
});

test('pagination traverses all rows; repeated combined filters and clearing preserve results', async ({ page }) => {
  const records = [];
  for (let index = 0; index < 13; index++) {
    const person = await create(`Pessoa Paginada QA ${String(index).padStart(2, '0')}`, index % 3 === 0 ? prata : bronze);
    if (index % 2 === 1) {
      await api(`/beneficiarios/${person.id}`, 'PUT', updateData(person, { status: 'INATIVO' }));
      person.status = 'INATIVO';
    }
    records.push(person);
  }
  await open(page);
  await expect(page.getByText('Total: 13 · Página 1 de 2', { exact: true })).toBeVisible();
  const visibleNames = () => page.getByRole('region', { name: 'Lista de beneficiários' }).locator('tbody tr td:first-child').allTextContents();
  const first = await visibleNames();
  expect(first.length).toBe(10);
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(page.getByText('Total: 13 · Página 2 de 2', { exact: true })).toBeVisible();
  const second = await visibleNames();
  expect(second.length).toBe(3);
  expect([...first, ...second].sort()).toEqual(records.map(record => record.nome_completo).sort());
  expect(new Set([...first, ...second]).size).toBe(13);
  for (const status of ['ATIVO', 'INATIVO', 'ATIVO']) {
    await page.getByLabel('Situação', { exact: true }).selectOption(status);
    const selectedPlan = await page.getByLabel('Plano', { exact: true }).inputValue();
    const forStatus = records.filter(record => record.status === status && (!selectedPlan || record.plano_id === selectedPlan));
    await expect(page.getByText(`Total: ${forStatus.length} · Página 1 de 1`, { exact: true })).toBeVisible();
    for (const plan of [bronze, prata, bronze]) {
      await page.getByLabel('Plano', { exact: true }).selectOption(plan);
      const filtered = records.filter(record => record.status === status && record.plano_id === plan);
      expect(filtered.length).toBeGreaterThan(0);
      await expect(page.getByText(`Total: ${filtered.length} · Página 1 de 1`, { exact: true })).toBeVisible();
      await expect.poll(visibleNames).toEqual(filtered.map(record => record.nome_completo).sort());
      for (const record of filtered) {
        await expect(row(page, record.nome_completo).getByRole('cell', { name: record.plano_id === bronze ? 'Bronze' : 'Prata', exact: true })).toBeVisible();
        await expect(row(page, record.nome_completo).getByRole('cell', { name: '12/05/1990', exact: true })).toBeVisible();
      }
    }
  }
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(page.getByText('Total: 13 · Página 1 de 2', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Plano', { exact: true })).toHaveValue('');
  await expect.poll(visibleNames).toEqual(first);
});

test('delete cancel sends nothing; synthetic DELETE500 retains row; retry204 persists and repairs last page', async ({ page }) => {
  const records = [];
  for (let index = 0; index < 11; index++) records.push(await create(`Exclusao QA ${String(index).padStart(2, '0')}`));
  await open(page);
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(page.getByText('Total: 11 · Página 2 de 2', { exact: true })).toBeVisible();
  const target = records[10];
  await expect(row(page, target.nome_completo)).toBeVisible();
  const deletes: string[] = [];
  page.on('request', request => { if (request.method() === 'DELETE') deletes.push(request.url()); });
  await page.getByRole('button', { name: `Excluir ${target.nome_completo}`, exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar exclusão', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar exclusão', exact: true })).toHaveCount(0);
  expect(deletes).toEqual([]);
  expectRecord(await api(`/beneficiarios/${target.id}`), target);
  // Deliberate fault injection: this single response is NOT evidence of native server500 handling.
  await page.route(`http://localhost:9999/beneficiarios/${target.id}`, async route => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({
        erro: 'FalhaSintetica', mensagem: 'Falha sintética de exclusão QA', detalhes: [],
      }) });
    } else await route.continue();
  });
  await page.getByRole('button', { name: `Excluir ${target.nome_completo}`, exact: true }).click();
  const injected = page.waitForResponse(response => response.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click();
  expect((await injected).status()).toBe(500);
  await expect(page.getByRole('alert')).toHaveText('Falha sintética de exclusão QA');
  await expect(row(page, target.nome_completo)).toBeVisible();
  expectRecord(await api(`/beneficiarios/${target.id}`), target);
  await page.unroute(`http://localhost:9999/beneficiarios/${target.id}`);
  const removed = page.waitForResponse(response => response.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click();
  expect((await removed).status()).toBe(204);
  await expect(row(page, target.nome_completo)).toHaveCount(0);
  await expect(page.getByText('Total: 10 · Página 1 de 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
  await api(`/beneficiarios/${target.id}`, 'GET', undefined, 404);
  await api('/beneficiarios', 'POST', cadastro('CPF Continua Reservado QA', bronze, target.cpf), 409);
  expect((await api('/beneficiarios')).total).toBe(10);
  expect(deletes).toEqual([`http://localhost:9999/beneficiarios/${target.id}`, `http://localhost:9999/beneficiarios/${target.id}`]);
});
