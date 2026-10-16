using Desafio.Api.Api.Contratos;
using Desafio.Api.Dominio;
using Desafio.Api.Infraestrutura;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Desafio.Api.Aplicacao;

public class BeneficiarioServico(AppDbContext db)
{
    public async Task<BeneficiariosPaginadosResponse> ListarAsync(
        BeneficiarioListagemDados dados, CancellationToken cancellationToken)
    {
        // IgnoreQueryFilters no join histórico afeta a consulta inteira no EF Core.
        // Mantemos a exclusão de beneficiários explícita também na projeção paginada.
        var consulta = db.Beneficiarios.AsNoTracking().Where(b => b.ExcluidoEm == null);
        if (dados.Status is not null)
            consulta = consulta.Where(b => b.Status == dados.Status.Value);
        if (dados.PlanoId is not null)
            consulta = consulta.Where(b => b.PlanoId == dados.PlanoId.Value);

        var total = await consulta.CountAsync(cancellationToken);
        var deslocamento = ((long)dados.Pagina - 1) * dados.Tamanho;
        if (deslocamento >= total)
            return new BeneficiariosPaginadosResponse([], dados.Pagina, dados.Tamanho, total);

        var itens = await consulta
            .Join(db.Planos.IgnoreQueryFilters().AsNoTracking(),
                b => b.PlanoId, plano => plano.Id, (b, plano) => new { Beneficiario = b, Plano = plano })
            .OrderBy(item => item.Beneficiario.NomeCompleto)
            .ThenBy(item => item.Beneficiario.Id)
            .Skip((int)deslocamento)
            .Take(dados.Tamanho)
            .Select(item => new BeneficiarioListagemResponse(
                item.Beneficiario.Id, item.Beneficiario.NomeCompleto, item.Beneficiario.Cpf,
                item.Beneficiario.DataNascimento, item.Beneficiario.Status, item.Beneficiario.PlanoId,
                item.Beneficiario.DataCadastro, item.Plano.Nome))
            .ToListAsync(cancellationToken);

        return new BeneficiariosPaginadosResponse(itens, dados.Pagina, dados.Tamanho, total);
    }

    public async Task<Beneficiario> ObterAsync(Guid id, CancellationToken cancellationToken)
    {
        return await db.Beneficiarios.FirstOrDefaultAsync(b => b.Id == id, cancellationToken)
               ?? throw new NaoEncontradoException("Beneficiário não encontrado");
    }

    public async Task<Beneficiario> AtualizarAsync(
        Guid id, BeneficiarioAtualizacaoDados dados, CancellationToken cancellationToken)
    {
        var beneficiario = await ObterAsync(id, cancellationToken);
        beneficiario.ValidarAtualizacao(dados.NomeCompleto, dados.DataNascimento, dados.PlanoId, dados.Status);

        var planoExiste = await db.Planos.AnyAsync(plano => plano.Id == dados.PlanoId, cancellationToken);
        if (!planoExiste)
        {
            throw new NaoProcessavelException(
                "Plano não encontrado ou excluído",
                [new DetalheErro("plano_id", "nao_encontrado")]);
        }

        beneficiario.Atualizar(dados.NomeCompleto, dados.DataNascimento, dados.PlanoId, dados.Status);
        await SalvarCicloVidaAsync(cancellationToken);

        return beneficiario;
    }

    public async Task ExcluirAsync(Guid id, CancellationToken cancellationToken)
    {
        var beneficiario = await ObterAsync(id, cancellationToken);
        beneficiario.Excluir();
        await SalvarCicloVidaAsync(cancellationToken);
    }

    private async Task SalvarCicloVidaAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConflitoException("Situação ou exclusão do beneficiário alterada por outra requisição");
        }
    }

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

public sealed record BeneficiarioAtualizacaoDados(
    string? NomeCompleto,
    DateOnly? DataNascimento,
    Guid? PlanoId,
    string? Status);

public sealed record BeneficiarioListagemDados(
    int Pagina,
    int Tamanho,
    StatusBeneficiario? Status,
    Guid? PlanoId);
