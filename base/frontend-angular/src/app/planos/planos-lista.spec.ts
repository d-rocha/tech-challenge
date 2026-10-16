import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE } from '../nucleo/api';
import { PlanosLista } from './planos-lista';

const bronze = { id: '1', nome: 'Bronze', codigo_registro_ans: '100001' };
const prata = { id: '2', nome: 'Prata', codigo_registro_ans: '100002' };

describe('PlanosLista', () => {
  let fixture: ComponentFixture<PlanosLista>;
  let http: HttpTestingController;
  const botao = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  const texto = () => fixture.nativeElement.textContent as string;
  const responder = (dados = [bronze]) => {
    const requisicao = http.expectOne('/api/planos');
    expect(requisicao.request.method).toBe('GET');
    requisicao.flush(dados);
    fixture.detectChanges();
  };
  const recarregar = () => { botao().click(); fixture.detectChanges(); };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PlanosLista],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: '/api' }]
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlanosLista);
    fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); http.verify(); });

  it('carrega inicialmente e libera o botão após mostrar os planos', () => {
    expect(botao().disabled).toBeTrue();
    expect(texto()).toContain('Carregando planos...');
    responder();
    expect(botao().disabled).toBeFalse();
    expect(texto()).toContain('Bronze');
    expect(texto()).not.toContain('Carregando planos...');
  });
  it('clique real após carga dispara novo GET e atualiza a tabela', () => {
    responder();
    recarregar();
    expect(botao().disabled).toBeTrue();
    expect(texto()).toContain('Carregando planos...');
    responder([prata]);
    expect(texto()).toContain('Prata');
    expect(texto()).not.toContain('Bronze');
    expect(botao().disabled).toBeFalse();
  });
  it('falha no reload mostra erro e permite nova tentativa com estado vazio', () => {
    responder();
    recarregar();
    http.expectOne('/api/planos').flush({ mensagem: 'Falha sintética', detalhes: [] }, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();
    expect(texto()).toContain('Falha sintética');
    expect(botao().disabled).toBeFalse();
    recarregar();
    expect(texto()).not.toContain('Falha sintética');
    expect(botao().disabled).toBeTrue();
    responder([]);
    expect(texto()).toContain('Nenhum plano cadastrado.');
    expect(botao().disabled).toBeFalse();
  });
  it('destruir durante carga inicial cancela a requisição', () => {
    const requisicao = http.expectOne('/api/planos');
    fixture.destroy();
    expect(requisicao.cancelled).toBeTrue();
  });
  it('destruir durante reload cancela a requisição posterior ao clique', () => {
    responder();
    recarregar();
    const requisicao = http.expectOne('/api/planos');
    fixture.destroy();
    expect(requisicao.cancelled).toBeTrue();
  });
});
