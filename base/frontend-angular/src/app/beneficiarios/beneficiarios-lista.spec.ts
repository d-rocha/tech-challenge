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
});
