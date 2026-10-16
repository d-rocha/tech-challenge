import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';

import { mensagemDeErro } from '../nucleo/api';
import { Plano } from '../planos/plano';
import { PlanoServico } from '../planos/plano-servico';
import { BeneficiarioDetalhe } from './beneficiario';
import { BeneficiarioServico } from './beneficiario-servico';

function nomeObrigatorio(controle: AbstractControl<string>): ValidationErrors | null {
  return controle.value.trim() ? null : { required: true };
}

function nascimentoPassado(controle: AbstractControl<string>): ValidationErrors | null {
  const valor = controle.value;
  if (!valor) return null;
  const data = new Date(`${valor}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && Number.isFinite(data.getTime()) &&
    data.toISOString().slice(0, 10) === valor && valor < new Date().toISOString().slice(0, 10)
    ? null : { passado: true };
}

@Component({
  selector: 'app-beneficiario-formulario',
  imports: [ReactiveFormsModule],
  templateUrl: './beneficiario-formulario.html',
  styleUrl: './beneficiario-formulario.css'
})
export class BeneficiarioFormulario implements OnInit {
  @Input() beneficiario: BeneficiarioDetalhe | null = null;
  @Input() nomePlano = '';
  @Output() readonly salvo = new EventEmitter<void>();
  @Output() readonly cancelado = new EventEmitter<void>();

  private readonly servico = inject(BeneficiarioServico);
  private readonly planoServico = inject(PlanoServico);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly planos = signal<Plano[]>([]);
  protected readonly carregandoPlanos = signal(false);
  protected readonly erroPlanos = signal<string | null>(null);
  protected readonly erro = signal<string | null>(null);
  protected readonly salvando = signal(false);
  protected readonly planoHistorico = computed(() => !!this.beneficiario &&
    !this.planos().some(plano => plano.id === this.beneficiario!.plano_id));
  protected readonly formulario = new FormGroup({
    nome_completo: new FormControl('', { nonNullable: true, validators: [nomeObrigatorio] }),
    cpf: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[0-9]{11}$/)] }),
    data_nascimento: new FormControl('', { nonNullable: true, validators: [Validators.required, nascimentoPassado] }),
    plano_id: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    status: new FormControl<'ATIVO' | 'INATIVO'>('ATIVO', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^(ATIVO|INATIVO)$/)] })
  });

  protected get congelado(): boolean {
    return this.beneficiario?.status === 'INATIVO';
  }

  ngOnInit(): void {
    if (this.beneficiario) this.formulario.patchValue(this.beneficiario);
    this.aplicarBloqueio();
    this.recarregarPlanos();
  }

  protected recarregarPlanos(): void {
    if (this.carregandoPlanos() || this.salvando()) return;
    this.carregandoPlanos.set(true);
    this.erroPlanos.set(null);
    this.planoServico.listar().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: planos => {
        this.planos.set(planos);
        this.carregandoPlanos.set(false);
      },
      error: (resposta: HttpErrorResponse) => {
        this.erroPlanos.set(mensagemDeErro(resposta));
        this.carregandoPlanos.set(false);
      }
    });
  }

  protected salvar(): void {
    if (this.salvando() || this.carregandoPlanos() || this.erroPlanos()) return;
    this.erro.set(null);
    this.formulario.markAllAsTouched();
    this.formulario.controls.data_nascimento.updateValueAndValidity();
    if (this.formulario.invalid) return;
    const valores = this.formulario.getRawValue();
    const cadastrais = this.congelado && this.beneficiario ? {
      nome_completo: this.beneficiario.nome_completo,
      data_nascimento: this.beneficiario.data_nascimento,
      plano_id: this.beneficiario.plano_id
    } : {
      nome_completo: valores.nome_completo.trim(),
      data_nascimento: valores.data_nascimento,
      plano_id: valores.plano_id
    };
    const pedido = this.beneficiario
      ? this.servico.atualizar(this.beneficiario.id, { ...cadastrais, status: valores.status })
      : this.servico.criar({ ...cadastrais, cpf: valores.cpf });
    this.salvando.set(true);
    this.formulario.disable();
    pedido.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.salvo.emit();
      },
      error: (resposta: HttpErrorResponse) => {
        this.erro.set(mensagemDeErro(resposta));
        this.salvando.set(false);
        this.formulario.enable();
        this.aplicarBloqueio();
      }
    });
  }

  protected cancelar(): void {
    if (!this.salvando()) this.cancelado.emit();
  }

  private aplicarBloqueio(): void {
    if (this.congelado) {
      this.formulario.controls.nome_completo.disable();
      this.formulario.controls.data_nascimento.disable();
      this.formulario.controls.plano_id.disable();
    }
  }
}
