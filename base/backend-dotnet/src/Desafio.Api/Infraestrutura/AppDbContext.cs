using Desafio.Api.Dominio;
using Microsoft.EntityFrameworkCore;

namespace Desafio.Api.Infraestrutura;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public const string IndiceCpfUnico = "IX_Beneficiarios_Cpf";

    public DbSet<Plano> Planos => Set<Plano>();

    public DbSet<Beneficiario> Beneficiarios => Set<Beneficiario>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Plano>(entidade =>
        {
            entidade.HasKey(p => p.Id);
            entidade.Property(p => p.Nome).HasMaxLength(60).IsRequired();
            entidade.Property(p => p.CodigoRegistroAns).HasMaxLength(6).IsRequired();
            entidade.HasIndex(p => p.Nome).IsUnique();
            entidade.HasIndex(p => p.CodigoRegistroAns).IsUnique();
            entidade.HasQueryFilter(p => p.ExcluidoEm == null);
        });

        modelBuilder.Entity<Beneficiario>(entidade =>
        {
            entidade.HasKey(b => b.Id);
            entidade.Property(b => b.NomeCompleto).HasMaxLength(120).IsRequired();
            entidade.Property(b => b.Cpf).HasMaxLength(11).IsRequired();
            entidade.HasIndex(b => b.Cpf).IsUnique().HasDatabaseName(IndiceCpfUnico);
            entidade.Property(b => b.Status).HasConversion<string>().HasMaxLength(10).IsRequired().IsConcurrencyToken();
            entidade.Property(b => b.ExcluidoEm).IsConcurrencyToken();
            entidade.HasQueryFilter(b => b.ExcluidoEm == null);
            entidade.HasOne(b => b.Plano)
                .WithMany()
                .HasForeignKey(b => b.PlanoId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
