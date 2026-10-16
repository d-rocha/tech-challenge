using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Desafio.Api.Infraestrutura.Migrations
{
    /// <inheritdoc />
    public partial class ExclusaoLogicaBeneficiario : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ExcluidoEm",
                table: "Beneficiarios",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ExcluidoEm",
                table: "Beneficiarios");
        }
    }
}
