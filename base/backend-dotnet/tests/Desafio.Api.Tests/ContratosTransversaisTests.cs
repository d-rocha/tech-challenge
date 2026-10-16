using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Desafio.Api.Dominio;
using Desafio.Api.Infraestrutura;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Testcontainers.PostgreSql;
using Xunit.Abstractions;

namespace Desafio.Api.Tests;

[Collection(ColecaoDaApi.Nome)]
public class ContratosTransversaisTests(ApiFixture fixture, ITestOutputHelper output) : IAsyncLifetime
{
    public Task InitializeAsync() => fixture.LimparAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static object Criacao(string cpf = "52998224725", Guid? plano = null) => new
    {
        NomeCompleto = "Nome Sintetico", Cpf = cpf, DataNascimento = "1990-01-01", PlanoId = plano ?? Planos.Bronze
    };

    [Theory]
    [InlineData("sucesso", 200)]
    [InlineData("binding", 400)]
    [InlineData("dominio", 400)]
    [InlineData("ausente", 404)]
    [InlineData("duplicado", 409)]
    [InlineData("plano", 422)]
    [InlineData("inesperado", 500)]
    public async Task Requisicao_deve_logar_uma_conclusao_estruturada_com_status_final(string cenario, int esperado)
    {
        var cpf = "52998224725";
        if (cenario == "duplicado") cpf = Assert.Single(await fixture.SemearBeneficiariosAsync(1)).Cpf;
        var logs = new CapturaDeLogs();
        await using var api = fixture.CriarApiComInterceptor(new FalhaDeGravacao(cenario == "inesperado"))
            .WithWebHostBuilder(b => b.ConfigureLogging(l => l.AddProvider(logs)));
        using var client = api.CreateClient();
        logs.Zerar();
        using var resposta = cenario switch
        {
            "sucesso" => await client.GetAsync("/beneficiarios?cpf=" + cpf),
            "binding" => await client.PostAsync("/beneficiarios", new StringContent("{", Encoding.UTF8, "application/json")),
            "dominio" => await client.GetAsync("/beneficiarios?pagina=0&cpf=" + cpf),
            "ausente" => await client.GetAsync("/beneficiarios/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            "plano" => await client.PostAsync("/beneficiarios", Http.Json(Criacao(cpf, Planos.Inexistente))),
            _ => await client.PostAsync("/beneficiarios", Http.Json(Criacao(cpf)))
        };
        Assert.Equal(esperado, (int)resposta.StatusCode);
        if (esperado >= 400)
        {
            var corpo = await resposta.CorpoAsync();
            Assert.Equal(new[] { "detalhes", "erro", "mensagem" }, corpo.EnumerateObject().Select(p => p.Name).OrderBy(n => n));
            Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("erro").GetString()));
            Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("mensagem").GetString()));
            Assert.Equal(JsonValueKind.Array, corpo.GetProperty("detalhes").ValueKind);
            if (esperado == 500)
            {
                Assert.Equal("ErroInterno", corpo.GetProperty("erro").GetString());
                Assert.Equal("Erro interno ao processar a requisição", corpo.GetProperty("mensagem").GetString());
                Assert.DoesNotContain("sentinela_interna", corpo.GetRawText());
                Assert.DoesNotContain("Exception", corpo.GetRawText());
                Assert.DoesNotContain("System.", corpo.GetRawText());
            }
        }
        if (esperado == 500)
        {
            var falha = Assert.Single(logs.Eventos, e => e.Categoria.EndsWith("TratamentoDeErroMiddleware") && e.Nivel == LogLevel.Error);
            Assert.IsType<InvalidOperationException>(falha.Excecao);
            Assert.Equal("sentinela_interna", falha.Excecao!.Message);
            Assert.True(falha.Estado.ContainsKey("Metodo"));
            Assert.True(falha.Estado.ContainsKey("Rota"));
            Assert.Contains("{", Assert.IsType<string>(falha.Estado["{OriginalFormat}"]));
        }
        var evento = Assert.Single(logs.Conclusoes());
        Assert.Equal(esperado, Convert.ToInt32(evento.Estado["StatusCode"]));
        Assert.Equal(cenario is "sucesso" or "dominio" or "ausente" ? "GET" : "POST", evento.Estado["Metodo"]);
        var rota = Assert.IsType<string>(evento.Estado["Rota"]);
        Assert.Contains("beneficiarios", rota);
        Assert.DoesNotContain("aaaaaaaa", rota);
        Assert.DoesNotContain(cpf, rota);
        Assert.True(Convert.ToDouble(evento.Estado["DuracaoMs"]) >= 0);
        Assert.Contains("{", Assert.IsType<string>(evento.Estado["{OriginalFormat}"]));
        var texto = JsonSerializer.Serialize(evento.Estado);
        Assert.DoesNotContain(cpf, texto);
        Assert.DoesNotContain("Nome Sintetico", texto);
        Assert.DoesNotContain("cpf=", texto);
        output.WriteLine($"cenario={cenario};conclusoes=1;status={esperado};rota={rota}");
    }

    [Fact]
    public async Task Rota_desconhecida_nao_deve_logar_path_cru_com_identificador()
    {
        var logs = new CapturaDeLogs();
        await using var api = fixture.CriarApiComInterceptor(new FalhaDeGravacao(false))
            .WithWebHostBuilder(b => b.ConfigureLogging(l => l.AddProvider(logs)));
        using var client = api.CreateClient();
        logs.Zerar();
        using var resposta = await client.GetAsync("/desconhecida/52998224725?cpf=52998224725");
        Assert.Equal(HttpStatusCode.NotFound, resposta.StatusCode);
        var evento = Assert.Single(logs.Conclusoes());
        Assert.Equal("rota_nao_identificada", evento.Estado["Rota"]);
        Assert.Equal(404, Convert.ToInt32(evento.Estado["StatusCode"]));
        Assert.DoesNotContain("52998224725", JsonSerializer.Serialize(evento.Estado));
    }

    public static TheoryData<string, string, string[]> Operacoes => new()
    {
        { "/health", "get", ["200", "503", "500"] },
        { "/planos", "get", ["200", "500"] },
        { "/planos", "post", ["201", "400", "409", "500"] },
        { "/planos/{id}", "get", ["200", "404", "500"] },
        { "/planos/{id}", "put", ["200", "400", "404", "409", "500"] },
        { "/planos/{id}", "delete", ["204", "404", "500"] },
        { "/beneficiarios", "get", ["200", "400", "500"] },
        { "/beneficiarios", "post", ["201", "400", "409", "422", "500"] },
        { "/beneficiarios/{id}", "get", ["200", "404", "500"] },
        { "/beneficiarios/{id}", "put", ["200", "400", "404", "409", "422", "500"] },
        { "/beneficiarios/{id}", "delete", ["204", "404", "409", "500"] }
    };

    private async Task<JsonElement> SwaggerAsync()
    {
        using var resposta = await fixture.Client.GetAsync("/swagger/v1/swagger.json");
        Assert.Equal(HttpStatusCode.OK, resposta.StatusCode);
        return await resposta.CorpoAsync();
    }

    private static JsonElement Resolver(JsonElement doc, JsonElement schema)
    {
        while (schema.TryGetProperty("$ref", out var referencia))
            schema = doc.GetProperty("components").GetProperty("schemas").GetProperty(referencia.GetString()!.Split('/').Last());
        return schema;
    }

    [Theory]
    [MemberData(nameof(Operacoes))]
    public async Task OpenApi_deve_documentar_status_e_schemas_reais(string rota, string metodo, string[] codigos)
    {
        var doc = await SwaggerAsync();
        var respostas = doc.GetProperty("paths").GetProperty(rota).GetProperty(metodo).GetProperty("responses");
        foreach (var codigo in codigos)
        {
            Assert.True(respostas.TryGetProperty(codigo, out var resposta), $"{metodo} {rota} sem{codigo}");
            if (codigo == "204")
            {
                Assert.False(resposta.TryGetProperty("content", out var conteudo) && conteudo.EnumerateObject().Any());
                continue;
            }
            var schema = Resolver(doc, resposta.GetProperty("content").GetProperty("application/json").GetProperty("schema"));
            if (int.Parse(codigo) >= 400 && codigo != "503")
                Assert.Equal(new[] { "detalhes", "erro", "mensagem" }, schema.GetProperty("properties").EnumerateObject().Select(p => p.Name).OrderBy(n => n));
            if (rota == "/health" && codigo != "500")
                Assert.Equal(new[] { "banco", "status" }, schema.GetProperty("properties").EnumerateObject().Select(p => p.Name).OrderBy(n => n));
        }
    }

    [Fact]
    public async Task OpenApi_deve_documentar_query_tipada_e_dtos_snake_case_com_enum_string()
    {
        var doc = await SwaggerAsync();
        var operacao = doc.GetProperty("paths").GetProperty("/beneficiarios").GetProperty("get");
        var parametros = operacao.GetProperty("parameters").EnumerateArray().ToDictionary(p => p.GetProperty("name").GetString()!);
        foreach (var (nome, padrao, maximo) in new[] { ("pagina", 1, int.MaxValue), ("tamanho", 10, 100) })
        {
            var s = parametros[nome].GetProperty("schema");
            Assert.Equal("integer", s.GetProperty("type").GetString());
            Assert.Equal(padrao, s.GetProperty("default").GetInt32());
            Assert.Equal(1, s.GetProperty("minimum").GetInt32());
            Assert.Equal(maximo, s.GetProperty("maximum").GetInt32());
        }
        var status = Resolver(doc, parametros["status"].GetProperty("schema"));
        Assert.Equal("string", status.GetProperty("type").GetString());
        Assert.Equal(new[] { "ATIVO", "INATIVO" }, status.GetProperty("enum").EnumerateArray().Select(v => v.GetString()));
        Assert.Equal("uuid", parametros["plano_id"].GetProperty("schema").GetProperty("format").GetString());
        var individual = Resolver(doc, doc.GetProperty("paths").GetProperty("/beneficiarios/{id}").GetProperty("get")
            .GetProperty("responses").GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema"));
        Assert.Equal(new[] { "cpf", "data_cadastro", "data_nascimento", "id", "nome_completo", "plano_id", "status" },
            individual.GetProperty("properties").EnumerateObject().Select(p => p.Name).OrderBy(n => n));
        var situacao = Resolver(doc, individual.GetProperty("properties").GetProperty("status"));
        Assert.Equal("string", situacao.GetProperty("type").GetString());
        Assert.Equal(new[] { "ATIVO", "INATIVO" }, situacao.GetProperty("enum").EnumerateArray().Select(v => v.GetString()));
        var envelope = Resolver(doc, operacao.GetProperty("responses").GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema"));
        Assert.Equal(new[] { "dados", "pagina", "tamanho", "total" }, envelope.GetProperty("properties").EnumerateObject().Select(p => p.Name).OrderBy(n => n));
        var item = Resolver(doc, envelope.GetProperty("properties").GetProperty("dados").GetProperty("items"));
        Assert.Equal(8, item.GetProperty("properties").EnumerateObject().Count());
        Assert.Equal("string", item.GetProperty("properties").GetProperty("plano_nome").GetProperty("type").GetString());
    }

    [Fact]
    public async Task Health_deve_retornar_503_quando_postgres_privado_cai_apos_startup()
    {
        await using var postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();
        await postgres.StartAsync();
        await using var api = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
            b.UseSetting("ConnectionStrings:Postgres", postgres.GetConnectionString()));
        using var client = api.CreateClient();
        using var antes = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, antes.StatusCode);
        var saudavel = await antes.CorpoAsync();
        Assert.Equal("ok", saudavel.GetProperty("status").GetString());
        Assert.Equal("ok", saudavel.GetProperty("banco").GetString());
        await postgres.StopAsync();
        using var depois = await client.GetAsync("/health").WaitAsync(TimeSpan.FromSeconds(25));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, depois.StatusCode);
        var corpo = await depois.CorpoAsync();
        Assert.Equal("indisponivel", corpo.GetProperty("status").GetString());
        Assert.Equal("indisponivel", corpo.GetProperty("banco").GetString());
        Assert.Equal(2, corpo.EnumerateObject().Count());
    }

    [Fact]
    public async Task Startup_repetido_nao_deve_duplicar_alterar_ou_ressuscitar_seed()
    {
        try
        {
            await fixture.UsarBancoAsync(db => db.Database.ExecuteSqlAsync($"""
                UPDATE "Planos" SET "Nome" = {"Bronze Editado"}, "CodigoRegistroAns" = {"900001"}
                WHERE "Id" = {Planos.Bronze}
                """));
            Assert.Equal(HttpStatusCode.NoContent, (await fixture.Client.DeleteAsync($"/planos/{Planos.Prata}")).StatusCode);
            DateTime? exclusao = null;
            await fixture.UsarBancoAsync(async db => exclusao = (await db.Planos.IgnoreQueryFilters().SingleAsync(p => p.Id == Planos.Prata)).ExcluidoEm);
            Assert.NotNull(exclusao);
            await using var segunda = fixture.CriarApiComInterceptor(new FalhaDeGravacao(false));
            using var client = segunda.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
            await fixture.UsarBancoAsync(async db =>
            {
                await CargaInicial.AplicarAsync(db);
                await CargaInicial.AplicarAsync(db);
                var planos = await db.Planos.IgnoreQueryFilters().AsNoTracking().ToListAsync();
                Assert.Equal(5, planos.Count);
                Assert.Equal(Planos.Seed.OrderBy(id => id), planos.Select(p => p.Id).OrderBy(id => id));
                var bronze = planos.Single(p => p.Id == Planos.Bronze);
                Assert.Equal("Bronze Editado", bronze.Nome);
                Assert.Equal("900001", bronze.CodigoRegistroAns);
                Assert.Equal(exclusao, planos.Single(p => p.Id == Planos.Prata).ExcluidoEm);
                Assert.Equal(0, await db.Beneficiarios.IgnoreQueryFilters().CountAsync());
            });
        }
        finally
        {
            await fixture.UsarBancoAsync(db => db.Database.ExecuteSqlAsync($"""
                UPDATE "Planos" SET "Nome" = {"Bronze"}, "CodigoRegistroAns" = {"100001"} WHERE "Id" = {Planos.Bronze};
                UPDATE "Planos" SET "ExcluidoEm" = NULL WHERE "Id" = {Planos.Prata};
                """));
        }
    }

    private sealed class FalhaDeGravacao(bool falhar) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (falhar && eventData.Context!.ChangeTracker.Entries<Beneficiario>().Any(e => e.State == EntityState.Added))
                throw new InvalidOperationException("sentinela_interna");
            return ValueTask.FromResult(result);
        }
    }

    private sealed record Evento(string Categoria, LogLevel Nivel, Exception? Excecao, IReadOnlyDictionary<string, object?> Estado);
    private sealed class CapturaDeLogs : ILoggerProvider
    {
        private readonly ConcurrentQueue<Evento> _eventos = new();
        public IEnumerable<Evento> Eventos => _eventos.ToArray();
        public void Zerar() => _eventos.Clear();
        public IEnumerable<Evento> Conclusoes() => _eventos.Where(e => e.Categoria.Contains("Middlewares") &&
            new[] { "Metodo", "Rota", "StatusCode", "DuracaoMs" }.All(e.Estado.ContainsKey));
        public ILogger CreateLogger(string categoryName) => new Capturador(categoryName, _eventos);
        public void Dispose() { }
        private sealed class Capturador(string categoria, ConcurrentQueue<Evento> eventos) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                if (state is IEnumerable<KeyValuePair<string, object?>> campos)
                    eventos.Enqueue(new Evento(categoria, logLevel, exception, campos.ToDictionary(c => c.Key, c => c.Value)));
            }
        }
    }
}
