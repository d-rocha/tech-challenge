using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Desafio.Api.Aplicacao;
using Desafio.Api.Dominio;
using Microsoft.AspNetCore.Mvc;

namespace Desafio.Api.Api.Contratos;

public sealed record BeneficiarioRequest(
    string? NomeCompleto,
    string? Cpf,
    DateOnly? DataNascimento,
    Guid? PlanoId);

public sealed record BeneficiarioAtualizacaoRequest(
    string? NomeCompleto,
    DateOnly? DataNascimento,
    Guid? PlanoId,
    string? Status);

public sealed record BeneficiarioResponse(
    Guid Id,
    string NomeCompleto,
    string Cpf,
    DateOnly DataNascimento,
    StatusBeneficiario Status,
    Guid PlanoId,
    DateTime DataCadastro)
{
    public static BeneficiarioResponse De(Beneficiario beneficiario) =>
        new(beneficiario.Id, beneficiario.NomeCompleto, beneficiario.Cpf,
            beneficiario.DataNascimento, beneficiario.Status, beneficiario.PlanoId,
            beneficiario.DataCadastro);
}

public sealed record BeneficiarioListagemResponse(
    Guid Id,
    string NomeCompleto,
    string Cpf,
    DateOnly DataNascimento,
    StatusBeneficiario Status,
    Guid PlanoId,
    DateTime DataCadastro,
    string PlanoNome);

public sealed record BeneficiariosPaginadosResponse(
    IReadOnlyList<BeneficiarioListagemResponse> Dados,
    int Pagina,
    int Tamanho,
    int Total);

public sealed class BeneficiarioListagemRequest
{
    [FromQuery(Name = "pagina")]
    [DisplayFormat(ConvertEmptyStringToNull = false)]
    public string? Pagina { get; set; }

    [FromQuery(Name = "tamanho")]
    [DisplayFormat(ConvertEmptyStringToNull = false)]
    public string? Tamanho { get; set; }

    [FromQuery(Name = "status")]
    [DisplayFormat(ConvertEmptyStringToNull = false)]
    public string? Status { get; set; }

    [FromQuery(Name = "plano_id")]
    [DisplayFormat(ConvertEmptyStringToNull = false)]
    public string? PlanoId { get; set; }

    public BeneficiarioListagemDados Validar()
    {
        var detalhes = new List<DetalheErro>();
        var pagina = Inteiro(Pagina, "pagina", 1, int.MaxValue, 1, detalhes);
        var tamanho = Inteiro(Tamanho, "tamanho", 1, 100, 10, detalhes);

        StatusBeneficiario? status = Status switch
        {
            "ATIVO" => StatusBeneficiario.ATIVO,
            "INATIVO" => StatusBeneficiario.INATIVO,
            _ => null
        };
        if (Status is not null && status is null)
            detalhes.Add(new DetalheErro("status", "deve_ser_ATIVO_ou_INATIVO"));

        Guid? planoId = null;
        if (PlanoId is not null)
        {
            if (Guid.TryParse(PlanoId, out var id))
                planoId = id;
            else
                detalhes.Add(new DetalheErro("plano_id", "uuid_invalido"));
        }

        if (detalhes.Count > 0)
            throw new ValidacaoException("Parâmetros de listagem inválidos", detalhes);

        return new BeneficiarioListagemDados(pagina, tamanho, status, planoId);
    }

    private static int Inteiro(string? valor, string campo, int minimo, int maximo, int padrao,
        List<DetalheErro> detalhes)
    {
        if (valor is null)
            return padrao;

        if (int.TryParse(valor, NumberStyles.Integer, CultureInfo.InvariantCulture, out var numero) &&
            numero >= minimo && numero <= maximo)
            return numero;

        detalhes.Add(new DetalheErro(campo, $"inteiro_entre_{minimo}_e_{maximo}"));
        return padrao;
    }
}
