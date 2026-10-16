import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, startWith, switchMap, tap } from 'rxjs';

import { mensagemDeErro } from '../nucleo/api';
import { Plano } from '../planos/plano';
import { PlanoServico } from '../planos/plano-servico';
import { Beneficiario, ConsultaBeneficiarios } from './beneficiario';
import { BeneficiarioServico } from './beneficiario-servico';

@Component({
  selector: 'app-beneficiarios-lista',
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
    const status = valor === 'ATIVO' || valor === 'INATIVO' ? valor : undefined;
    this.buscar({ ...this.consulta(), status, pagina: 1 });
  }

  protected filtrarPlano(plano_id: string): void {
    this.buscar({ ...this.consulta(), plano_id: plano_id || undefined, pagina: 1 });
  }

  protected mudarTamanho(valor: string): void {
    const tamanho = Number(valor);
    if ([10, 25, 50, 100].includes(tamanho)) {
      this.buscar({ ...this.consulta(), tamanho, pagina: 1 });
    }
  }

  protected limparFiltros(): void {
    this.buscar({ pagina: 1, tamanho: this.consulta().tamanho });
  }

  protected navegar(deslocamento: number): void {
    const pagina = this.consulta().pagina + deslocamento;
    if (!this.carregando() && !this.erro() && pagina >= 1 && pagina <= this.totalPaginas()) {
      this.buscar({ ...this.consulta(), pagina });
    }
  }

  protected recarregar(): void {
    this.buscar(this.consulta());
  }

  protected recarregarPlanos(): void {
    this.recargasPlanos.next();
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
