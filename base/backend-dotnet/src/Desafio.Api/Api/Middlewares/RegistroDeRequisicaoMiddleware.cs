using System.Diagnostics;
using Microsoft.AspNetCore.Routing;

namespace Desafio.Api.Api.Middlewares;

public sealed class RegistroDeRequisicaoMiddleware(
    RequestDelegate proximo,
    ILogger<RegistroDeRequisicaoMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext contexto)
    {
        var inicio = Stopwatch.GetTimestamp();
        try
        {
            await proximo(contexto);
        }
        finally
        {
            var rota = (contexto.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText
                ?? "rota_nao_identificada";
            logger.LogInformation(
                "Requisição concluída. Método: {Metodo}. Rota: {Rota}. Status: {StatusCode}. Duração: {DuracaoMs} ms",
                contexto.Request.Method,
                rota,
                contexto.Response.StatusCode,
                Stopwatch.GetElapsedTime(inicio).TotalMilliseconds);
        }
    }
}
