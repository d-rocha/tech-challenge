using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Desafio.Api.Infraestrutura.Migrations
{
    /// <inheritdoc />
    public partial class CpfUnico : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Beneficiarios_Cpf",
                table: "Beneficiarios",
                column: "Cpf",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Beneficiarios_Cpf",
                table: "Beneficiarios");
        }
    }
}
