using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Desafio.Api.Tests;

[Collection(ColecaoDaApi.Nome)]
public class BeneficiariosCriacaoTests(ApiFixture fixture) : IAsyncLifetime
{
    private HttpClient Client => fixture.Client;

    public Task InitializeAsync() => fixture.LimparAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private static Dictionary<string, object?> DadosValidos() => new()
    {
        ["nome_completo"] = "Maria Aparecida da Silva",
        ["cpf"] = "52998224725",
        ["data_nascimento"] = "1990-05-12",
        ["plano_id"] = Planos.Bronze
    };

    [Fact]
    public async Task Criar_deve_gerar_campos_do_servidor_e_persistir_resposta_sem_navegacao()
    {
        var antes = DateTime.UtcNow;
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(DadosValidos()));
        var depois = DateTime.UtcNow;

        Assert.Equal(HttpStatusCode.Created, resposta.StatusCode);
        var corpo = await resposta.CorpoAsync();
        var id = corpo.GetProperty("id").GetGuid();
        Assert.NotEqual(Guid.Empty, id);
        Assert.Equal($"/beneficiarios/{id}", resposta.Headers.Location?.OriginalString);
        Assert.Equal("ATIVO", corpo.GetProperty("status").GetString());
        Assert.Equal("Maria Aparecida da Silva", corpo.GetProperty("nome_completo").GetString());
        Assert.Equal("52998224725", corpo.GetProperty("cpf").GetString());
        Assert.Equal("1990-05-12", corpo.GetProperty("data_nascimento").GetString());
        Assert.Equal(Planos.Bronze, corpo.GetProperty("plano_id").GetGuid());
        var cadastro = corpo.GetProperty("data_cadastro").GetDateTime();
        Assert.Equal(DateTimeKind.Utc, cadastro.Kind);
        Assert.InRange(cadastro, antes, depois);
        Assert.False(corpo.TryGetProperty("plano", out _));
        Assert.Equal(7, corpo.EnumerateObject().Count());

        await fixture.UsarBancoAsync(async db =>
        {
            var salvo = await db.Beneficiarios.AsNoTracking().SingleAsync();
            Assert.Equal(id, salvo.Id);
            Assert.Equal("52998224725", salvo.Cpf);
            Assert.Equal("Maria Aparecida da Silva", salvo.NomeCompleto);
            Assert.Equal(new DateOnly(1990, 5, 12), salvo.DataNascimento);
            Assert.Equal(Planos.Bronze, salvo.PlanoId);
            Assert.Equal("ATIVO", salvo.Status.ToString());
            // PostgreSQL armazena timestamps com precisão de microssegundos.
            Assert.InRange(Math.Abs((salvo.DataCadastro - cadastro).Ticks), 0, 10);
        });
    }

    [Theory]
    [InlineData("INATIVO")]
    [InlineData("DESCONHECIDO")]
    [InlineData(123)]
    public async Task Criar_deve_ignorar_status_id_e_cadastro_enviados_pelo_cliente(object status)
    {
        var dados = DadosValidos();
        var idForjado = Guid.NewGuid();
        dados["id"] = idForjado;
        dados["status"] = status;
        dados["data_cadastro"] = "2000-01-01T00:00:00Z";

        var antes = DateTime.UtcNow;
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(dados));
        Assert.Equal(HttpStatusCode.Created, resposta.StatusCode);
        var corpo = await resposta.CorpoAsync();
        Assert.NotEqual(idForjado, corpo.GetProperty("id").GetGuid());
        Assert.Equal("ATIVO", corpo.GetProperty("status").GetString());
        Assert.InRange(corpo.GetProperty("data_cadastro").GetDateTime(), antes, DateTime.UtcNow);

        await fixture.UsarBancoAsync(async db =>
        {
            var salvo = await db.Beneficiarios.AsNoTracking().SingleAsync();
            Assert.Equal(corpo.GetProperty("id").GetGuid(), salvo.Id);
            Assert.Equal("ATIVO", salvo.Status.ToString());
            Assert.InRange(salvo.DataCadastro, antes.AddMilliseconds(-1), DateTime.UtcNow);
        });
    }

    [Theory]
    [InlineData("id")]
    [InlineData("data_cadastro")]
    public async Task Criar_deve_ignorar_campos_do_servidor_mesmo_com_formato_invalido(string campo)
    {
        var dados = DadosValidos();
        dados[campo] = "valor-invalido";
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(dados));
        Assert.Equal(HttpStatusCode.Created, resposta.StatusCode);
        var corpo = await resposta.CorpoAsync();
        Assert.NotEqual(Guid.Empty, corpo.GetProperty("id").GetGuid());
        Assert.InRange(corpo.GetProperty("data_cadastro").GetDateTime(), DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow);
    }

    [Theory]
    [InlineData("71428793860")]
    [InlineData("39053344705")]
    [InlineData("16899535009")]
    [InlineData("87748248800")]
    [InlineData("11144477735")]
    [InlineData("00000000191")]
    public async Task Criar_deve_aceitar_cpfs_validos_com_verificadores_distintos(string cpf)
    {
        var dados = DadosValidos();
        dados["cpf"] = cpf;
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(dados));
        Assert.Equal(HttpStatusCode.Created, resposta.StatusCode);
        Assert.Equal(cpf, (await resposta.CorpoAsync()).GetProperty("cpf").GetString());
    }

    [Theory]
    [InlineData("nome_completo")]
    [InlineData("cpf")]
    [InlineData("data_nascimento")]
    [InlineData("plano_id")]
    public async Task Criar_sem_campo_obrigatorio_deve_recusar_sem_persistir(string campo)
    {
        var dados = DadosValidos();
        dados.Remove(campo);
        await RecusarAsync(dados, HttpStatusCode.BadRequest, campo);
    }

    [Theory]
    [InlineData("nome_completo")]
    [InlineData("cpf")]
    [InlineData("data_nascimento")]
    [InlineData("plano_id")]
    public async Task Criar_com_campo_nulo_deve_recusar_sem_persistir(string campo)
    {
        var dados = DadosValidos();
        dados[campo] = null;
        await RecusarAsync(dados, HttpStatusCode.BadRequest, campo);
    }

    [Fact]
    public async Task Criar_sem_dados_deve_detalhar_todos_os_campos_obrigatorios_sem_persistir()
    {
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(new { }));
        Assert.Equal(HttpStatusCode.BadRequest, resposta.StatusCode);
        var corpo = await resposta.CorpoAsync();
        var campos = corpo.GetProperty("detalhes").EnumerateArray()
            .Select(detalhe => detalhe.GetProperty("campo").GetString())
            .OrderBy(campo => campo)
            .ToArray();
        Assert.Equal(new[] { "cpf", "data_nascimento", "nome_completo", "plano_id" }, campos);
        await fixture.UsarBancoAsync(async db => Assert.Equal(0, await db.Beneficiarios.CountAsync()));
    }

    [Theory]
    [InlineData("")]
    [InlineData("5299822472")]
    [InlineData("529982247255")]
    [InlineData("529.982.247-25")]
    [InlineData("abcdefghijk")]
    [InlineData("５２９９８２２４７２５")]
    [InlineData("52998224724")]
    [InlineData("52998224735")]
    [InlineData(" 52998224725")]
    [InlineData("52998224725 ")]
    [InlineData("00000000000")]
    [InlineData("11111111111")]
    [InlineData("22222222222")]
    [InlineData("33333333333")]
    [InlineData("44444444444")]
    [InlineData("55555555555")]
    [InlineData("66666666666")]
    [InlineData("77777777777")]
    [InlineData("88888888888")]
    [InlineData("99999999999")]
    public async Task Criar_com_cpf_invalido_deve_detalhar_campo(string cpf)
    {
        var dados = DadosValidos();
        dados["cpf"] = cpf;
        await RecusarAsync(dados, HttpStatusCode.BadRequest, "cpf");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(121)]
    public async Task Criar_com_nome_fora_dos_limites_deve_detalhar_campo(int tamanho)
    {
        var dados = DadosValidos();
        dados["nome_completo"] = new string('a', tamanho);
        await RecusarAsync(dados, HttpStatusCode.BadRequest, "nome_completo");
    }

    [Fact]
    public async Task Criar_com_nome_em_branco_deve_detalhar_campo()
    {
        var dados = DadosValidos();
        dados["nome_completo"] = "   ";
        await RecusarAsync(dados, HttpStatusCode.BadRequest, "nome_completo");
    }

    [Theory]
    [InlineData(3)]
    [InlineData(120)]
    public async Task Criar_deve_aceitar_limites_do_nome_e_remover_espacos_externos(int tamanho)
    {
        var dados = DadosValidos();
        var nome = new string('a', tamanho);
        dados["nome_completo"] = $"  {nome}  ";
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(dados));
        Assert.Equal(HttpStatusCode.Created, resposta.StatusCode);
        Assert.Equal(nome, (await resposta.CorpoAsync()).GetProperty("nome_completo").GetString());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public async Task Criar_com_nascimento_hoje_ou_futuro_deve_detalhar_campo(int dias)
    {
        var dados = DadosValidos();
        dados["data_nascimento"] = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(dias).ToString("yyyy-MM-dd");
        await RecusarAsync(dados, HttpStatusCode.BadRequest, "data_nascimento");
    }

    [Fact]
    public async Task Criar_com_nascimento_ontem_deve_aceitar()
    {
        var dados = DadosValidos();
        dados["data_nascimento"] = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1).ToString("yyyy-MM-dd");
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(dados));
        Assert.Equal(HttpStatusCode.Created, resposta.StatusCode);
    }

    [Theory]
    [InlineData("2020-02-30")]
    [InlineData("12/05/1990")]
    public async Task Criar_com_nascimento_malformado_deve_detalhar_campo(string data)
    {
        var dados = DadosValidos();
        dados["data_nascimento"] = data;
        await RecusarAsync(dados, HttpStatusCode.BadRequest, "data_nascimento");
    }

    [Theory]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("nao-e-uuid")]
    public async Task Criar_com_plano_id_invalido_deve_detalhar_campo(string plano)
    {
        var dados = DadosValidos();
        dados["plano_id"] = plano;
        await RecusarAsync(dados, HttpStatusCode.BadRequest, "plano_id");
    }

    [Fact]
    public async Task Criar_com_plano_inexistente_deve_detalhar_422()
    {
        var dados = DadosValidos();
        dados["plano_id"] = Planos.Inexistente;
        await RecusarAsync(dados, HttpStatusCode.UnprocessableEntity, "plano_id");
    }

    [Fact]
    public async Task Criar_com_plano_excluido_deve_detalhar_422()
    {
        var exclusao = await Client.DeleteAsync($"/planos/{Planos.Bronze}");
        Assert.Equal(HttpStatusCode.NoContent, exclusao.StatusCode);
        await RecusarAsync(DadosValidos(), HttpStatusCode.UnprocessableEntity, "plano_id");
    }

    [Fact]
    public async Task Criar_com_cpf_duplicado_deve_detalhar_409_e_manter_uma_linha()
    {
        var criacao = await Client.PostAsync("/beneficiarios", Http.Json(DadosValidos()));
        Assert.Equal(HttpStatusCode.Created, criacao.StatusCode);
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(DadosValidos()));
        await ConferirErroAsync(resposta, HttpStatusCode.Conflict, "cpf");
        await fixture.UsarBancoAsync(async db => Assert.Equal(1, await db.Beneficiarios.CountAsync()));
    }

    [Fact]
    public async Task Criar_com_json_malformado_deve_devolver_envelope_400()
    {
        var resposta = await Client.PostAsync("/beneficiarios", new StringContent("{", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, resposta.StatusCode);
        var corpo = await resposta.CorpoAsync();
        Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("erro").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("mensagem").GetString()));
        Assert.NotEmpty(corpo.GetProperty("detalhes").EnumerateArray());
        await fixture.UsarBancoAsync(async db => Assert.Equal(0, await db.Beneficiarios.CountAsync()));
    }

    private async Task RecusarAsync(Dictionary<string, object?> dados, HttpStatusCode status, string campo)
    {
        var resposta = await Client.PostAsync("/beneficiarios", Http.Json(dados));
        await ConferirErroAsync(resposta, status, campo);
        await fixture.UsarBancoAsync(async db => Assert.Equal(0, await db.Beneficiarios.CountAsync()));
    }

    private static async Task ConferirErroAsync(HttpResponseMessage resposta, HttpStatusCode status, string campo)
    {
        Assert.Equal(status, resposta.StatusCode);
        Assert.Equal("application/json", resposta.Content.Headers.ContentType?.MediaType);
        var corpo = await resposta.CorpoAsync();
        Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("erro").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(corpo.GetProperty("mensagem").GetString()));
        var detalhes = corpo.GetProperty("detalhes").EnumerateArray().ToList();
        Assert.Contains(detalhes, detalhe => detalhe.GetProperty("campo").GetString() == campo);
        Assert.All(detalhes, detalhe => Assert.False(string.IsNullOrWhiteSpace(detalhe.GetProperty("regra").GetString())));
    }
}
