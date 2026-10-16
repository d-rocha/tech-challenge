namespace Desafio.Api.Dominio;

public enum StatusBeneficiario
{
    ATIVO,
    INATIVO
}

public class Beneficiario
{
    private Beneficiario()
    {
    }

    public Beneficiario(string? nomeCompleto, string? cpf, DateOnly? dataNascimento, Guid? planoId)
    {
        nomeCompleto = nomeCompleto?.Trim() ?? string.Empty;
        var agora = DateTime.UtcNow;
        var detalhes = new List<DetalheErro>();

        if (nomeCompleto.Length == 0)
        {
            detalhes.Add(new DetalheErro("nome_completo", "obrigatorio"));
        }
        else if (nomeCompleto.Length is < 3 or > 120)
        {
            detalhes.Add(new DetalheErro("nome_completo", "tamanho_invalido"));
        }

        if (string.IsNullOrEmpty(cpf))
        {
            detalhes.Add(new DetalheErro("cpf", "obrigatorio"));
        }
        else if (!CpfValido(cpf))
        {
            detalhes.Add(new DetalheErro("cpf", "invalido"));
        }

        if (dataNascimento is null)
        {
            detalhes.Add(new DetalheErro("data_nascimento", "obrigatorio"));
        }
        else if (dataNascimento.Value >= DateOnly.FromDateTime(agora))
        {
            detalhes.Add(new DetalheErro("data_nascimento", "deve_ser_passada"));
        }

        if (planoId is null || planoId == Guid.Empty)
        {
            detalhes.Add(new DetalheErro("plano_id", "obrigatorio"));
        }

        if (detalhes.Count > 0)
        {
            throw new ValidacaoException("Dados do beneficiário inválidos", detalhes);
        }

        Id = Guid.NewGuid();
        NomeCompleto = nomeCompleto;
        Cpf = cpf!;
        DataNascimento = dataNascimento!.Value;
        PlanoId = planoId!.Value;
        Status = StatusBeneficiario.ATIVO;
        DataCadastro = agora;
    }

    public Guid Id { get; private set; }

    public string NomeCompleto { get; private set; } = null!;

    public string Cpf { get; private set; } = null!;

    public DateOnly DataNascimento { get; private set; }

    public StatusBeneficiario Status { get; private set; }

    public Guid PlanoId { get; private set; }

    public Plano? Plano { get; internal set; }

    public DateTime DataCadastro { get; private set; }

    private static bool CpfValido(string cpf)
    {
        if (cpf.Length != 11 || cpf.Any(caractere => caractere is < '0' or > '9'))
        {
            return false;
        }

        if (cpf.All(caractere => caractere == cpf[0]))
        {
            return false;
        }

        for (var posicao = 9; posicao <= 10; posicao++)
        {
            var soma = 0;
            for (var indice = 0; indice < posicao; indice++)
            {
                soma += (cpf[indice] - '0') * (posicao + 1 - indice);
            }

            var resto = soma % 11;
            var digito = resto < 2 ? 0 : 11 - resto;
            if (cpf[posicao] - '0' != digito)
            {
                return false;
            }
        }

        return true;
    }
}
