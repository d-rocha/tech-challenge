namespace Desafio.Api.Dominio;

public sealed record DetalheErro(string Campo, string Regra);

public abstract class ExcecaoDeDominio : Exception
{
    protected ExcecaoDeDominio(string erro, string mensagem, IReadOnlyList<DetalheErro>? detalhes)
        : base(mensagem)
    {
        Erro = erro;
        Detalhes = detalhes ?? [];
    }

    public string Erro { get; }

    public IReadOnlyList<DetalheErro> Detalhes { get; }

    public abstract int StatusCode { get; }
}

public sealed class ValidacaoException(string mensagem, IReadOnlyList<DetalheErro>? detalhes = null)
    : ExcecaoDeDominio("ValidacaoInvalida", mensagem, detalhes)
{
    public override int StatusCode => 400;
}

public sealed class NaoEncontradoException(string mensagem)
    : ExcecaoDeDominio("NaoEncontrado", mensagem, null)
{
    public override int StatusCode => 404;
}

public sealed class ConflitoException(string mensagem, IReadOnlyList<DetalheErro>? detalhes = null)
    : ExcecaoDeDominio("Conflito", mensagem, detalhes)
{
    public override int StatusCode => 409;
}

public sealed class NaoProcessavelException(string mensagem, IReadOnlyList<DetalheErro>? detalhes = null)
    : ExcecaoDeDominio("NaoProcessavel", mensagem, detalhes)
{
    public override int StatusCode => 422;
}
