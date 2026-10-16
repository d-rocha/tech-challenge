import { Component } from '@angular/core';

import { PlanosLista } from './planos/planos-lista';
import { BeneficiariosLista } from './beneficiarios/beneficiarios-lista';

@Component({
  selector: 'app-root',
  imports: [PlanosLista, BeneficiariosLista],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
