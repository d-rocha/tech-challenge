export interface BeneficiarioDetalhe {
  id: string;
  nome_completo: string;
  cpf: string;
  data_nascimento: string;
  status: 'ATIVO' | 'INATIVO';
  plano_id: string;
  data_cadastro: string;
}

export interface Beneficiario extends BeneficiarioDetalhe {
  plano_nome: string;
}

export interface CriarBeneficiario {
  nome_completo: string;
  cpf: string;
  data_nascimento: string;
  plano_id: string;
}

export interface AtualizarBeneficiario {
  nome_completo: string;
  data_nascimento: string;
  plano_id: string;
  status: 'ATIVO' | 'INATIVO';
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
