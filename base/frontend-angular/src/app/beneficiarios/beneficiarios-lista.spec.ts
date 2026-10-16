import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE } from '../nucleo/api';
import { BeneficiariosLista } from './beneficiarios-lista';

const planos = [{ id: 'plano-a', nome: 'Bronze', codigo_registro_ans: '100001' }, { id: 'plano-b', nome: 'Prata', codigo_registro_ans: '100002' }];
const pessoa = (n: number, nomePlano = 'Bronze') => ({ id: String(n), nome_completo: `Pessoa ${n}`, cpf: '52998224725', data_nascimento: '1990-01-01',
  status: 'ATIVO', plano_id: 'plano-a', plano_nome: nomePlano, data_cadastro: '2026-01-01T00:00:00Z' });

describe('BeneficiariosLista', () => {
  let fixture: ComponentFixture<BeneficiariosLista>;
  let http: HttpTestingController;
  const texto = () => fixture.nativeElement.textContent as string;
  const botao = (nome: string) => Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
    .find(b => b.textContent?.trim() === nome)!;
  const clicar = (nome: string) => { botao(nome).click(); fixture.detectChanges(); };
  const selecionar = (id: string, valor: string) => {
    const el = fixture.nativeElement.querySelector('#' + id) as HTMLSelectElement;
    el.value = valor; el.dispatchEvent(new Event('change', { bubbles: true })); fixture.detectChanges();
  };
  const requisicao = () => http.expectOne(r => r.url === '/api/beneficiarios');
  const responder = (req: TestRequest, dados = [pessoa(1)], total = dados.length) => {
    req.flush({ dados, total, pagina: Number(req.request.params.get('pagina')), tamanho: Number(req.request.params.get('tamanho')) }); fixture.detectChanges();
  };
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BeneficiariosLista], providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: '/api' }] });
    http = TestBed.inject(HttpTestingController); fixture = TestBed.createComponent(BeneficiariosLista); fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); http.verify(); });
  const opcoes = () => { http.expectOne('/api/planos').flush(planos); fixture.detectChanges(); };

  it('carrega planos e pagina1/10 mostrando campos e nome historico', () => {
    expect(texto()).toContain('Carregando beneficiários...'); opcoes();
    const req = requisicao(); expect(req.request.params.get('pagina')).toBe('1'); expect(req.request.params.get('tamanho')).toBe('10');
    responder(req, [{ ...pessoa(1, 'Plano Histórico'), data_nascimento: '1990-12-23' }]);
    expect(texto()).toContain('Pessoa 1'); expect(texto()).toContain('52998224725'); expect(texto()).toContain('23/12/1990');
    expect(texto()).toContain('ATIVO'); expect(texto()).toContain('Plano Histórico'); expect(texto()).not.toContain('plano-a');
    expect(botao('Anterior').disabled).toBeTrue(); expect(botao('Próxima').disabled).toBeTrue();
  });
  it('navega entre tres paginas com total21 e usa os dados de cada resposta', () => {
    opcoes(); responder(requisicao(), Array.from({ length: 10 }, (_, i) => pessoa(i + 1)), 21);
    expect(botao('Próxima').disabled).toBeFalse(); clicar('Próxima');
    const segunda = requisicao(); expect(segunda.request.params.get('pagina')).toBe('2');
    responder(segunda, Array.from({ length: 10 }, (_, i) => pessoa(i + 11)), 21);
    expect(texto()).toContain('Pessoa 11'); expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(10);
    clicar('Próxima'); const terceira = requisicao(); expect(terceira.request.params.get('pagina')).toBe('3'); responder(terceira, [pessoa(21)], 21);
    expect(texto()).toContain('Pessoa 21'); expect(botao('Próxima').disabled).toBeTrue();
    clicar('Anterior'); const anterior = requisicao(); expect(anterior.request.params.get('pagina')).toBe('2'); responder(anterior, [pessoa(11)], 21);
  });
  it('recupera pagina fora do total apos recarga preservando filtros mesmo quando total zera', () => {
    opcoes(); responder(requisicao());
    selecionar('filtro-status', 'ATIVO'); responder(requisicao(), [pessoa(1)], 21);
    selecionar('filtro-plano', 'plano-a'); responder(requisicao(), [pessoa(1)], 21);
    clicar('Próxima'); responder(requisicao(), [pessoa(11)], 21);
    clicar('Próxima'); responder(requisicao(), [pessoa(21)], 21);
    clicar('Recarregar beneficiários'); responder(requisicao(), [], 9);
    const recuperada = requisicao();
    expect(recuperada.request.params.get('pagina')).toBe('1');
    expect(recuperada.request.params.get('status')).toBe('ATIVO');
    expect(recuperada.request.params.get('plano_id')).toBe('plano-a');
    expect(texto()).toContain('Carregando beneficiários...');
    responder(recuperada, [pessoa(1)], 9);
    expect(texto()).toContain('Página 1 de 1'); expect(texto()).toContain('Pessoa 1');
    clicar('Recarregar beneficiários'); responder(requisicao(), [], 0);
    http.expectNone(r => r.url === '/api/beneficiarios');
    expect(texto()).toContain('Nenhum beneficiário encontrado.');
    expect(botao('Anterior').disabled).toBeTrue(); expect(botao('Próxima').disabled).toBeTrue();
  });
  it('combina muda e limpa filtros sem destruir conjunto e reseta pagina', () => {
    opcoes(); responder(requisicao(), [pessoa(1)], 21); clicar('Próxima'); responder(requisicao(), [pessoa(11)], 21);
    selecionar('filtro-status', 'INATIVO'); const status = requisicao(); expect(status.request.params.get('pagina')).toBe('1'); expect(status.request.params.get('status')).toBe('INATIVO'); responder(status, [], 0);
    selecionar('filtro-plano', 'plano-b'); const ambos = requisicao(); expect(ambos.request.params.get('status')).toBe('INATIVO'); expect(ambos.request.params.get('plano_id')).toBe('plano-b'); responder(ambos, [], 0);
    selecionar('filtro-status', 'ATIVO'); const muda = requisicao(); expect(muda.request.params.get('status')).toBe('ATIVO'); expect(muda.request.params.get('plano_id')).toBe('plano-b'); responder(muda, [pessoa(2)], 1);
    clicar('Limpar filtros'); const limpa = requisicao(); expect(limpa.request.params.has('status')).toBeFalse(); expect(limpa.request.params.has('plano_id')).toBeFalse(); expect(limpa.request.params.get('pagina')).toBe('1'); responder(limpa, [pessoa(1)], 21);
    expect(texto()).toContain('Pessoa 1'); expect(texto()).toContain('21');
  });
  it('mudar tamanho volta para pagina1 com novos parametros', () => {
    opcoes(); responder(requisicao(), [pessoa(1)], 40); clicar('Próxima'); responder(requisicao(), [pessoa(11)], 40);
    selecionar('tamanho-pagina', '25'); const req = requisicao(); expect(req.request.params.get('pagina')).toBe('1'); expect(req.request.params.get('tamanho')).toBe('25'); responder(req, [pessoa(1)], 40);
  });
  it('cancela resposta anterior quando filtro muda durante pending', () => {
    opcoes(); const antiga = requisicao(); selecionar('filtro-status', 'ATIVO'); const atual = requisicao();
    expect(antiga.cancelled).toBeTrue(); expect(texto()).toContain('Carregando beneficiários...');
    selecionar('filtro-status', 'INATIVO'); const ultima = requisicao(); expect(atual.cancelled).toBeTrue();
    responder(ultima, [{ ...pessoa(9), status: 'INATIVO' }]); expect(texto()).toContain('Pessoa 9'); expect(texto()).not.toContain('Carregando beneficiários...');
  });
  it('erro estruturado e retry preservam criterios e recuperam fluxo', () => {
    opcoes(); responder(requisicao()); selecionar('filtro-status', 'INATIVO');
    requisicao().flush({ mensagem: 'Filtro recusado', detalhes: [{ campo: 'status', regra: 'invalido' }] }, { status: 400, statusText: 'Erro' }); fixture.detectChanges();
    expect(texto()).toContain('Filtro recusado'); expect(texto()).toContain('status (invalido)');
    clicar('Recarregar beneficiários'); const req = requisicao(); expect(req.request.params.get('status')).toBe('INATIVO');
    responder(req, [], 0); expect(texto()).toContain('Nenhum beneficiário encontrado.'); expect(texto()).not.toContain('Filtro recusado');
    selecionar('filtro-status', 'ATIVO'); responder(requisicao()); expect(texto()).toContain('Pessoa 1');
  });
  it('falha nas opcoes nao impede leitura e permite recarregar planos', () => {
    http.expectOne('/api/planos').flush({ mensagem: 'Planos indisponíveis', detalhes: [] }, { status: 500, statusText: 'Erro' }); fixture.detectChanges();
    responder(requisicao(), [pessoa(1, 'Plano Histórico')]); expect(texto()).toContain('Planos indisponíveis'); expect(texto()).toContain('Plano Histórico');
    clicar('Recarregar planos do filtro'); opcoes(); expect(texto()).not.toContain('Planos indisponíveis');
  });
  it('destroy cancela requisicoes de dados e opcoes pendentes', () => {
    const p = http.expectOne('/api/planos'); const b = requisicao(); fixture.destroy(); expect(p.cancelled).toBeTrue(); expect(b.cancelled).toBeTrue();
  });
  const acao = (nome: string) => {
    const b = fixture.nativeElement.querySelector(`button[aria-label="${nome}"]`) as HTMLButtonElement;
    expect(b).not.toBeNull(); b.click(); fixture.detectChanges();
  };
  const detalheServidor = { id: '1', nome_completo: 'Pessoa Persistida', cpf: '52998224725', data_nascimento: '1985-06-24', status: 'ATIVO', plano_id: 'plano-a', data_cadastro: '2026-01-01T00:00:00Z' };
  const preencherFormulario = (label: string, valor: string) => {
    const form = fixture.nativeElement.querySelector('app-beneficiario-formulario') as HTMLElement;
    const l = Array.from(form.querySelectorAll('label')).find(el => el.textContent?.trim() === label)!;
    const el = form.querySelector('#' + l.htmlFor) as HTMLInputElement;
    el.value = valor; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); fixture.detectChanges();
  };
  const submeter = () => { fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); fixture.detectChanges(); };
  it('edicao le detalhe fresco e reabre dados persistidos apos PUT e refresh', () => {
    opcoes(); responder(requisicao()); acao('Editar Pessoa 1');
    const detalhe = http.expectOne('/api/beneficiarios/1'); expect(detalhe.request.method).toBe('GET'); detalhe.flush(detalheServidor); fixture.detectChanges(); opcoes();
    expect((fixture.nativeElement.querySelector('app-beneficiario-formulario input') as HTMLInputElement).value).toBe('Pessoa Persistida');
    preencherFormulario('Nome completo', 'Nome Atualizado'); submeter();
    const put = http.expectOne('/api/beneficiarios/1'); expect(put.request.method).toBe('PUT'); expect(put.request.body.nome_completo).toBe('Nome Atualizado'); put.flush({ ...detalheServidor, nome_completo: 'Nome Atualizado' }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-beneficiario-formulario')).toBeNull();
    responder(requisicao(), [{ ...pessoa(1), nome_completo: 'Nome Atualizado' }]); acao('Editar Nome Atualizado');
    http.expectOne('/api/beneficiarios/1').flush({ ...detalheServidor, nome_completo: 'Nome Atualizado' }); fixture.detectChanges(); opcoes();
    expect((fixture.nativeElement.querySelector('app-beneficiario-formulario input') as HTMLInputElement).value).toBe('Nome Atualizado');
  });
  it('cadastro bem sucedido limpa filtros e recarrega pagina1', () => {
    opcoes(); responder(requisicao()); selecionar('filtro-status', 'INATIVO'); responder(requisicao(), [], 0);
    clicar('Novo beneficiário'); opcoes(); preencherFormulario('Nome completo', 'Pessoa Nova'); preencherFormulario('CPF', '52998224725'); preencherFormulario('Data de nascimento', '1990-12-23'); preencherFormulario('Plano do beneficiário', 'plano-a');
    submeter(); http.expectOne('/api/beneficiarios').flush(detalheServidor, { status: 201, statusText: 'Created' }); fixture.detectChanges();
    const lista = requisicao(); expect(lista.request.params.get('pagina')).toBe('1'); expect(lista.request.params.has('status')).toBeFalse(); responder(lista, [{ ...pessoa(1), nome_completo: 'Pessoa Nova' }]); expect(texto()).toContain('Pessoa Nova');
  });
  it('cancelar exclusao nao envia DELETE e falha mantem linha ate204', () => {
    opcoes(); responder(requisicao()); acao('Excluir Pessoa 1'); clicar('Cancelar exclusão'); http.expectNone('/api/beneficiarios/1');
    acao('Excluir Pessoa 1'); clicar('Confirmar exclusão'); const del = http.expectOne('/api/beneficiarios/1'); expect(del.request.method).toBe('DELETE'); expect(texto()).toContain('Pessoa 1');
    del.flush({ mensagem: 'Exclusão recusada', detalhes: [] }, { status: 500, statusText: 'Erro' }); fixture.detectChanges(); expect(texto()).toContain('Pessoa 1'); expect(texto()).toContain('Exclusão recusada');
    clicar('Confirmar exclusão'); http.expectOne('/api/beneficiarios/1').flush(null, { status: 204, statusText: 'No Content' }); fixture.detectChanges(); responder(requisicao(), [], 0); expect(texto()).toContain('Nenhum beneficiário encontrado.');
  });
  it('excluir ultimo item da ultima pagina refaz pagina valida preservando criterios', () => {
    opcoes(); responder(requisicao(), [pessoa(1)], 11); selecionar('filtro-status', 'ATIVO'); responder(requisicao(), [pessoa(1)], 11);
    clicar('Próxima'); responder(requisicao(), [pessoa(11)], 11); acao('Excluir Pessoa 11'); clicar('Confirmar exclusão'); http.expectOne('/api/beneficiarios/11').flush(null, { status: 204, statusText: 'No Content' }); fixture.detectChanges();
    const atual = requisicao(); expect(atual.request.params.get('pagina')).toBe('2'); responder(atual, [], 10);
    const volta = requisicao(); expect(volta.request.params.get('pagina')).toBe('1'); expect(volta.request.params.get('status')).toBe('ATIVO'); responder(volta, [pessoa(1)], 10); expect(texto()).toContain('Página 1 de 1');
  });
  it('detalhe404 avisa sem abrir formulario e permite nova tentativa', () => {
    opcoes(); responder(requisicao()); acao('Editar Pessoa 1'); http.expectOne('/api/beneficiarios/1').flush({ mensagem: 'Não encontrado', detalhes: [] }, { status: 404, statusText: 'Not Found' }); fixture.detectChanges();
    expect(texto()).toContain('Não encontrado'); expect(fixture.nativeElement.querySelector('form')).toBeNull(); acao('Editar Pessoa 1'); http.expectOne('/api/beneficiarios/1').flush(detalheServidor); fixture.detectChanges(); opcoes(); expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('mudanca concorrente de plano atualiza linha antes de reutilizar nome historico', () => {
    opcoes(); responder(requisicao(), [pessoa(1, 'Plano Antigo')]); acao('Editar Pessoa 1');
    const fresco = { ...detalheServidor, plano_id: 'plano-removido' };
    http.expectOne('/api/beneficiarios/1').flush(fresco); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    responder(requisicao(), [{ ...pessoa(1, 'Plano Histórico Correto'), plano_id: 'plano-removido' }]);
    acao('Editar Pessoa 1'); http.expectOne('/api/beneficiarios/1').flush(fresco); fixture.detectChanges(); opcoes();
    const form = fixture.nativeElement.querySelector('app-beneficiario-formulario') as HTMLElement;
    expect(form.textContent).toContain('Plano Histórico Correto'); expect(form.textContent).not.toContain('Plano Antigo');
    expect((form.querySelector('#beneficiario-plano') as HTMLSelectElement).value).toBe('plano-removido');
  });

  it('detalhe pendente impede operacao concorrente e cancela no destroy', () => {
    opcoes(); responder(requisicao()); acao('Editar Pessoa 1'); const req = http.expectOne('/api/beneficiarios/1');
    acao('Editar Pessoa 1'); http.expectNone('/api/beneficiarios/1'); expect(botao('Novo beneficiário').disabled).toBeTrue();
    fixture.destroy(); expect(req.cancelled).toBeTrue();
  });
  it('DELETE pendente bloqueia confirmacao duplicada e cancela no destroy', () => {
    opcoes(); responder(requisicao()); acao('Excluir Pessoa 1'); clicar('Confirmar exclusão'); const req = http.expectOne('/api/beneficiarios/1');
    clicar('Confirmar exclusão'); http.expectNone('/api/beneficiarios/1'); expect(botao('Cancelar exclusão').disabled).toBeTrue(); expect(texto()).toContain('Pessoa 1');
    fixture.destroy(); expect(req.cancelled).toBeTrue();
  });

});
