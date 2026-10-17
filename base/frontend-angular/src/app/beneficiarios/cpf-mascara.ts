import { Directive, ElementRef, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

const digitos = (valor: string) => valor.replace(/[^0-9]/g, '').slice(0, 11);

function formatar(valor: string): string {
  return valor.slice(0, 3) + (valor.length > 3 ? '.' + valor.slice(3, 6) : '') +
    (valor.length > 6 ? '.' + valor.slice(6, 9) : '') +
    (valor.length > 9 ? '-' + valor.slice(9) : '');
}

@Directive({
  selector: 'input[appCpfMascara]',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CpfMascara), multi: true }],
  host: {
    '(input)': 'entrada($event)',
    '(beforeinput)': 'antesDaEntrada($event)',
    '(blur)': 'tocar()',
    '(compositionstart)': 'compondo = true',
    '(compositionend)': 'finalizarComposicao()'
  }
})
export class CpfMascara implements ControlValueAccessor {
  private readonly input = inject(ElementRef<HTMLInputElement>).nativeElement;
  private valor = '';
  protected compondo = false;
  private alterar: (valor: string) => void = () => {};
  protected tocar: () => void = () => {};

  writeValue(valor: string | null): void {
    this.valor = digitos(valor ?? '');
    this.input.value = formatar(this.valor);
  }

  registerOnChange(alterar: (valor: string) => void): void { this.alterar = alterar; }
  registerOnTouched(tocar: () => void): void { this.tocar = tocar; }
  setDisabledState(desabilitado: boolean): void { this.input.disabled = desabilitado; }

  protected finalizarComposicao(): void {
    this.compondo = false;
    this.entrada();
  }

  protected entrada(evento?: Event): void {
    if (this.compondo) return;
    if (this.input.readOnly || this.input.disabled) {
      this.input.value = formatar(this.valor);
      return;
    }
    const inicio = this.input.selectionStart ?? 0;
    const antesDoCaret = digitos(this.input.value.slice(0, inicio)).length;
    const novoValor = digitos(this.input.value);
    const visualAnterior = formatar(this.valor);
    const tipoEntrada = evento instanceof InputEvent ? evento.inputType : undefined;
    const retroceder = tipoEntrada === 'deleteContentBackward';
    const avancar = tipoEntrada === 'deleteContentForward';
    // Some browsers cannot cancel beforeinput, or omit it. Detect a native
    // separator-only deletion before restoring the mask, without deleting twice.
    if ((retroceder || avancar) && novoValor === this.valor &&
        /[.-]/.test(visualAnterior[inicio] ?? '') &&
        this.input.value === visualAnterior.slice(0, inicio) + visualAnterior.slice(inicio + 1)) {
      const indice = antesDoCaret - (retroceder ? 1 : 0);
      if (indice >= 0 && indice < this.valor.length) {
        this.atualizar(this.valor.slice(0, indice) + this.valor.slice(indice + 1), indice);
        return;
      }
    }
    this.atualizar(novoValor, antesDoCaret);
  }

  protected antesDaEntrada(evento: InputEvent): void {
    if (!evento.cancelable || this.compondo || this.input.readOnly || this.input.disabled) return;
    const inicio = this.input.selectionStart;
    if (inicio === null || inicio !== this.input.selectionEnd) return;
    const retroceder = evento.inputType === 'deleteContentBackward';
    const avancar = evento.inputType === 'deleteContentForward';
    const adjacente = this.input.value[retroceder ? inicio - 1 : inicio];
    // Native deletion handles digits and selections. Skip a separator and remove
    // the adjacent digit in the same edit so the mask cannot trap the caret.
    if ((!retroceder && !avancar) || !adjacente || !/[.-]/.test(adjacente)) return;
    evento.preventDefault();
    const indice = digitos(this.input.value.slice(0, inicio)).length - (retroceder ? 1 : 0);
    if (indice < 0 || indice >= this.valor.length) return;
    this.atualizar(this.valor.slice(0, indice) + this.valor.slice(indice + 1), indice);
  }

  private atualizar(valor: string, digitosAntesDoCaret: number): void {
    this.valor = valor;
    const visual = formatar(valor);
    this.input.value = visual;
    let posicao = 0;
    let contagem = 0;
    while (posicao < visual.length && contagem < digitosAntesDoCaret) {
      if (/[0-9]/.test(visual[posicao])) contagem++;
      posicao++;
    }
    this.input.setSelectionRange(posicao, posicao);
    this.alterar(valor);
  }
}
