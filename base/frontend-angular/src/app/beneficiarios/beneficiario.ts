export interface Beneficiario {
  id: string;
  nome_completo: string;
  cpf: string;
  data_nascimento: string;
  status: 'ATIVO' | 'INATIVO';
  plano_id: string;
  plano_nome: string;
  data_cadastro: string;
}

export interface ConsultaBeneficiarios {
  pagina: number;
  tamanho: number;
  status?: 'ATIVO' | 'INATIVO';
  plano_id?: string;
}

export interface PaginaBeneficiarios {
  dados: Beneficiario[];
  pagina: number;
  tamanho: number;
  total: number;
}
