import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE } from '../nucleo/api';
import { ConsultaBeneficiarios, PaginaBeneficiarios } from './beneficiario';

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
}
