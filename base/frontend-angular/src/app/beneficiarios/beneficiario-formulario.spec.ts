import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgControl } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { API_BASE } from '../nucleo/api';
import { BeneficiarioFormulario } from './beneficiario-formulario';

describe('BeneficiarioFormulario', () => {
  let fixture: ComponentFixture<BeneficiarioFormulario>;
  let http: HttpTestingController;
  const planos = [{ id: 'plano-a', nome: 'Bronze', codigo_registro_ans: '100001' }];
  const detalhe = { id: 'pessoa-a', nome_completo: 'Pessoa Servidor', cpf: '52998224725', data_nascimento: '1990-12-23', status: 'ATIVO' as const, plano_id: 'plano-a', data_cadastro: '2026-01-01T00:00:00Z' };
  const texto = () => fixture.nativeElement.textContent as string;
  const campo = (label: string): HTMLInputElement | HTMLSelectElement => {
    const el = Array.from(fixture.nativeElement.querySelectorAll('label') as NodeListOf<HTMLLabelElement>).find(l => l.textContent?.trim() === label)!;
    return fixture.nativeElement.querySelector('#' + el.htmlFor);
  };
  const preencher = (label: string, valor: string) => {
    const el = campo(label); el.value = valor; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); fixture.detectChanges();
  };
  const botao = (nome: string) => Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b => b.textContent?.trim() === nome)!;
  const salvar = () => { fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); fixture.detectChanges(); };
  const abrir = (registro: (Omit<typeof detalhe, 'status'> & { status: 'ATIVO' | 'INATIVO' }) | null = null) => {
    fixture = TestBed.createComponent(BeneficiarioFormulario);
    fixture.componentRef.setInput('beneficiario', registro); fixture.componentRef.setInput('nomePlano', 'Plano Histórico'); fixture.detectChanges();
  };
  const opcoes = () => { http.expectOne('/api/planos').flush(planos); fixture.detectChanges(); };
  const valido = () => {
    preencher('Nome completo', 'Pessoa Nova'); preencher('CPF', '52998224725'); preencher('Data de nascimento', '1990-12-23'); preencher('Plano do beneficiário', 'plano-a');
  };
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BeneficiarioFormulario], providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: '/api' }] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { fixture.destroy(); http.verify(); });

  it('valida obrigatorios CPF e data UTC antes de enviar', () => {
    abrir(); opcoes(); salvar(); expect(texto()).toMatch(/obrigat|informe/i);
    http.expectNone(r => r.url === '/api/beneficiarios');
    valido(); preencher('CPF', '529.982.24'); salvar(); expect(texto()).toMatch(/11|dígitos/);
    http.expectNone(r => r.url === '/api/beneficiarios');
    preencher('CPF', '52998224725'); preencher('Data de nascimento', new Date().toISOString().slice(0, 10)); salvar(); expect(texto()).toMatch(/passado|anterior/);
    http.expectNone(r => r.url === '/api/beneficiarios');
    preencher('Data de nascimento', '2999-12-23'); salvar(); http.expectNone(r => r.url === '/api/beneficiarios');
    preencher('Data de nascimento', '1990-12-23'); preencher('Nome completo', '   '); salvar(); http.expectNone(r => r.url === '/api/beneficiarios');
  });
  it('POST envia so quatro campos impede duplicacao e emite sucesso apos resposta', () => {
    abrir(); opcoes(); valido(); const sucesso = jasmine.createSpy(); fixture.componentInstance.salvo.subscribe(sucesso);
    salvar(); const req = http.expectOne('/api/beneficiarios'); expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ nome_completo: 'Pessoa Nova', cpf: '52998224725', data_nascimento: '1990-12-23', plano_id: 'plano-a' });
    expect(botao('Salvar').disabled).toBeTrue(); expect(botao('Cancelar').disabled).toBeTrue(); expect(sucesso).not.toHaveBeenCalled();
    salvar(); http.expectNone(r => r.url === '/api/beneficiarios');
    req.flush({ ...detalhe, nome_completo: 'Pessoa Nova' }, { status: 201, statusText: 'Created' }); fixture.detectChanges(); expect(sucesso).toHaveBeenCalledTimes(1);
  });
  for (const status of [400, 409, 422]) {
    it(`mantem valores e detalhamento apos ${status} permitindo retry`, () => {
      abrir(); opcoes(); valido(); salvar();
      http.expectOne('/api/beneficiarios').flush({ mensagem: 'Cadastro recusado', detalhes: [{ campo: status === 422 ? 'plano_id' : 'cpf', regra: 'recusado' }] }, { status, statusText: 'Erro' }); fixture.detectChanges();
      expect(texto()).toContain('Cadastro recusado'); expect(texto()).toContain('recusado'); expect(campo('Nome completo').value).toBe('Pessoa Nova'); expect(campo('CPF').value).toBe('529.982.247-25'); expect(botao('Salvar').disabled).toBeFalse();
      salvar(); http.expectOne('/api/beneficiarios').flush(detalhe); fixture.detectChanges();
    });
  }
  it('PUT preserva CPF read-only e envia apenas campos permitidos', () => {
    abrir(detalhe); opcoes(); expect((campo('CPF') as HTMLInputElement).readOnly).toBeTrue();
    preencher('Nome completo', 'Pessoa Editada'); preencher('Situação do beneficiário', 'INATIVO'); salvar();
    const req = http.expectOne('/api/beneficiarios/pessoa-a'); expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ nome_completo: 'Pessoa Editada', data_nascimento: '1990-12-23', plano_id: 'plano-a', status: 'INATIVO' }); req.flush(detalhe);
  });
  it('reativa inativo sem destravar cadastro antes da persistencia', () => {
    abrir({ ...detalhe, status: 'INATIVO' }); opcoes();
    for (const label of ['Nome completo', 'Data de nascimento', 'Plano do beneficiário']) expect(campo(label).disabled || (campo(label) as HTMLInputElement).readOnly).toBeTrue();
    preencher('Situação do beneficiário', 'ATIVO');
    expect(campo('Nome completo').disabled || (campo('Nome completo') as HTMLInputElement).readOnly).toBeTrue(); salvar();
    const req = http.expectOne('/api/beneficiarios/pessoa-a'); expect(req.request.body).toEqual({ nome_completo: detalhe.nome_completo, data_nascimento: detalhe.data_nascimento, plano_id: 'plano-a', status: 'ATIVO' }); req.flush(detalhe);
  });
  it('plano removido preserva vinculo historico e explica bloqueio do inativo', () => {
    abrir({ ...detalhe, status: 'INATIVO', plano_id: 'removido' }); opcoes();
    expect(texto()).toContain('Plano Histórico'); expect(texto()).toMatch(/reativa|excluído|indisponível/i); expect(campo('Plano do beneficiário').value).toBe('removido');
    preencher('Situação do beneficiário', 'ATIVO'); salvar();
    http.expectOne('/api/beneficiarios/pessoa-a').flush({ mensagem: 'Plano excluído', detalhes: [{ campo: 'plano_id', regra: 'nao_encontrado' }] }, { status: 422, statusText: 'Erro' }); fixture.detectChanges(); expect(texto()).toContain('Plano excluído');
  });
  it('falha de planos permite retry e cancelamento nao grava', () => {
    abrir(); http.expectOne('/api/planos').flush({ mensagem: 'Sem planos', detalhes: [] }, { status: 500, statusText: 'Erro' }); fixture.detectChanges(); expect(texto()).toContain('Sem planos');
    botao('Recarregar planos do formulário').click(); fixture.detectChanges(); opcoes();
    const cancelou = jasmine.createSpy(); fixture.componentInstance.cancelado.subscribe(cancelou); botao('Cancelar').click(); expect(cancelou).toHaveBeenCalledTimes(1); http.expectNone(r => r.url === '/api/beneficiarios');
  });
  it('destroy cancela gravacao pendente', () => {
    abrir(); opcoes(); valido(); salvar(); const req = http.expectOne('/api/beneficiarios'); fixture.destroy(); expect(req.cancelled).toBeTrue();
  });
  it('plano historico de ativo aceita substituicao explicita e PUT422 conserva valores', () => {
    abrir({ ...detalhe, plano_id: 'removido' }); opcoes();
    expect(texto()).toContain('Plano Histórico'); preencher('Plano do beneficiário', 'plano-a'); preencher('Nome completo', 'Nome mantido'); salvar();
    const req = http.expectOne('/api/beneficiarios/pessoa-a'); expect(req.request.body.plano_id).toBe('plano-a');
    req.flush({ mensagem: 'Plano removido durante edição', detalhes: [{ campo: 'plano_id', regra: 'nao_encontrado' }] }, { status: 422, statusText: 'Erro' }); fixture.detectChanges();
    expect(campo('Nome completo').value).toBe('Nome mantido'); expect(campo('Plano do beneficiário').value).toBe('plano-a'); expect(texto()).toContain('Plano removido durante edição'); expect((campo('CPF') as HTMLInputElement).readOnly).toBeTrue();
  });
  it('destroy cancela carga de planos pendente', () => {
    abrir(); const req = http.expectOne('/api/planos'); fixture.destroy(); expect(req.cancelled).toBeTrue();
  });

  it('mascara CPF misto e limita onze digitos sem alterar payload bruto', () => {
    abrir(); opcoes(); valido();
    preencher('CPF', 'ab529.982.247-25xyz999');
    expect(campo('CPF').value).toBe('529.982.247-25');
    expect(campo('CPF').getAttribute('placeholder')).toBe('000.000.000-00');
    salvar(); const req = http.expectOne('/api/beneficiarios');
    expect(req.request.body.cpf).toBe('52998224725'); req.flush(detalhe);
  });
  it('formata CPF programatico preservando readonly e estado disabled durante save', () => {
    abrir(detalhe); opcoes();
    expect(campo('CPF').value).toBe('529.982.247-25');
    expect((campo('CPF') as HTMLInputElement).readOnly).toBeTrue();
    salvar(); expect(campo('CPF').disabled).toBeTrue();
    http.expectOne('/api/beneficiarios/pessoa-a').flush(detalhe);
  });
  it('preserva caret apos edicao no meio e remove digito ao apagar separador', () => {
    abrir(); opcoes(); preencher('CPF', '52998224725');
    const input = campo('CPF') as HTMLInputElement;
    input.value = '529.1982.247-25'; input.setSelectionRange(5, 5);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '1' }));
    expect(input.value).toBe('529.198.224-72'); expect(input.selectionStart).toBe(5);
    preencher('CPF', '52998224725'); input.setSelectionRange(4, 4);
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
    expect(input.value).toBe('529.822.472-5'); expect(input.selectionStart).toBe(2);
    preencher('CPF', '52998224725'); input.setSelectionRange(3, 3);
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentForward' }));
    expect(input.value).toBe('529.822.472-5'); expect(input.selectionStart).toBe(3);
  });
  for (const beforeinput of [false, true]) {
    for (const inputType of ['deleteContentBackward', 'deleteContentForward']) {
      it(`apaga digito adjacente ao separador com ${inputType}, beforeinput nao cancelavel: ${beforeinput}`, () => {
        abrir(); opcoes(); preencher('CPF', '52998224725');
        const input = campo('CPF') as HTMLInputElement;
        const retroceder = inputType === 'deleteContentBackward';
        input.setSelectionRange(retroceder ? 4 : 3, retroceder ? 4 : 3);
        if (beforeinput) {
          input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: false, inputType }));
          expect(input.value).toBe('529.982.247-25');
        }
        input.value = '529982.247-25'; input.setSelectionRange(3, 3);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
        expect(input.value).toBe('529.822.472-5'); expect(input.selectionStart).toBe(retroceder ? 2 : 3);
        // A duplicate input notification must not delete another digit.
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
        expect(input.value).toBe('529.822.472-5');
      });
    }
  }
  it('nao duplica exclusao de digito ja removido nativamente', () => {
    abrir(); opcoes(); preencher('CPF', '52998224725');
    const input = campo('CPF') as HTMLInputElement;
    input.value = '529.82.247-25'; input.setSelectionRange(4, 4);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentForward' }));
    expect(input.value).toBe('529.822.472-5'); expect(input.selectionStart).toBe(3);
  });
  it('substitui selecao incluindo separador e preserva valor bruto', () => {
    abrir(); opcoes(); valido(); const input = campo('CPF') as HTMLInputElement;
    input.value = '123982.247-25'; input.setSelectionRange(3, 3);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '123' }));
    expect(input.value).toBe('123.982.247-25'); expect(input.selectionStart).toBe(3);
    salvar(); const req = http.expectOne('/api/beneficiarios');
    expect(req.request.body.cpf).toBe('12398224725'); req.flush(detalhe);
  });
  it('aguarda composicao e mantem touched coerente', () => {
    abrir(); opcoes(); const input = campo('CPF') as HTMLInputElement;
    const controle = fixture.debugElement.query(By.css('#beneficiario-cpf')).injector.get(NgControl).control!;
    const alteracao = jasmine.createSpy('alteracao'); controle.valueChanges.subscribe(alteracao);
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'a52998224725'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('a52998224725');
    expect(controle.value).toBe(''); expect(alteracao).not.toHaveBeenCalled();
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(input.value).toBe('529.982.247-25');
    expect(controle.value).toBe('52998224725'); expect(alteracao).toHaveBeenCalledOnceWith('52998224725');
    preencher('CPF', '12'); input.dispatchEvent(new Event('blur')); fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
  for (const nome of ['  José da Silva  ', 'Jose\u0301 da Silva', '李 小龍', 'أحمد علي', "Anne O’Neill-Sá Jr.", "D'Ávila", 'Ana', 'A'.repeat(120), '\u{10400}'.repeat(60)]) {
    it(`aceita nome pessoal Unicode e limites: ${nome.slice(0, 20)}`, () => {
      abrir(); opcoes(); valido(); preencher('Nome completo', nome); salvar();
      const req = http.expectOne('/api/beneficiarios'); expect(req.request.body.nome_completo).toBe(nome.trim()); req.flush(detalhe);
    });
  }
  for (const nome of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'onerror=alert(1)', 'javascript:alert(1)', 'expression(alert(1))', 'Ana 123', 'AB', 'A'.repeat(121), '\u{10400}'.repeat(61), '   ']) {
    it(`recusa nome invalido sem apagar entrada ou enviar: ${nome.slice(0, 20)}`, () => {
      abrir(); opcoes(); valido(); preencher('Nome completo', nome); salvar();
      http.expectNone(r => r.url.includes('/beneficiarios'));
      expect(campo('Nome completo').value).toBe(nome);
      expect(campo('Nome completo').getAttribute('aria-invalid')).toBe('true');
      expect(fixture.nativeElement.querySelector('#erro-nome').textContent).toMatch(/obrigatório|3 a 120|letras/);
    });
  }
  it('recusa nome invalido tambem antes de PUT', () => {
    abrir(detalhe); opcoes(); preencher('Nome completo', '<script>'); salvar();
    http.expectNone('/api/beneficiarios/pessoa-a');
  });

});
