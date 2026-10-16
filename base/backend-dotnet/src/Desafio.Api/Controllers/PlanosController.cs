using Desafio.Api.Api.Contratos;
using Desafio.Api.Aplicacao;
using Microsoft.AspNetCore.Mvc;

namespace Desafio.Api.Controllers;

[ApiController]
[Route("planos")]
[Produces("application/json")]
[ProducesResponseType<ErroResponse>(StatusCodes.Status500InternalServerError)]
public class PlanosController(PlanoServico servico) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<IEnumerable<PlanoResponse>>(StatusCodes.Status200OK)]
    public async Task<IActionResult> Listar(CancellationToken cancellationToken)
    {
        var planos = await servico.ListarAsync(cancellationToken);

        return Ok(planos.Select(PlanoResponse.De).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType<PlanoResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Obter(Guid id, CancellationToken cancellationToken)
    {
        var plano = await servico.ObterAsync(id, cancellationToken);

        return Ok(PlanoResponse.De(plano));
    }

    [HttpPost]
    [ProducesResponseType<PlanoResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Criar([FromBody] PlanoRequest requisicao, CancellationToken cancellationToken)
    {
        var dados = new PlanoRequestDados(requisicao.Nome, requisicao.CodigoRegistroAns);
        var plano = await servico.CriarAsync(dados, cancellationToken);

        return CreatedAtAction(nameof(Obter), new { id = plano.Id }, PlanoResponse.De(plano));
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType<PlanoResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Atualizar(
        Guid id,
        [FromBody] PlanoRequest requisicao,
        CancellationToken cancellationToken)
    {
        var dados = new PlanoRequestDados(requisicao.Nome, requisicao.CodigoRegistroAns);
        var plano = await servico.AtualizarAsync(id, dados, cancellationToken);

        return Ok(PlanoResponse.De(plano));
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ErroResponse>(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Excluir(Guid id, CancellationToken cancellationToken)
    {
        await servico.ExcluirAsync(id, cancellationToken);

        return NoContent();
    }
}
