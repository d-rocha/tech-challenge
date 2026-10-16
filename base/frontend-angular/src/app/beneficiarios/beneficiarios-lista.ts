import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, startWith, switchMap, tap } from 'rxjs';

import { mensagemDeErro } from '../nucleo/api';
import { Plano } from '../planos/plano';
import { PlanoServico } from '../planos/plano-servico';
import { Beneficiario, BeneficiarioDetalhe, ConsultaBeneficiarios } from './beneficiario';
import { BeneficiarioFormulario } from './beneficiario-formulario';
import { BeneficiarioServico } from './beneficiario-servico';

@Component({
  selector: 'app-beneficiarios-lista',
  imports: [BeneficiarioFormulario],
  templateUrl: './beneficiarios-lista.html',
  styleUrl: './beneficiarios-lista.css'
})
export class BeneficiariosLista {
  private readonly servico = inject(BeneficiarioServico);
  private readonly planoServico = inject(PlanoServico);
  private readonly destroyRef = inject(DestroyRef);
  private readonly consultas = new Subject<ConsultaBeneficiarios>();
  private readonly recargasPlanos = new Subject<void>();

  protected readonly consulta = signal<ConsultaBeneficiarios>({ pagina: 1, tamanho: 10 });
  protected readonly beneficiarios = signal<Beneficiario[]>([]);
  protected readonly total = signal(0);
  protected readonly carregando = signal(true);
  protected readonly erro = signal<string | null>(null);
  protected readonly planos = signal<Plano[]>([]);
  protected readonly carregandoPlanos = signal(true);
  protected readonly erroPlanos = signal<string | null>(null);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.consulta().tamanho))
  );

  protected readonly formularioAberto = signal(false);
  protected readonly detalhe = signal<BeneficiarioDetalhe | null>(null);
  protected readonly nomePlanoEdicao = signal('');
  protected readonly carregandoDetalhe = signal(false);
  protected readonly erroOperacao = signal<string | null>(null);
  protected readonly exclusao = signal<Beneficiario | null>(null);
  protected readonly excluindo = signal(false);
  protected readonly operacaoAtiva = computed(() =>
    this.formularioAberto() || this.carregandoDetalhe() || !!this.exclusao()
  );

  constructor() {
    this.consultas.pipe(
      startWith(this.consulta()),
      switchMap((consulta) => {
        this.carregando.set(true);
        this.erro.set(null);
        return this.servico.listar(consulta).pipe(
          catchError((resposta: HttpErrorResponse) => {
            this.erro.set(mensagemDeErro(resposta));
            this.carregando.set(false);
            return EMPTY;
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((pagina) => {
      const ultimaPagina = Math.max(1, Math.ceil(pagina.total / pagina.tamanho));
      if (pagina.pagina > ultimaPagina) {
        this.buscar({ ...this.consulta(), pagina: ultimaPagina, tamanho: pagina.tamanho });
        return;
      }
      this.beneficiarios.set(pagina.dados);
      this.total.set(pagina.total);
      this.consulta.update((consulta) => ({
        ...consulta, pagina: pagina.pagina, tamanho: pagina.tamanho
      }));
      this.carregando.set(false);
    });

    this.recargasPlanos.pipe(
      startWith(undefined),
      tap(() => {
        this.carregandoPlanos.set(true);
        this.erroPlanos.set(null);
      }),
      switchMap(() => this.planoServico.listar().pipe(
        catchError((resposta: HttpErrorResponse) => {
          this.erroPlanos.set(mensagemDeErro(resposta));
          this.carregandoPlanos.set(false);
          return EMPTY;
        })
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((planos) => {
      this.planos.set(planos);
      this.carregandoPlanos.set(false);
    });
  }

  protected filtrarStatus(valor: string): void {
    if (this.operacaoAtiva()) return;
    const status = valor === 'ATIVO' || valor === 'INATIVO' ? valor : undefined;
    this.buscar({ ...this.consulta(), status, pagina: 1 });
  }

  protected filtrarPlano(plano_id: string): void {
    if (this.operacaoAtiva()) return;
    this.buscar({ ...this.consulta(), plano_id: plano_id || undefined, pagina: 1 });
  }

  protected mudarTamanho(valor: string): void {
    if (this.operacaoAtiva()) return;
    const tamanho = Number(valor);
    if ([10, 25, 50, 100].includes(tamanho)) {
      this.buscar({ ...this.consulta(), tamanho, pagina: 1 });
    }
  }

  protected limparFiltros(): void {
    if (this.operacaoAtiva()) return;
    this.buscar({ pagina: 1, tamanho: this.consulta().tamanho });
  }

  protected navegar(deslocamento: number): void {
    if (this.operacaoAtiva()) return;
    const pagina = this.consulta().pagina + deslocamento;
    if (!this.carregando() && !this.erro() && pagina >= 1 && pagina <= this.totalPaginas()) {
      this.buscar({ ...this.consulta(), pagina });
    }
  }

  protected recarregar(): void {
    if (this.operacaoAtiva()) return;
    this.buscar(this.consulta());
  }

  protected recarregarPlanos(): void {
    this.recargasPlanos.next();
  }

  protected novo(): void {
    if (this.operacaoAtiva() || this.carregando()) return;
    this.erroOperacao.set(null);
    this.detalhe.set(null);
    this.nomePlanoEdicao.set('');
    this.formularioAberto.set(true);
  }

  protected editar(beneficiario: Beneficiario): void {
    if (this.operacaoAtiva() || this.carregando()) return;
    this.erroOperacao.set(null);
    this.carregandoDetalhe.set(true);
    this.servico.obter(beneficiario.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: detalhe => {
        if (detalhe.plano_id !== beneficiario.plano_id) {
          this.carregandoDetalhe.set(false);
          this.erroOperacao.set('O plano deste beneficiário mudou. A lista está sendo atualizada; abra a edição novamente.');
          this.buscar(this.consulta());
          return;
        }
        this.detalhe.set(detalhe);
        this.nomePlanoEdicao.set(beneficiario.plano_nome);
        this.carregandoDetalhe.set(false);
        this.formularioAberto.set(true);
      },
      error: (resposta: HttpErrorResponse) => {
        this.erroOperacao.set(mensagemDeErro(resposta));
        this.carregandoDetalhe.set(false);
      }
    });
  }

  protected cancelarFormulario(): void {
    this.formularioAberto.set(false);
    this.detalhe.set(null);
  }

  protected salvo(): void {
    const criacao = this.detalhe() === null;
    this.cancelarFormulario();
    this.buscar(criacao ? { pagina: 1, tamanho: this.consulta().tamanho } : this.consulta());
  }

  protected solicitarExclusao(beneficiario: Beneficiario): void {
    if (this.operacaoAtiva() || this.carregando()) return;
    this.erroOperacao.set(null);
    this.exclusao.set(beneficiario);
  }

  protected cancelarExclusao(): void {
    if (this.excluindo()) return;
    this.exclusao.set(null);
    this.erroOperacao.set(null);
  }

  protected confirmarExclusao(): void {
    const beneficiario = this.exclusao();
    if (!beneficiario || this.excluindo()) return;
    this.excluindo.set(true);
    this.erroOperacao.set(null);
    this.servico.excluir(beneficiario.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.excluindo.set(false);
        this.exclusao.set(null);
        this.buscar(this.consulta());
      },
      error: (resposta: HttpErrorResponse) => {
        this.excluindo.set(false);
        this.erroOperacao.set(mensagemDeErro(resposta));
      }
    });
  }

  protected formatarNascimento(data: string): string {
    const [ano, mes, dia] = data.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  private buscar(consulta: ConsultaBeneficiarios): void {
    this.consulta.set(consulta);
    this.consultas.next(consulta);
  }
}
