using System.Net;
using Desafio.Api.Dominio;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Desafio.Api.Tests;

[Collection(ColecaoDaApi.Nome)]
public class BeneficiariosCicloVidaConcorrenciaTests(ApiFixture fixture) : IAsyncLifetime
{
    public Task InitializeAsync() => fixture.LimparAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Theory]
    [InlineData("inativar", "editar")]
    [InlineData("excluir", "editar")]
    [InlineData("inativar", "excluir")]
    public async Task Gravacao_obsoleta_nao_deve_alterar_ciclo_de_vida(string primeiraAcao, string segundaAcao)
    {
        var b = Assert.Single(await fixture.SemearBeneficiariosAsync(1));
        var barreira = new OrdenarGravacoes(primeiraAcao);
        await using var api = fixture.CriarApiComInterceptor(barreira);
        using var client = api.CreateClient();
        var rota = $"/beneficiarios/{b.Id}";
        Task<HttpResponseMessage> ExecutarAsync(string acao) => acao == "excluir"
            ? client.DeleteAsync(rota)
            : client.PutAsync(rota, Http.Json(new
            {
                NomeCompleto = acao == "editar" ? "Nome Que Nao Deve Persistir" : b.NomeCompleto,
                DataNascimento = b.DataNascimento, PlanoId = b.PlanoId,
                Status = acao == "inativar" ? "INATIVO" : "ATIVO"
            }));

        var respostas = await Task.WhenAll(ExecutarAsync(primeiraAcao), ExecutarAsync(segundaAcao));
        using var primeira = respostas[0];
        using var segunda = respostas[1];
        Assert.Equal(2, barreira.Chegadas);
        Assert.Equal(primeiraAcao == "excluir" ? HttpStatusCode.NoContent : HttpStatusCode.OK, primeira.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, segunda.StatusCode);
        var erro = await segunda.CorpoAsync();
        Assert.Equal("Conflito", erro.GetProperty("erro").GetString());
        Assert.False(string.IsNullOrWhiteSpace(erro.GetProperty("mensagem").GetString()));
        Assert.Equal(System.Text.Json.JsonValueKind.Array, erro.GetProperty("detalhes").ValueKind);
        await fixture.UsarBancoAsync(async db =>
        {
            var salvo = await db.Beneficiarios.IgnoreQueryFilters().AsNoTracking().SingleAsync();
            Assert.Equal(b.Id, salvo.Id);
            Assert.Equal(b.Cpf, salvo.Cpf);
            Assert.Equal(b.NomeCompleto, salvo.NomeCompleto);
            Assert.Equal(b.DataNascimento, salvo.DataNascimento);
            Assert.Equal(b.PlanoId, salvo.PlanoId);
            Assert.Equal(primeiraAcao == "inativar" ? StatusBeneficiario.INATIVO : StatusBeneficiario.ATIVO, salvo.Status);
            if (primeiraAcao == "excluir") Assert.NotNull(salvo.ExcluidoEm);
            else Assert.Null(salvo.ExcluidoEm);
        });
    }

    private sealed class OrdenarGravacoes(string primeiraAcao) : SaveChangesInterceptor
    {
        private readonly TaskCompletionSource _ambasChegaram = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _primeiraPersistiu = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _chegadas;
        public int Chegadas => Volatile.Read(ref _chegadas);

        private bool Primeira(DbContext contexto) => contexto.ChangeTracker.Entries<Beneficiario>().Any(e =>
            primeiraAcao == "inativar" ? e.Entity.Status == StatusBeneficiario.INATIVO : e.Entity.ExcluidoEm is not null);

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            var contexto = eventData.Context!;
            if (!contexto.ChangeTracker.Entries<Beneficiario>().Any(e => e.State == EntityState.Modified)) return result;
            if (Interlocked.Increment(ref _chegadas) == 2) _ambasChegaram.TrySetResult();
            // Ambas requisições já carregaram ATIVO; a segunda só grava após a primeira persistir.
            await _ambasChegaram.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
            if (!Primeira(contexto)) await _primeiraPersistiu.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
            return result;
        }

        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (Primeira(eventData.Context!)) _primeiraPersistiu.TrySetResult();
            return ValueTask.FromResult(result);
        }
    }
}
