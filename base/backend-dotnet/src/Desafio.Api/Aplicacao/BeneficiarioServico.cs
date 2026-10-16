using Desafio.Api.Dominio;
using Desafio.Api.Infraestrutura;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Desafio.Api.Aplicacao;

public class BeneficiarioServico(AppDbContext db)
{
    public async Task<Beneficiario> CriarAsync(BeneficiarioRequestDados dados, CancellationToken cancellationToken)
    {
        var beneficiario = new Beneficiario(dados.NomeCompleto, dados.Cpf, dados.DataNascimento, dados.PlanoId);

        var planoExiste = await db.Planos
            .AnyAsync(plano => plano.Id == beneficiario.PlanoId, cancellationToken);

        if (!planoExiste)
        {
            throw new NaoProcessavelException(
                "Plano não encontrado ou excluído",
                [new DetalheErro("plano_id", "nao_encontrado")]);
        }

        // A pré-consulta recusa duplicatas sequenciais, mas não elimina corridas entre requisições.
        var cpfExiste = await db.Beneficiarios
            .IgnoreQueryFilters()
            .AnyAsync(existente => existente.Cpf == beneficiario.Cpf, cancellationToken);

        if (cpfExiste)
        {
            throw new ConflitoException(
                "Já existe beneficiário cadastrado com esse CPF",
                [new DetalheErro("cpf", "duplicado")]);
        }

        db.Beneficiarios.Add(beneficiario);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException excecao) when (
            excecao.InnerException is PostgresException postgres &&
            postgres.SqlState == PostgresErrorCodes.UniqueViolation &&
            postgres.ConstraintName == AppDbContext.IndiceCpfUnico)
        {
            throw new ConflitoException(
                "Já existe beneficiário cadastrado com esse CPF",
                [new DetalheErro("cpf", "duplicado")]);
        }

        return beneficiario;
    }
}

public sealed record BeneficiarioRequestDados(
    string? NomeCompleto,
    string? Cpf,
    DateOnly? DataNascimento,
    Guid? PlanoId);
