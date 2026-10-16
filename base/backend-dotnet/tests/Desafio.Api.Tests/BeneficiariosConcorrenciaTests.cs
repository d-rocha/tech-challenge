using System.Net;
using Desafio.Api.Dominio;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Desafio.Api.Tests;

[Collection(ColecaoDaApi.Nome)]
public class BeneficiariosConcorrenciaTests(ApiFixture fixture) : IAsyncLifetime
{
    public Task InitializeAsync() => fixture.LimparAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private static object Dados(string cpf, Guid? planoId = null) => new
    {
        NomeCompleto = "Maria Aparecida da Silva",
        Cpf = cpf,
        DataNascimento = "1990-05-12",
        PlanoId = planoId ?? Planos.Bronze
    };

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Criar_simultaneamente_mesmo_cpf_deve_retornar_201_e_409_com_uma_linha(bool planosDistintos)
    {
        var barreira = new BarreiraDeGravacao();
        await using var api = fixture.CriarApiComInterceptor(barreira);
        using var client = api.CreateClient();

        var respostas = await Task.WhenAll(
            client.PostAsync("/beneficiarios", Http.Json(Dados("52998224725"))),
            client.PostAsync("/beneficiarios", Http.Json(Dados("52998224725", planosDistintos ? Planos.Prata : Planos.Bronze))));
        using var primeira = respostas[0];
        using var segunda = respostas[1];

        Assert.Equal(2, barreira.Chegadas);
        var criada = Assert.Single(respostas, r => r.StatusCode == HttpStatusCode.Created);
        var conflito = Assert.Single(respostas, r => r.StatusCode == HttpStatusCode.Conflict);
        var id = (await criada.CorpoAsync()).GetProperty("id").GetGuid();
        var erro = await conflito.CorpoAsync();
        Assert.Equal("Conflito", erro.GetProperty("erro").GetString());
        Assert.False(string.IsNullOrWhiteSpace(erro.GetProperty("mensagem").GetString()));
        var detalhe = Assert.Single(erro.GetProperty("detalhes").EnumerateArray());
        Assert.Equal("cpf", detalhe.GetProperty("campo").GetString());
        Assert.Equal("duplicado", detalhe.GetProperty("regra").GetString());

        await fixture.UsarBancoAsync(async db =>
        {
            var salvo = await db.Beneficiarios.AsNoTracking().SingleAsync();
            Assert.Equal(id, salvo.Id);
            Assert.Equal("52998224725", salvo.Cpf);
        });
    }

    [Fact]
    public async Task Criar_simultaneamente_cpfs_distintos_deve_persistir_ambos()
    {
        var barreira = new BarreiraDeGravacao();
        await using var api = fixture.CriarApiComInterceptor(barreira);
        using var client = api.CreateClient();
        var respostas = await Task.WhenAll(
            client.PostAsync("/beneficiarios", Http.Json(Dados("52998224725"))),
            client.PostAsync("/beneficiarios", Http.Json(Dados("71428793860"))));
        using var primeira = respostas[0];
        using var segunda = respostas[1];

        Assert.Equal(2, barreira.Chegadas);
        Assert.All(respostas, resposta => Assert.Equal(HttpStatusCode.Created, resposta.StatusCode));
        var id1 = (await primeira.CorpoAsync()).GetProperty("id").GetGuid();
        var id2 = (await segunda.CorpoAsync()).GetProperty("id").GetGuid();
        Assert.NotEqual(id1, id2);
        await fixture.UsarBancoAsync(async db =>
        {
            var salvos = await db.Beneficiarios.AsNoTracking().ToListAsync();
            Assert.Equal(2, salvos.Count);
            Assert.Contains(salvos, b => b.Id == id1 && b.Cpf == "52998224725");
            Assert.Contains(salvos, b => b.Id == id2 && b.Cpf == "71428793860");
        });
    }

    [Fact]
    public async Task Banco_deve_recusar_cpf_duplicado_mesmo_quando_registro_existente_inativo()
    {
        var original = Assert.Single(await fixture.SemearBeneficiariosAsync(1, status: "INATIVO"));
        var erro = await Assert.ThrowsAsync<PostgresException>(() => fixture.SemearBeneficiariosAsync(1, planoId: Planos.Prata));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, erro.SqlState);
        Assert.Equal("IX_Beneficiarios_Cpf", erro.ConstraintName);
        await fixture.UsarBancoAsync(async db =>
        {
            var salvo = await db.Beneficiarios.AsNoTracking().SingleAsync();
            Assert.Equal(original.Id, salvo.Id);
            Assert.Equal(StatusBeneficiario.INATIVO, salvo.Status);
        });
    }

    [Fact]
    public async Task Violacao_de_chave_primaria_nao_deve_ser_convertida_em_conflito_de_cpf()
    {
        var original = Assert.Single(await fixture.SemearBeneficiariosAsync(1));
        await using var api = fixture.CriarApiComInterceptor(new RepetirIdNaGravacao(original.Id));
        using var client = api.CreateClient();
        using var resposta = await client.PostAsync("/beneficiarios", Http.Json(Dados("52998224725")));

        Assert.Equal(HttpStatusCode.InternalServerError, resposta.StatusCode);
        var erro = await resposta.CorpoAsync();
        Assert.Equal("ErroInterno", erro.GetProperty("erro").GetString());
        Assert.Equal("Erro interno ao processar a requisição", erro.GetProperty("mensagem").GetString());
        Assert.Empty(erro.GetProperty("detalhes").EnumerateArray());
        await fixture.UsarBancoAsync(async db =>
        {
            var salvo = await db.Beneficiarios.AsNoTracking().SingleAsync();
            Assert.Equal(original.Id, salvo.Id);
            Assert.Equal(original.Cpf, salvo.Cpf);
        });
    }

    private sealed class BarreiraDeGravacao : SaveChangesInterceptor
    {
        private readonly TaskCompletionSource _ambasChegaram = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _chegadas;

        public int Chegadas => Volatile.Read(ref _chegadas);

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (eventData.Context?.ChangeTracker.Entries<Beneficiario>()
                    .Any(entrada => entrada.State == EntityState.Added) == true)
            {
                if (Interlocked.Increment(ref _chegadas) == 2)
                {
                    _ambasChegaram.TrySetResult();
                }

                // Libera apenas após ambas pré-consultas; timeout evita travar a suíte em regressão.
                await _ambasChegaram.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
            }

            return result;
        }
    }

    private sealed class RepetirIdNaGravacao(Guid id) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            foreach (var entrada in eventData.Context!.ChangeTracker.Entries<Beneficiario>()
                         .Where(entrada => entrada.State == EntityState.Added))
            {
                entrada.Property(b => b.Id).CurrentValue = id;
            }

            return ValueTask.FromResult(result);
        }
    }
}
