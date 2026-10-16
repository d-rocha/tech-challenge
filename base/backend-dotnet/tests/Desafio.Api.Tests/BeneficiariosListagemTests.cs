using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit.Abstractions;

namespace Desafio.Api.Tests;

[Collection(ColecaoDaApi.Nome)]
public class BeneficiariosListagemTests(ApiFixture fixture, ITestOutputHelper output) : IAsyncLifetime
{
    public Task InitializeAsync() => fixture.LimparAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<JsonElement> EnvelopeAsync(HttpResponseMessage resposta, int pagina, int tamanho, int total, int quantidade)
    {
        Assert.Equal(HttpStatusCode.OK, resposta.StatusCode);
        var corpo = await resposta.CorpoAsync();
        Assert.Equal(4, corpo.EnumerateObject().Count());
        Assert.Equal(pagina, corpo.GetProperty("pagina").GetInt32());
        Assert.Equal(tamanho, corpo.GetProperty("tamanho").GetInt32());
        Assert.Equal(total, corpo.GetProperty("total").GetInt32());
        Assert.Equal(quantidade, corpo.GetProperty("dados").GetArrayLength());
        return corpo;
    }

    private static Guid[] Ids(JsonElement corpo) => corpo.GetProperty("dados").EnumerateArray()
        .Select(b => b.GetProperty("id").GetGuid()).ToArray();

    [Fact]
    public async Task Padrao_deve_ser_pagina_1_tamanho_10_com_total_do_conjunto()
    {
        var semeados = await fixture.SemearBeneficiariosAsync(25);
        var corpo = await EnvelopeAsync(await fixture.Client.GetAsync("/beneficiarios"), 1, 10, 25, 10);
        Assert.Equal(semeados.Take(10).Select(b => b.Id), Ids(corpo));
        var primeiro = corpo.GetProperty("dados")[0];
        Assert.Equal(8, primeiro.EnumerateObject().Count());
        Assert.Equal(semeados[0].NomeCompleto, primeiro.GetProperty("nome_completo").GetString());
        Assert.Equal(semeados[0].Cpf, primeiro.GetProperty("cpf").GetString());
        Assert.Equal(semeados[0].DataNascimento.ToString("yyyy-MM-dd"), primeiro.GetProperty("data_nascimento").GetString());
        Assert.Equal("ATIVO", primeiro.GetProperty("status").GetString());
        Assert.Equal(Planos.Bronze, primeiro.GetProperty("plano_id").GetGuid());
        Assert.Equal("Bronze", primeiro.GetProperty("plano_nome").GetString());
        Assert.Equal(DateTimeKind.Utc, primeiro.GetProperty("data_cadastro").GetDateTime().Kind);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(100)]
    public async Task Limites_validos_de_tamanho_devem_ser_respeitados(int tamanho)
    {
        var semeados = await fixture.SemearBeneficiariosAsync(103);
        var corpo = await EnvelopeAsync(await fixture.Client.GetAsync($"/beneficiarios?pagina=2&tamanho={tamanho}"),
            2, tamanho, 103, Math.Min(tamanho, 103 - tamanho));
        Assert.Equal(semeados.Skip(tamanho).Take(tamanho).Select(b => b.Id), Ids(corpo));
    }

    [Theory]
    [InlineData("pagina=0", "pagina")]
    [InlineData("pagina=-1", "pagina")]
    [InlineData("pagina=abc", "pagina")]
    [InlineData("pagina=1.5", "pagina")]
    [InlineData("pagina=2147483648", "pagina")]
    [InlineData("pagina=", "pagina")]
    [InlineData("tamanho=0", "tamanho")]
    [InlineData("tamanho=-1", "tamanho")]
    [InlineData("tamanho=101", "tamanho")]
    [InlineData("tamanho=abc", "tamanho")]
    [InlineData("tamanho=1.5", "tamanho")]
    [InlineData("tamanho=2147483648", "tamanho")]
    [InlineData("tamanho=", "tamanho")]
    [InlineData("status=ativo", "status")]
    [InlineData("status=OUTRO", "status")]
    [InlineData("status=0", "status")]
    [InlineData("status=1", "status")]
    [InlineData("status=", "status")]
    [InlineData("status=%20", "status")]
    [InlineData("plano_id=uuid-invalido", "plano_id")]
    [InlineData("plano_id=", "plano_id")]
    public async Task Query_invalida_deve_devolver_400_identificando_campo(string query, string campo)
    {
        var resposta = await fixture.Client.GetAsync("/beneficiarios?" + query);
        Assert.Equal(HttpStatusCode.BadRequest, resposta.StatusCode);
        var erro = await resposta.CorpoAsync();
        Assert.Equal("ValidacaoInvalida", erro.GetProperty("erro").GetString());
        Assert.False(string.IsNullOrWhiteSpace(erro.GetProperty("mensagem").GetString()));
        Assert.Contains(erro.GetProperty("detalhes").EnumerateArray(), d =>
            d.GetProperty("campo").GetString() == campo && !string.IsNullOrWhiteSpace(d.GetProperty("regra").GetString()));
    }

    [Theory]
    [InlineData("status=ATIVO", 7)]
    [InlineData("status=INATIVO", 6)]
    [InlineData("plano_id=11111111-1111-1111-1111-111111111111", 10)]
    [InlineData("status=ATIVO&plano_id=11111111-1111-1111-1111-111111111111", 4)]
    [InlineData("status=INATIVO&plano_id=22222222-2222-2222-2222-222222222222", 0)]
    public async Task Filtros_devem_aplicar_mesma_intersecao_no_total_e_nos_dados(string query, int total)
    {
        var ativosBronze = await fixture.SemearBeneficiariosAsync(4, Planos.Bronze, "ATIVO", 100);
        var inativosBronze = await fixture.SemearBeneficiariosAsync(6, Planos.Bronze, "INATIVO", 200);
        var ativosPrata = await fixture.SemearBeneficiariosAsync(3, Planos.Prata, "ATIVO", 300);
        var todos = ativosBronze.Concat(inativosBronze).Concat(ativosPrata);
        var esperado = todos.Where(b =>
            (!query.Contains("status=") || query.Contains("status=" + b.Status)) &&
            (!query.Contains("plano_id=") || query.Contains("plano_id=" + b.PlanoId))).ToList();
        Assert.Equal(total, esperado.Count);
        var encontrados = new List<Guid>();
        for (var pagina = 1; pagina <= Math.Max(1, (total + 2) / 3); pagina++)
        {
            var corpo = await EnvelopeAsync(await fixture.Client.GetAsync($"/beneficiarios?{query}&pagina={pagina}&tamanho=3"),
                pagina, 3, total, Math.Min(3, Math.Max(0, total - (pagina - 1) * 3)));
            encontrados.AddRange(Ids(corpo));
        }
        Assert.Equal(esperado.Select(b => b.Id), encontrados);
    }

    [Theory]
    [InlineData(4, 10)]
    [InlineData(int.MaxValue, 100)]
    public async Task Pagina_alem_do_fim_deve_ser_200_vazio_sem_overflow(int pagina, int tamanho)
    {
        await fixture.SemearBeneficiariosAsync(25);
        await EnvelopeAsync(await fixture.Client.GetAsync($"/beneficiarios?pagina={pagina}&tamanho={tamanho}"), pagina, tamanho, 25, 0);
    }

    [Theory]
    [InlineData("99999999-9999-9999-9999-999999999999")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public async Task Filtro_de_plano_sem_correspondencia_deve_retornar_200_vazio(string plano)
    {
        await fixture.SemearBeneficiariosAsync(3);
        await EnvelopeAsync(await fixture.Client.GetAsync($"/beneficiarios?plano_id={plano}"), 1, 10, 0, 0);
    }

    [Fact]
    public async Task Conjunto_vazio_deve_manter_envelope_e_total_zero()
    {
        await EnvelopeAsync(await fixture.Client.GetAsync("/beneficiarios"), 1, 10, 0, 0);
    }

    [Fact]
    public async Task Empates_de_nome_devem_desempatar_por_id_sem_perder_ou_repetir_itens()
    {
        var semeados = await fixture.SemearBeneficiariosAsync(23);
        await fixture.UsarBancoAsync(db => db.Database.ExecuteSqlAsync($"""
            UPDATE "Beneficiarios" SET "NomeCompleto" = {"Mesmo Nome"}
            """));
        var esperados = semeados.Select(b => b.Id).OrderBy(id => id.ToString("D"), StringComparer.Ordinal).ToArray();
        var encontrados = new List<Guid>();
        for (var pagina = 1; pagina <= 5; pagina++)
        {
            var corpo = await EnvelopeAsync(await fixture.Client.GetAsync($"/beneficiarios?pagina={pagina}&tamanho=5"),
                pagina, 5, 23, pagina == 5 ? 3 : 5);
            encontrados.AddRange(Ids(corpo));
        }
        Assert.Equal(esperados, encontrados);
        Assert.Equal(23, encontrados.Distinct().Count());
        Assert.Equal(esperados.Take(5), Ids(await EnvelopeAsync(await fixture.Client.GetAsync("/beneficiarios?tamanho=5"), 1, 5, 23, 5)));
    }

    [Theory]
    [InlineData("ATIVO")]
    [InlineData("INATIVO")]
    public async Task Plano_excluido_deve_manter_beneficiario_e_nome_historico_na_lista(string status)
    {
        var b = Assert.Single(await fixture.SemearBeneficiariosAsync(1, status: status));
        Assert.Equal(HttpStatusCode.NoContent, (await fixture.Client.DeleteAsync($"/planos/{b.PlanoId}")).StatusCode);
        var corpo = await EnvelopeAsync(await fixture.Client.GetAsync($"/beneficiarios?plano_id={b.PlanoId}&status={status}"), 1, 10, 1, 1);
        Assert.Equal(new[] { b.Id }, Ids(corpo));
        Assert.Equal("Bronze", corpo.GetProperty("dados")[0].GetProperty("plano_nome").GetString());
        var planos = await (await fixture.Client.GetAsync("/planos")).CorpoAsync();
        Assert.DoesNotContain(planos.EnumerateArray(), p => p.GetProperty("id").GetGuid() == b.PlanoId);
    }

    [Fact]
    public async Task Exclusao_de_beneficiario_deve_afetar_total_e_itens_sem_ocultar_inativos()
    {
        var ativos = await fixture.SemearBeneficiariosAsync(2);
        var inativo = Assert.Single(await fixture.SemearBeneficiariosAsync(1, status: "INATIVO", primeiraSemente: 100));
        Assert.Equal(HttpStatusCode.NoContent, (await fixture.Client.DeleteAsync($"/beneficiarios/{ativos[0].Id}")).StatusCode);
        var corpo = await EnvelopeAsync(await fixture.Client.GetAsync("/beneficiarios"), 1, 10, 2, 2);
        Assert.Equal(new[] { ativos[1].Id, inativo.Id }, Ids(corpo));
        await fixture.UsarBancoAsync(async db => Assert.Equal(3, await db.Beneficiarios.IgnoreQueryFilters().CountAsync()));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(10)]
    [InlineData(100)]
    public async Task Quantidade_de_consultas_nao_deve_crescer_com_itens_e_planos(int tamanho)
    {
        var esperados = new List<BeneficiarioSemeado>();
        for (var i = 0; i < Planos.Seed.Length; i++)
            esperados.AddRange(await fixture.SemearBeneficiariosAsync(21, Planos.Seed[i], primeiraSemente: 100 * (i + 1)));
        var contador = new ContadorDeComandos();
        await using var api = fixture.CriarApiComInterceptor(contador);
        using var client = api.CreateClient();
        contador.Zerar(); // Exclui inicialização da API; mede somente a requisição.
        var corpo = await EnvelopeAsync(await client.GetAsync($"/beneficiarios?tamanho={tamanho}"), 1, tamanho, 105, tamanho);
        Assert.Equal(esperados.Take(tamanho).Select(b => b.Id), Ids(corpo));
        var nomes = new Dictionary<Guid, string>
        {
            [Planos.Bronze] = "Bronze", [Planos.Prata] = "Prata", [Planos.Ouro] = "Ouro",
            [Planos.Diamante] = "Diamante", [Planos.Executivo] = "Executivo"
        };
        Assert.All(corpo.GetProperty("dados").EnumerateArray(), b =>
            Assert.Equal(nomes[b.GetProperty("plano_id").GetGuid()], b.GetProperty("plano_nome").GetString()));
        Assert.InRange(contador.Quantidade, 1, 2);
        output.WriteLine($"tamanho={tamanho};itens={tamanho};planos=5;comandos={contador.Quantidade}");
        var comandosDaPrimeira = contador.Quantidade;
        contador.Zerar();
        await EnvelopeAsync(await client.GetAsync("/beneficiarios?tamanho=1"), 1, 1, 105, 1);
        Assert.Equal(comandosDaPrimeira, contador.Quantidade);
        contador.Zerar();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/beneficiarios?pagina=0")).StatusCode);
        Assert.Equal(0, contador.Quantidade);
    }

    private sealed class ContadorDeComandos : DbCommandInterceptor
    {
        private readonly ConcurrentQueue<string> _comandos = new();
        public int Quantidade => _comandos.Count;
        public void Zerar() => _comandos.Clear();
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        { _comandos.Enqueue(command.CommandText); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        { _comandos.Enqueue(command.CommandText); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        { _comandos.Enqueue(command.CommandText); return ValueTask.FromResult(result); }
    }
}
