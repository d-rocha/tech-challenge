using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Desafio.Api.Tests;

[Collection(ColecaoDaApi.Nome)]
public class BeneficiariosCicloVidaTests(ApiFixture fixture) : IAsyncLifetime
{
    private HttpClient Client => fixture.Client;
    public Task InitializeAsync() => fixture.LimparAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static Dictionary<string, object?> Dados(BeneficiarioSemeado b, string? status = null) => new()
    {
        ["nome_completo"] = b.NomeCompleto,
        ["data_nascimento"] = b.DataNascimento.ToString("yyyy-MM-dd"),
        ["plano_id"] = b.PlanoId,
        ["status"] = status ?? b.Status
    };

    private Task<HttpResponseMessage> AtualizarAsync(Guid id, object dados) =>
        Client.PutAsync($"/beneficiarios/{id}", Http.Json(dados));

    private async Task<Estado> LerAsync(Guid id)
    {
        Estado? estado = null;
        await fixture.UsarBancoAsync(async db =>
        {
            estado = await db.Database.SqlQuery<Estado>($"""
                SELECT "Id", "NomeCompleto", "Cpf", "DataNascimento", "Status", "PlanoId",
                       "DataCadastro", "ExcluidoEm" FROM "Beneficiarios" WHERE "Id" = {id}
                """).SingleAsync();
        });
        return estado!;
    }

    private static async Task<JsonElement> ErroAsync(HttpResponseMessage resposta, HttpStatusCode esperado, string? campo = null)
    {
        Assert.Equal(esperado, resposta.StatusCode);
        var erro = await resposta.CorpoAsync();
        Assert.False(string.IsNullOrWhiteSpace(erro.GetProperty("erro").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(erro.GetProperty("mensagem").GetString()));
        if (campo is not null)
            Assert.Contains(erro.GetProperty("detalhes").EnumerateArray(), d => d.GetProperty("campo").GetString() == campo);
        return erro;
    }

    [Theory]
    [InlineData("ATIVO")]
    [InlineData("INATIVO")]
    public async Task Obter_deve_retornar_dto_completo_mesmo_com_plano_excluido(string status)
    {
        var b = (await fixture.SemearBeneficiariosAsync(1, status: status)).Single();
        Assert.Equal(HttpStatusCode.NoContent, (await Client.DeleteAsync($"/planos/{b.PlanoId}")).StatusCode);
        var resposta = await Client.GetAsync($"/beneficiarios/{b.Id}");
        Assert.Equal(HttpStatusCode.OK, resposta.StatusCode);
        var corpo = await resposta.CorpoAsync();
        Assert.Equal(7, corpo.EnumerateObject().Count());
        Assert.Equal(b.Id, corpo.GetProperty("id").GetGuid());
        Assert.Equal(b.NomeCompleto, corpo.GetProperty("nome_completo").GetString());
        Assert.Equal(b.Cpf, corpo.GetProperty("cpf").GetString());
        Assert.Equal(b.DataNascimento.ToString("yyyy-MM-dd"), corpo.GetProperty("data_nascimento").GetString());
        Assert.Equal(status, corpo.GetProperty("status").GetString());
        Assert.Equal(b.PlanoId, corpo.GetProperty("plano_id").GetGuid());
        Assert.Equal((await LerAsync(b.Id)).DataCadastro, corpo.GetProperty("data_cadastro").GetDateTime());
    }

    [Fact]
    public async Task Location_de_criacao_deve_resolver_mesmo_dto()
    {
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(new
        {
            NomeCompleto = "Maria Aparecida", Cpf = GeradorDeCpf.Gerar(873),
            DataNascimento = "1990-01-01", PlanoId = Planos.Bronze
        }));
        Assert.Equal(HttpStatusCode.Created, resposta.StatusCode);
        Assert.NotNull(resposta.Headers.Location);
        var consulta = await Client.GetAsync(resposta.Headers.Location);
        Assert.Equal(HttpStatusCode.OK, consulta.StatusCode);
        var criado = await resposta.CorpoAsync();
        var obtido = await consulta.CorpoAsync();
        Assert.Equal(7, obtido.EnumerateObject().Count());
        foreach (var campo in criado.EnumerateObject().Where(c => c.Name != "data_cadastro"))
            Assert.Equal(campo.Value.GetRawText(), obtido.GetProperty(campo.Name).GetRawText());
        // PostgreSQL armazena microssegundos; DateTime pode conter o sétimo dígito fracionário.
        Assert.InRange((criado.GetProperty("data_cadastro").GetDateTime() -
            obtido.GetProperty("data_cadastro").GetDateTime()).Duration(), TimeSpan.Zero, TimeSpan.FromMicroseconds(1));
    }

    [Fact]
    public async Task Atualizar_ativo_deve_persistir_dados_e_ignorar_campos_protegidos()
    {
        var b = (await fixture.SemearBeneficiariosAsync(1)).Single();
        var antes = await LerAsync(b.Id);
        var dados = Dados(b, "INATIVO");
        dados["nome_completo"] = "  Nome Editado  ";
        dados["data_nascimento"] = "1980-02-03";
        dados["plano_id"] = Planos.Prata;
        foreach (var campo in new[] { "id", "cpf", "data_cadastro", "excluido_em" }) dados[campo] = "invalido";
        var resposta = await AtualizarAsync(b.Id, dados);
        Assert.Equal(HttpStatusCode.OK, resposta.StatusCode);
        var depois = await LerAsync(b.Id);
        Assert.Equal(antes with { NomeCompleto = "Nome Editado", DataNascimento = new(1980, 2, 3), PlanoId = Planos.Prata, Status = "INATIVO" }, depois);
        var consulta = await Client.GetAsync($"/beneficiarios/{b.Id}");
        Assert.Equal((await resposta.CorpoAsync()).GetRawText(), (await consulta.CorpoAsync()).GetRawText());
    }

    public static TheoryData<string, object?> ValoresInvalidos => new()
    {
        { "nome_completo", null }, { "nome_completo", "  " }, { "nome_completo", "ab" },
        { "nome_completo", new string('a', 121) }, { "data_nascimento", null },
        { "data_nascimento", DateTime.UtcNow.ToString("yyyy-MM-dd") },
        { "data_nascimento", DateTime.UtcNow.AddDays(1).ToString("yyyy-MM-dd") },
        { "data_nascimento", "data-invalida" }, { "plano_id", null }, { "plano_id", Guid.Empty },
        { "plano_id", "uuid-invalido" }, { "status", null }, { "status", "" },
        { "status", "ativo" }, { "status", "OUTRO" }, { "status", "0" }, { "status", "1" },
        { "status", 0 }, { "status", 1 }, { "status", true }
    };

    [Theory]
    [MemberData(nameof(ValoresInvalidos))]
    public async Task Atualizar_invalido_deve_devolver_400_sem_mutacao(string campo, object? valor)
    {
        var b = (await fixture.SemearBeneficiariosAsync(1)).Single();
        var antes = await LerAsync(b.Id);
        var dados = Dados(b);
        dados[campo] = valor;
        await ErroAsync(await AtualizarAsync(b.Id, dados), HttpStatusCode.BadRequest, campo);
        Assert.Equal(antes, await LerAsync(b.Id));
    }

    [Theory]
    [InlineData("nome_completo")]
    [InlineData("data_nascimento")]
    [InlineData("plano_id")]
    [InlineData("status")]
    public async Task Atualizar_com_campo_ausente_deve_devolver_400(string campo)
    {
        var b = (await fixture.SemearBeneficiariosAsync(1)).Single();
        var antes = await LerAsync(b.Id);
        var dados = Dados(b);
        dados.Remove(campo);
        await ErroAsync(await AtualizarAsync(b.Id, dados), HttpStatusCode.BadRequest, campo);
        Assert.Equal(antes, await LerAsync(b.Id));
    }

    [Fact]
    public async Task Atualizar_vazio_deve_indicar_quatro_campos_obrigatorios()
    {
        var b = (await fixture.SemearBeneficiariosAsync(1)).Single();
        var antes = await LerAsync(b.Id);
        var resposta = await AtualizarAsync(b.Id, new { });
        var erro = await ErroAsync(resposta, HttpStatusCode.BadRequest);
        var detalhes = erro.GetProperty("detalhes");
        Assert.Equal(new[] { "data_nascimento", "nome_completo", "plano_id", "status" },
            detalhes.EnumerateArray().Select(d => d.GetProperty("campo").GetString()).OrderBy(c => c));
        Assert.Equal(antes, await LerAsync(b.Id));
    }

    [Theory]
    [InlineData(3)]
    [InlineData(120)]
    public async Task Atualizar_deve_aceitar_limites_de_nome_e_data_passada_minima(int tamanho)
    {
        var b = (await fixture.SemearBeneficiariosAsync(1)).Single();
        var dados = Dados(b);
        dados["nome_completo"] = "  " + new string('a', tamanho) + "  ";
        dados["data_nascimento"] = "0001-01-01";
        Assert.Equal(HttpStatusCode.OK, (await AtualizarAsync(b.Id, dados)).StatusCode);
        var salvo = await LerAsync(b.Id);
        Assert.Equal(new string('a', tamanho), salvo.NomeCompleto);
        Assert.Equal(DateOnly.MinValue, salvo.DataNascimento);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Atualizar_com_plano_invalido_deve_devolver_422_sem_atualizacao_parcial(bool excluido)
    {
        var b = (await fixture.SemearBeneficiariosAsync(1)).Single();
        var antes = await LerAsync(b.Id);
        if (excluido) Assert.Equal(HttpStatusCode.NoContent, (await Client.DeleteAsync($"/planos/{Planos.Prata}")).StatusCode);
        var dados = Dados(b, "INATIVO");
        dados["nome_completo"] = "Outro Nome";
        dados["data_nascimento"] = "1980-01-01";
        dados["plano_id"] = excluido ? Planos.Prata : Planos.Inexistente;
        await ErroAsync(await AtualizarAsync(b.Id, dados), HttpStatusCode.UnprocessableEntity, "plano_id");
        Assert.Equal(antes, await LerAsync(b.Id));
    }

    [Theory]
    [InlineData("nome_completo", "INATIVO")]
    [InlineData("data_nascimento", "INATIVO")]
    [InlineData("plano_id", "INATIVO")]
    [InlineData("nome_completo", "ATIVO")]
    [InlineData("data_nascimento", "ATIVO")]
    [InlineData("plano_id", "ATIVO")]
    public async Task Inativo_deve_recusar_alteracao_mesmo_com_reativacao(string campo, string status)
    {
        var b = (await fixture.SemearBeneficiariosAsync(1, status: "INATIVO")).Single();
        var antes = await LerAsync(b.Id);
        var dados = Dados(b, status);
        dados[campo] = campo switch { "nome_completo" => "Outro Nome", "data_nascimento" => "1980-01-01", _ => Planos.Prata };
        await ErroAsync(await AtualizarAsync(b.Id, dados), HttpStatusCode.Conflict);
        Assert.Equal(antes, await LerAsync(b.Id));
    }

    [Theory]
    [InlineData("INATIVO")]
    [InlineData("ATIVO")]
    public async Task Inativo_deve_permitir_noop_ou_reativar_com_mesmos_dados(string status)
    {
        var b = (await fixture.SemearBeneficiariosAsync(1, status: "INATIVO")).Single();
        var antes = await LerAsync(b.Id);
        var dados = Dados(b, status);
        dados["nome_completo"] = "  " + b.NomeCompleto + "  ";
        Assert.Equal(HttpStatusCode.OK, (await AtualizarAsync(b.Id, dados)).StatusCode);
        Assert.Equal(antes with { Status = status }, await LerAsync(b.Id));
        if (status == "ATIVO")
        {
            dados["nome_completo"] = "Nome Apos Reativacao";
            Assert.Equal(HttpStatusCode.OK, (await AtualizarAsync(b.Id, dados)).StatusCode);
            Assert.Equal("Nome Apos Reativacao", (await LerAsync(b.Id)).NomeCompleto);
        }
    }

    [Fact]
    public async Task Inativo_com_plano_excluido_deve_recusar_reativacao_sem_excecao_de_vinculo_historico()
    {
        var b = (await fixture.SemearBeneficiariosAsync(1, status: "INATIVO")).Single();
        var antes = await LerAsync(b.Id);
        Assert.Equal(HttpStatusCode.NoContent, (await Client.DeleteAsync($"/planos/{b.PlanoId}")).StatusCode);
        await ErroAsync(await AtualizarAsync(b.Id, Dados(b, "ATIVO")), HttpStatusCode.UnprocessableEntity, "plano_id");
        Assert.Equal(antes, await LerAsync(b.Id));
        var dados = Dados(b, "ATIVO");
        dados["plano_id"] = Planos.Prata;
        await ErroAsync(await AtualizarAsync(b.Id, dados), HttpStatusCode.Conflict);
        Assert.Equal(antes, await LerAsync(b.Id));
    }

    [Theory]
    [InlineData("ATIVO")]
    [InlineData("INATIVO")]
    public async Task Excluir_deve_preservar_linha_reservar_cpf_e_ocultar_em_todos_endpoints(string status)
    {
        var b = (await fixture.SemearBeneficiariosAsync(1, status: status)).Single();
        var outro = (await fixture.SemearBeneficiariosAsync(1, primeiraSemente: 900)).Single();
        var antes = await LerAsync(b.Id);
        var inicio = DateTime.UtcNow;
        var resposta = await Client.DeleteAsync($"/beneficiarios/{b.Id}");
        var fim = DateTime.UtcNow;
        Assert.Equal(HttpStatusCode.NoContent, resposta.StatusCode);
        Assert.Empty(await resposta.Content.ReadAsByteArrayAsync());
        var depois = await LerAsync(b.Id);
        Assert.NotNull(depois.ExcluidoEm);
        Assert.Equal(DateTimeKind.Utc, depois.ExcluidoEm.Value.Kind);
        Assert.InRange(depois.ExcluidoEm.Value, inicio, fim);
        Assert.Equal(antes with { ExcluidoEm = depois.ExcluidoEm }, depois);
        await ErroAsync(await Client.GetAsync($"/beneficiarios/{b.Id}"), HttpStatusCode.NotFound);
        await ErroAsync(await AtualizarAsync(b.Id, Dados(b)), HttpStatusCode.NotFound);
        await ErroAsync(await Client.DeleteAsync($"/beneficiarios/{b.Id}"), HttpStatusCode.NotFound);
        Assert.Equal(depois, await LerAsync(b.Id));
        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync($"/beneficiarios/{outro.Id}")).StatusCode);
        await fixture.UsarBancoAsync(async db =>
        {
            Assert.Equal(1, await db.Beneficiarios.CountAsync());
            Assert.Equal(2, await db.Beneficiarios.IgnoreQueryFilters().CountAsync());
        });
        var lista = await (await Client.GetAsync("/beneficiarios")).CorpoAsync();
        var itens = lista.ValueKind == JsonValueKind.Array ? lista : lista.GetProperty("dados");
        Assert.DoesNotContain(itens.EnumerateArray(), item => item.GetProperty("id").GetGuid() == b.Id);
        await ErroAsync(await Client.PostAsync("/beneficiarios", Http.Json(new
        {
            NomeCompleto = "Outro Beneficiario", Cpf = b.Cpf, DataNascimento = "1990-01-01", PlanoId = Planos.Prata
        })), HttpStatusCode.Conflict, "cpf");
        Assert.Equal(depois, await LerAsync(b.Id));
    }

    [Fact]
    public async Task Recursos_ausentes_devem_devolver_404_estruturado()
    {
        var id = Guid.NewGuid();
        await ErroAsync(await Client.GetAsync($"/beneficiarios/{id}"), HttpStatusCode.NotFound);
        var b = new BeneficiarioSemeado(id, "Nome Valido", "52998224725", new(1990, 1, 1), "ATIVO", Planos.Bronze);
        await ErroAsync(await AtualizarAsync(id, Dados(b)), HttpStatusCode.NotFound);
        await ErroAsync(await Client.DeleteAsync($"/beneficiarios/{id}"), HttpStatusCode.NotFound);
    }

    public sealed record Estado(Guid Id, string NomeCompleto, string Cpf, DateOnly DataNascimento,
        string Status, Guid PlanoId, DateTime DataCadastro, DateTime? ExcluidoEm);
}
