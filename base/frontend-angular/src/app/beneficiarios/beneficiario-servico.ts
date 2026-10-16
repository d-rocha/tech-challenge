import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE } from '../nucleo/api';
import { AtualizarBeneficiario, BeneficiarioDetalhe, CriarBeneficiario, ConsultaBeneficiarios, PaginaBeneficiarios } from './beneficiario';

@Injectable({ providedIn: 'root' })
export class BeneficiarioServico {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE);

  listar(consulta: ConsultaBeneficiarios): Observable<PaginaBeneficiarios> {
    let params = new HttpParams()
      .set('pagina', consulta.pagina)
      .set('tamanho', consulta.tamanho);

    if (consulta.status) {
      params = params.set('status', consulta.status);
    }
    if (consulta.plano_id) {
      params = params.set('plano_id', consulta.plano_id);
    }

    return this.http.get<PaginaBeneficiarios>(`${this.base}/beneficiarios`, { params });
  }

  obter(id: string): Observable<BeneficiarioDetalhe> {
    return this.http.get<BeneficiarioDetalhe>(`${this.base}/beneficiarios/${id}`);
  }

  criar(dto: CriarBeneficiario): Observable<BeneficiarioDetalhe> {
    return this.http.post<BeneficiarioDetalhe>(`${this.base}/beneficiarios`, dto);
  }

  atualizar(id: string, dto: AtualizarBeneficiario): Observable<BeneficiarioDetalhe> {
    return this.http.put<BeneficiarioDetalhe>(`${this.base}/beneficiarios/${id}`, dto);
  }

  excluir(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/beneficiarios/${id}`);
  }
}
