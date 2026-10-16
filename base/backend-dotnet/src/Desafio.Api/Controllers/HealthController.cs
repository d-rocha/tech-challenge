using Desafio.Api.Api.Contratos;
using Desafio.Api.Infraestrutura;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Desafio.Api.Controllers;

[ApiController]
[Route("health")]
[Produces("application/json")]
[ProducesResponseType<ErroResponse>(StatusCodes.Status500InternalServerError)]
public class HealthController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<HealthResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<HealthResponse>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Obter(CancellationToken cancellationToken)
    {
        var bancoDisponivel = await db.Database.CanConnectAsync(cancellationToken);

        var resposta = new HealthResponse(
            bancoDisponivel ? "ok" : "indisponivel",
            bancoDisponivel ? "ok" : "indisponivel");

        return bancoDisponivel
            ? Ok(resposta)
            : StatusCode(StatusCodes.Status503ServiceUnavailable, resposta);
    }
}
