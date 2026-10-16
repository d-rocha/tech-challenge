import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE } from '../nucleo/api';
import { BeneficiarioServico } from './beneficiario-servico';

describe('BeneficiarioServico', () => {
  let servico: BeneficiarioServico;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: '/api' }] });
    servico = TestBed.inject(BeneficiarioServico);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('envia pagina e tamanho sem filtros ausentes e preserva envelope', () => {
    const resposta = { dados: [], pagina: 2, tamanho: 25, total: 51 };
    servico.listar({ pagina: 2, tamanho: 25 }).subscribe(valor => expect(valor).toEqual(resposta));
    const req = http.expectOne(r => r.url === '/api/beneficiarios');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().sort()).toEqual(['pagina', 'tamanho']);
    expect(req.request.params.get('pagina')).toBe('2');
    expect(req.request.params.get('tamanho')).toBe('25');
    req.flush(resposta);
  });
  it('combina filtros e omite strings vazias ao limpar', () => {
    servico.listar({ pagina: 1, tamanho: 10, status: 'INATIVO', plano_id: 'plano-a' }).subscribe();
    const req = http.expectOne(r => r.url === '/api/beneficiarios');
    expect(req.request.params.get('status')).toBe('INATIVO');
    expect(req.request.params.get('plano_id')).toBe('plano-a');
    req.flush({ dados: [], pagina: 1, tamanho: 10, total: 0 });
    servico.listar({ pagina: 1, tamanho: 10, plano_id: '' }).subscribe();
    const limpa = http.expectOne(r => r.url === '/api/beneficiarios');
    expect(limpa.request.params.has('status')).toBeFalse();
    expect(limpa.request.params.has('plano_id')).toBeFalse();
    limpa.flush({ dados: [], pagina: 1, tamanho: 10, total: 0 });
  });
  it('preserva erro HTTP estruturado para componente traduzir', () => {
    servico.listar({ pagina: 1, tamanho: 10 }).subscribe({ next: () => fail('esperava erro'), error: e => {
      expect(e.status).toBe(400); expect(e.error.mensagem).toBe('Filtro inválido');
    } });
    http.expectOne(r => r.url === '/api/beneficiarios').flush({ mensagem: 'Filtro inválido', detalhes: [] }, { status: 400, statusText: 'Erro' });
  });
  it('obtem detalhe por id sem depender do nome exclusivo da listagem', () => {
    const detalhe = { id: 'id-a', nome_completo: 'Pessoa', cpf: '52998224725', data_nascimento: '1990-12-23', status: 'ATIVO' as const, plano_id: 'plano-a', data_cadastro: '2026-01-01T00:00:00Z' };
    servico.obter('id-a').subscribe(valor => expect(valor).toEqual(detalhe));
    const req = http.expectOne('/api/beneficiarios/id-a'); expect(req.request.method).toBe('GET'); req.flush(detalhe);
  });
  it('envia contratos separados de criacao atualizacao e exclusao', () => {
    const cadastro = { nome_completo: 'Pessoa', cpf: '52998224725', data_nascimento: '1990-12-23', plano_id: 'plano-a' };
    servico.criar(cadastro).subscribe();
    const post = http.expectOne('/api/beneficiarios'); expect(post.request.method).toBe('POST'); expect(post.request.body).toEqual(cadastro); post.flush({ id: 'id-a', ...cadastro });
    const edicao = { nome_completo: 'Pessoa Editada', data_nascimento: '1990-12-23', plano_id: 'plano-a', status: 'INATIVO' as const };
    servico.atualizar('id-a', edicao).subscribe();
    const put = http.expectOne('/api/beneficiarios/id-a'); expect(put.request.method).toBe('PUT'); expect(put.request.body).toEqual(edicao); put.flush({ id: 'id-a', ...edicao });
    servico.excluir('id-a').subscribe(); const del = http.expectOne('/api/beneficiarios/id-a'); expect(del.request.method).toBe('DELETE'); del.flush(null, { status: 204, statusText: 'No Content' });
  });

});
