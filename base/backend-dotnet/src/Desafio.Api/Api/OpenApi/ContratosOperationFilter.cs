using System.Globalization;
using System.Text.Json.Nodes;
using Desafio.Api.Controllers;
using Desafio.Api.Dominio;
using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Desafio.Api.Api.OpenApi;

public sealed class ContratosOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(BeneficiariosController) ||
            context.MethodInfo.Name != nameof(BeneficiariosController.Listar) ||
            operation.Parameters is null)
            return;

        // Runtime parsing keeps absence distinct from blanks; only the documentation is typed here.
        foreach (var parameter in operation.Parameters.OfType<OpenApiParameter>())
        {
            if (parameter.In != ParameterLocation.Query)
                continue;

            parameter.Schema = parameter.Name switch
            {
                "pagina" => Inteiro(1, int.MaxValue),
                "tamanho" => Inteiro(10, 100),
                "status" => context.SchemaGenerator.GenerateSchema(typeof(StatusBeneficiario), context.SchemaRepository),
                "plano_id" => context.SchemaGenerator.GenerateSchema(typeof(Guid), context.SchemaRepository),
                _ => parameter.Schema
            };
        }
    }

    private static OpenApiSchema Inteiro(int padrao, int maximo) => new()
    {
        Type = JsonSchemaType.Integer,
        Format = "int32",
        Default = JsonValue.Create(padrao),
        Minimum = "1",
        Maximum = maximo.ToString(CultureInfo.InvariantCulture)
    };
}
