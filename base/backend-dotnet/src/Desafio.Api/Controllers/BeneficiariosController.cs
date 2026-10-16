using Desafio.Api.Api.Contratos;
using Desafio.Api.Aplicacao;
using Desafio.Api.Infraestrutura;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Desafio.Api.Controllers;

[ApiController]
[Route("beneficiarios")]
[Produces("application/json")]
public class BeneficiariosController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly BeneficiarioServico _servico;

    public BeneficiariosController(AppDbContext db, BeneficiarioServico servico)
    {
        _db = db;
        _servico = servico;
    }

    [HttpPost]
    [ProducesResponseType<BeneficiarioResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status409Conflict)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status422UnprocessableEntity)]
    public async Task<IActionResult> Criar([FromBody] BeneficiarioRequest requisicao, CancellationToken cancellationToken)
    {
        var dados = new BeneficiarioRequestDados(
            requisicao.NomeCompleto, requisicao.Cpf, requisicao.DataNascimento, requisicao.PlanoId);
        var beneficiario = await _servico.CriarAsync(dados, cancellationToken);

        return Created($"/beneficiarios/{beneficiario.Id}", BeneficiarioResponse.De(beneficiario));
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType<BeneficiarioResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Obter(Guid id, CancellationToken cancellationToken)
    {
        var beneficiario = await _servico.ObterAsync(id, cancellationToken);

        return Ok(BeneficiarioResponse.De(beneficiario));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType<BeneficiarioResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status409Conflict)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status422UnprocessableEntity)]
    public async Task<IActionResult> Atualizar(
        Guid id,
        [FromBody] BeneficiarioAtualizacaoRequest requisicao,
        CancellationToken cancellationToken)
    {
        var dados = new BeneficiarioAtualizacaoDados(
            requisicao.NomeCompleto, requisicao.DataNascimento, requisicao.PlanoId, requisicao.Status);
        var beneficiario = await _servico.AtualizarAsync(id, dados, cancellationToken);

        return Ok(BeneficiarioResponse.De(beneficiario));
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Excluir(Guid id, CancellationToken cancellationToken)
    {
        await _servico.ExcluirAsync(id, cancellationToken);

        return NoContent();
    }

    [HttpGet]
    public async Task<IActionResult> Listar()
    {
        var lista = await _db.Beneficiarios.ToListAsync();

        // O plano é resolvido aqui, e não na consulta principal, porque o FindAsync usa o
        // cache do contexto: a listagem continua fazendo uma única ida ao banco, qualquer
        // que seja o tamanho da página.
        foreach (var b in lista)
        {
            b.Plano = await _db.Planos.FindAsync(b.PlanoId);
        }

        return Ok(lista);
    }
}
