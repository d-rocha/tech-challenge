using Desafio.Api.Dominio;
using Desafio.Api.Infraestrutura;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace Desafio.Api.Tests;

/// <summary>
/// Sobe um PostgreSQL descartável em container e a API apontando para ele.
/// O container é compartilhado por toda a suíte; o banco é limpo antes de cada teste.
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    private const string ApagarPlanosCriadosPelosTestes =
        """
        DELETE FROM "Planos" WHERE "Id" NOT IN (
            '11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
            '33333333-3333-3333-3333-333333333333',
            '44444444-4444-4444-4444-444444444444',
            '55555555-5555-5555-5555-555555555555');
        """;

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();

    private WebApplicationFactory<Program> _fabrica = null!;

    public HttpClient Client { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _fabrica = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
                builder.UseSetting("ConnectionStrings:Postgres", _postgres.GetConnectionString()));

        Client = _fabrica.CreateClient();

        await UsarBancoAsync(async db =>
        {
            await db.Database.MigrateAsync();
            await CargaInicial.AplicarAsync(db);
        });
    }

    public async Task DisposeAsync()
    {
        Client.Dispose();
        await _fabrica.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    public async Task UsarBancoAsync(Func<AppDbContext, Task> acao)
    {
        using var escopo = _fabrica.Services.CreateScope();
        var db = escopo.ServiceProvider.GetRequiredService<AppDbContext>();

        await acao(db);
    }

    public WebApplicationFactory<Program> CriarApiComInterceptor(IInterceptor interceptor) =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:Postgres", _postgres.GetConnectionString());
                builder.ConfigureServices(services =>
                    services.AddDbContext<AppDbContext>(opcoes => opcoes.AddInterceptors(interceptor)));
            });

    /// <summary>
    /// Devolve o banco ao estado da carga inicial: sem beneficiários, apenas os cinco planos
    /// do seed e nenhum deles excluído.
    /// </summary>
    public async Task LimparAsync()
    {
        await UsarBancoAsync(async db =>
        {
            await db.Database.ExecuteSqlRawAsync("""DELETE FROM "Beneficiarios";""");
            await db.Database.ExecuteSqlRawAsync(ApagarPlanosCriadosPelosTestes);
            await db.Database.ExecuteSqlRawAsync("""UPDATE "Planos" SET "ExcluidoEm" = NULL;""");
        });
    }

    /// <summary>
    /// Insere beneficiários direto no banco, sem passar pela API. Usado como preparação de
    /// cenário, para que um teste de leitura não dependa do endpoint de criação.
    ///
    /// A inserção é por SQL de propósito: assim a preparação continua funcionando qualquer que
    /// seja a modelagem que você der à entidade de domínio.
    /// </summary>
    public async Task<IReadOnlyList<BeneficiarioSemeado>> SemearBeneficiariosAsync(
        int quantidade,
        Guid? planoId = null,
        string status = "ATIVO",
        int primeiraSemente = 1)
    {
        var semeados = Enumerable.Range(primeiraSemente, quantidade)
            .Select(semente => new BeneficiarioSemeado(
                Guid.NewGuid(),
                $"Beneficiario {semente:D4}",
                GeradorDeCpf.Gerar(semente),
                new DateOnly(1990, 1, 1).AddDays(semente),
                status,
                planoId ?? Planos.Bronze))
            .ToList();

        await UsarBancoAsync(async db =>
        {
            foreach (var b in semeados)
            {
                await db.Database.ExecuteSqlAsync(
                    $"""
                     INSERT INTO "Beneficiarios"
                       ("Id", "NomeCompleto", "Cpf", "DataNascimento", "Status", "PlanoId", "DataCadastro")
                     VALUES
                       ({b.Id}, {b.NomeCompleto}, {b.Cpf}, {b.DataNascimento}, {b.Status},
                        {b.PlanoId}, {DateTime.UtcNow})
                     """);
            }
        });

        return semeados;
    }
}

[CollectionDefinition(Nome)]
public class ColecaoDaApi : ICollectionFixture<ApiFixture>
{
    public const string Nome = "api";
}
