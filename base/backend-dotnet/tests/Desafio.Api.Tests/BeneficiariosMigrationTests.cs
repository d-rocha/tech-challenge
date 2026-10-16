using Desafio.Api.Infraestrutura;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace Desafio.Api.Tests;

[Collection(ColecaoDaApi.Nome)]
public class BeneficiariosMigrationTests(ApiFixture fixture)
{
    private const string Inicial = "20260726030944_Inicial";
    private const string Cpf = "52998224725";

    [Fact]
    public async Task Banco_novo_deve_aplicar_migration_e_garantir_cpf_unico()
    {
        await UsarBancoDescartavelAsync(async db =>
        {
            await db.Database.MigrateAsync();
            await CargaInicial.AplicarAsync(db);
            Assert.Contains(await db.Database.GetAppliedMigrationsAsync(), nome => nome.EndsWith("_CpfUnico"));

            var id = Guid.NewGuid();
            await InserirAsync(db, id);
            var erro = await Assert.ThrowsAsync<PostgresException>(() => InserirAsync(db, Guid.NewGuid()));
            Assert.Equal(PostgresErrorCodes.UniqueViolation, erro.SqlState);
            Assert.Equal("IX_Beneficiarios_Cpf", erro.ConstraintName);
            var salvo = await db.Beneficiarios.AsNoTracking().SingleAsync();
            Assert.Equal(id, salvo.Id);
            Assert.Null(db.Entry(salvo).Property<DateTime?>("ExcluidoEm").CurrentValue);
            await db.Database.ExecuteSqlAsync($"""UPDATE "Beneficiarios" SET "ExcluidoEm" = {DateTime.UtcNow} WHERE "Id" = {id}""");
            Assert.Empty(await db.Beneficiarios.ToListAsync());
            Assert.Equal(id, (await db.Beneficiarios.IgnoreQueryFilters().SingleAsync()).Id);
            var erroExcluido = await Assert.ThrowsAsync<PostgresException>(() => InserirAsync(db, Guid.NewGuid()));
            Assert.Equal(PostgresErrorCodes.UniqueViolation, erroExcluido.SqlState);
            Assert.Equal("IX_Beneficiarios_Cpf", erroExcluido.ConstraintName);
        });
    }

    [Fact]
    public async Task Atualizar_schema_inicial_deve_preservar_dados_e_recusar_duplicata()
    {
        await UsarBancoDescartavelAsync(async db =>
        {
            await db.GetService<IMigrator>().MigrateAsync(Inicial);
            await CargaInicial.AplicarAsync(db);
            var id = Guid.NewGuid();
            await InserirAsync(db, id);

            await db.Database.MigrateAsync();
            var salvo = await db.Beneficiarios.AsNoTracking().SingleAsync();
            Assert.Equal(id, salvo.Id);
            Assert.Equal(Cpf, salvo.Cpf);
            Assert.Equal("Maria Aparecida da Silva", salvo.NomeCompleto);
            Assert.Equal(Planos.Bronze, salvo.PlanoId);
            Assert.Equal(5, await db.Planos.CountAsync());
            Assert.Null(db.Entry(salvo).Property<DateTime?>("ExcluidoEm").CurrentValue);
            Assert.Contains(await db.Database.GetAppliedMigrationsAsync(), nome => nome.EndsWith("_ExclusaoLogicaBeneficiario"));
            Assert.Contains(await db.Database.GetAppliedMigrationsAsync(), nome => nome.EndsWith("_CpfUnico"));
            var erro = await Assert.ThrowsAsync<PostgresException>(() => InserirAsync(db, Guid.NewGuid()));
            Assert.Equal(PostgresErrorCodes.UniqueViolation, erro.SqlState);
            Assert.Equal("IX_Beneficiarios_Cpf", erro.ConstraintName);
        });
    }

    [Fact]
    public async Task Migration_com_duplicatas_deve_falhar_sem_apagar_ou_alterar_registros()
    {
        await UsarBancoDescartavelAsync(async db =>
        {
            await db.GetService<IMigrator>().MigrateAsync(Inicial);
            await CargaInicial.AplicarAsync(db);
            var ids = new[] { Guid.NewGuid(), Guid.NewGuid() };
            await InserirAsync(db, ids[0]);
            await InserirAsync(db, ids[1]);

            var erro = await Assert.ThrowsAsync<PostgresException>(() => db.Database.MigrateAsync());
            Assert.Equal(PostgresErrorCodes.UniqueViolation, erro.SqlState);
            var salvos = await LerSchemaInicialAsync(db);
            Assert.Equal(2, salvos.Count);
            Assert.All(ids, id => Assert.Contains(salvos, b => b.Id == id && b.Cpf == Cpf));
            Assert.All(salvos, b => Assert.Equal("Maria Aparecida da Silva", b.NomeCompleto));
            Assert.Equal(new[] { Inicial }, await db.Database.GetAppliedMigrationsAsync());
        });
    }

    [Fact]
    public async Task Reverter_migration_deve_remover_indice_sem_perder_registro()
    {
        await UsarBancoDescartavelAsync(async db =>
        {
            await db.Database.MigrateAsync();
            await CargaInicial.AplicarAsync(db);
            Assert.Contains(await db.Database.GetAppliedMigrationsAsync(), nome => nome.EndsWith("_CpfUnico"));
            var id = Guid.NewGuid();
            await InserirAsync(db, id);

            await db.GetService<IMigrator>().MigrateAsync(Inicial);
            Assert.Equal(id, (await LerSchemaInicialAsync(db)).Single().Id);
            Assert.Equal(new[] { Inicial }, await db.Database.GetAppliedMigrationsAsync());
            await InserirAsync(db, Guid.NewGuid());
            Assert.Equal(2, (await LerSchemaInicialAsync(db)).Count);
        });
    }

    [Fact]
    public async Task Migrar_de_cpf_unico_e_reverter_so_exclusao_deve_preservar_linha_e_indice()
    {
        await UsarBancoDescartavelAsync(async db =>
        {
            var cpfUnico = db.Database.GetMigrations().Single(nome => nome.EndsWith("_CpfUnico"));
            await db.GetService<IMigrator>().MigrateAsync(cpfUnico);
            await CargaInicial.AplicarAsync(db);
            var id = Guid.NewGuid();
            await InserirAsync(db, id);
            var antes = (await LerSchemaInicialAsync(db)).Single();

            await db.Database.MigrateAsync();
            Assert.Equal(antes, (await LerSchemaInicialAsync(db)).Single());
            var salvo = await db.Beneficiarios.AsNoTracking().SingleAsync();
            Assert.Null(db.Entry(salvo).Property<DateTime?>("ExcluidoEm").CurrentValue);

            await db.GetService<IMigrator>().MigrateAsync(cpfUnico);
            Assert.Equal(antes, (await LerSchemaInicialAsync(db)).Single());
            Assert.DoesNotContain(await db.Database.GetAppliedMigrationsAsync(), nome => nome.EndsWith("_ExclusaoLogicaBeneficiario"));
            var erro = await Assert.ThrowsAsync<PostgresException>(() => InserirAsync(db, Guid.NewGuid()));
            Assert.Equal(PostgresErrorCodes.UniqueViolation, erro.SqlState);
            Assert.Equal("IX_Beneficiarios_Cpf", erro.ConstraintName);
            var colunas = await db.Database.SqlQuery<string>($"""
                SELECT column_name AS "Value" FROM information_schema.columns
                WHERE table_name = 'Beneficiarios' AND column_name = 'ExcluidoEm'
                """).ToListAsync();
            Assert.Empty(colunas);
        });
    }

    // Verificações após rollback/falha usam somente colunas existentes na migration Inicial.
    private static Task<List<BeneficiarioSemeado>> LerSchemaInicialAsync(AppDbContext db) =>
        db.Database.SqlQuery<BeneficiarioSemeado>($"""
            SELECT "Id", "NomeCompleto", "Cpf", "DataNascimento", "Status", "PlanoId"
            FROM "Beneficiarios"
            """).ToListAsync();

    private static Task InserirAsync(AppDbContext db, Guid id) =>
        db.Database.ExecuteSqlAsync(
            $"""
             INSERT INTO "Beneficiarios"
               ("Id", "NomeCompleto", "Cpf", "DataNascimento", "Status", "PlanoId", "DataCadastro")
             VALUES
               ({id}, {"Maria Aparecida da Silva"}, {Cpf}, {new DateOnly(1990, 5, 12)}, {"ATIVO"},
                {Planos.Bronze}, {DateTime.UtcNow})
             """);

    private async Task UsarBancoDescartavelAsync(Func<AppDbContext, Task> acao)
    {
        string? conexaoDaFixture = null;
        await fixture.UsarBancoAsync(db =>
        {
            conexaoDaFixture = db.Database.GetConnectionString();
            return Task.CompletedTask;
        });

        var nome = "migration_" + Guid.NewGuid().ToString("N");
        await using var administrador = new NpgsqlConnection(conexaoDaFixture);
        await administrador.OpenAsync();
        await using (var criar = new NpgsqlCommand($"CREATE DATABASE \"{nome}\"", administrador))
        {
            await criar.ExecuteNonQueryAsync();
        }

        try
        {
            var conexao = new NpgsqlConnectionStringBuilder(conexaoDaFixture) { Database = nome }.ConnectionString;
            var opcoes = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(conexao).Options;
            await using var db = new AppDbContext(opcoes);
            await acao(db);
        }
        finally
        {
            // Banco exclusivo deste teste, dentro do PostgreSQL descartável da fixture.
            await using var apagar = new NpgsqlCommand($"DROP DATABASE \"{nome}\" WITH (FORCE)", administrador);
            await apagar.ExecuteNonQueryAsync();
        }
    }
}
