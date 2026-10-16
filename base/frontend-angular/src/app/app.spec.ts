import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE } from './nucleo/api';
import { App } from './app';

describe('App', () => {
  it('integra lista de beneficiarios mantendo Planos e removendo placeholder', () => {
    TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: '/api' }] });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const opcoes = http.match('/api/planos');
    expect(opcoes.length).toBeGreaterThan(0);
    opcoes.forEach(req => req.flush([{ id: 'a', nome: 'Bronze', codigo_registro_ans: '100001' }]));
    http.expectOne(r => r.url === '/api/beneficiarios').flush({ dados: [], pagina: 1, tamanho: 10, total: 0 });
    fixture.detectChanges();
    const titulos = Array.from(fixture.nativeElement.querySelectorAll('h2') as NodeListOf<HTMLElement>).map(el => el.textContent?.trim());
    expect(titulos).toContain('Planos');
    expect(titulos).toContain('Beneficiários');
    expect(fixture.nativeElement.textContent).toContain('Nenhum beneficiário encontrado.');
    expect(fixture.nativeElement.textContent).not.toContain('Esta é a parte que falta.');
    fixture.destroy();
    http.verify();
  });
});
