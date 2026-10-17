# Entrega — Davi Oliveira

## 1. Resumo da entrega

Trabalhei na evolução do módulo de Beneficiários com apoio intenso de IA, mantendo .NET 10, Angular 20 e PostgreSQL 17. O módulo agora tem cadastro validado, consulta individual, atualização, exclusão lógica e listagem paginada com filtros combináveis. Na interface, é possível listar, filtrar, cadastrar, editar e confirmar uma exclusão, com mensagens dos erros retornados pela API. Mantive o módulo de Planos como referência do padrão existente.

Preparei a pasta de entrega com os três arquivos exigidos. O compose usa as imagens `nxtdoor/desafio-4tech-api:1.0.0` e `nxtdoor/desafio-4tech-web:1.0.0`, também declaradas no `info.json`. Confirmei o namespace `nxtdoor` durante a revisão. Publiquei as duas tags no Docker Hub e o pull sem login foi confirmado para `linux/amd64`. Os digests remotos correspondem às mesmas imagens validadas localmente. A API responde na porta 9999, a interface na 4200 e o PostgreSQL persiste em volume nomeado. Na subida, `Program.cs` aplica as migrations e `CargaInicial` prepara os planos, sem execução manual de SQL.

A validação local está concluída nas condições descritas abaixo.

## 2. Decisões

### 2.1 Defeitos encontrados e correções

O cadastro recebia a entidade diretamente, permitindo que o cliente influenciasse campos que deveriam ser definidos pelo servidor. Segui a separação entre entrada, domínio e resposta: `BeneficiarioContratos.cs` define os contratos, enquanto `Beneficiario.cs` encapsula o estado e valida nome, CPF, nascimento e plano. UUID, situação ATIVO e timestamp UTC são definidos no servidor. Isso evita, por exemplo, um cadastro criado com data arbitrária ou inicialmente INATIVO por dados enviados pelo cliente.

A consulta prévia de CPF também precisava de uma garantia no banco. Duas requisições podem consultar ao mesmo tempo e ambas encontrar o CPF disponível. A correção em `AppDbContext.cs` e na migration `CpfUnico` cria um índice único global; `BeneficiarioServico.cs` converte apenas a violação desse índice em erro 409. Os testes de concorrência usam uma barreira antes da gravação e conferem tanto a resposta HTTP quanto as linhas persistidas.

Preservei a diferença entre inativar e excluir. Um INATIVO continua consultável; um excluído deixa de aparecer nas consultas, mas mantém o CPF reservado. O campo `ExcluidoEm`, o filtro global e os testes de ciclo de vida sustentam esse comportamento. Os tokens de concorrência para situação e exclusão também impedem que uma edição baseada em estado antigo altere silenciosamente um cadastro recém-inativado.

### 2.2 Pontos que exigiram uma escolha

Mantive o plano excluído visível como vínculo histórico na listagem, sem permitir seu uso em novas gravações. Com isso, reativar um INATIVO ligado a um plano excluído retorna 422. Trocar o plano na mesma operação também esbarra no congelamento do cadastro INATIVO. Registrei essa consequência para não criar uma exceção ao contrato sem previsão na especificação.

Se um banco antigo já tiver CPFs duplicados, a migration falha sem apagar registros. Preferi preservar os dados: decidir qual cadastro corrigir exige analisar os registros existentes.

### 2.3 Divergências entre especificação e testes

Segui a SPEC nos pontos em que os testes fornecidos divergiam dela. O teste de paginação esperava tamanho padrão 20, mas o contrato exige 10. A expectativa foi corrigida, mantendo os 25 registros e as verificações de dados, tamanho e total.

Outro teste aceitava alteração do cadastro de INATIVO com 200. Ajustei esse comportamento com apoio da IA para exigir o 409 previsto e verificar que os dados permanecem intactos. O teste de CPF após exclusão também passou a exigir DELETE 204 antes de tentar reutilizar o CPF, evitando um resultado verde sem exclusão implementada. Não removi cobertura para fazer a suíte passar.

### 2.4 Escolhas de implementação e resultados

Mantive a contagem da listagem antes da paginação, com ordenação por nome e ID e projeção dos campos necessários, incluindo o nome histórico do plano. No frontend, leituras anteriores são canceladas, o formulário é preservado após erros e a navegação recupera a última página disponível quando o total diminui.

Acompanhei os resultados das verificações automatizadas, executadas com PostgreSQL real descartável, Karma e Playwright. O runner integrado isola recursos e portas da stack de desenvolvimento. Os resultados finais locais foram:

- 204 testes de backend e 15 da infraestrutura de automação;
- 71 testes de frontend;
- 20 cenários E2E, correspondentes a 10 cenários em dois viewports. Os dois cenários de input foram repetidos após os últimos ajustes, sem aumentar esse total para 22;
- 37 verificações do `verificar.sh` original contra as imagens locais finais, com isolamento de portas e proxy transparente para preservar os endereços lógicos. A persistência também foi conferida após recriar o container do banco, mantendo o volume.

Esses resultados comprovam o comportamento local exercitado. Depois da publicação, o pull anônimo das duas imagens passou e os digests remotos coincidiram com os das imagens locais testadas. A conferência usou cliente sem credenciais, mantendo o cache de camadas do Docker; não foi um download integral em máquina limpa. Angular permaneceu na versão 20 e Testcontainers na versão 4.

Na revisão das dependências, a auditoria npm caiu de 28 alertas, incluindo três críticos, para seis altos e nenhum crítico. Os seis restantes derivam de um problema de `braces` propagado na cadeia de ferramentas de desenvolvimento Karma. Na consulta feita durante essa etapa, as dependências npm de produção e os pacotes NuGet não apresentaram avisos listados. O [aviso de braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) foi registrado sem versão corrigida naquela consulta.

Corrigi os campos do formulário. O CPF ganhou máscara, filtragem numérica e placeholder; a API continua recebendo os 11 dígitos. O nome aceita letras Unicode, acentos, espaços, apóstrofos, hífens e pontos, entre 3 e 120 unidades UTF-16, compatíveis com `String.Length` do backend. Essa restrição adicional está no frontend e não impede chamadas diretas à API. A interpolação mantém o conteúdo como texto, sem executar o valor recebido. Não atribuo à validação do formulário uma proteção geral contra XSS ou ataques ao backend.

### 2.5 Pendências e limites da entrega

As imagens estão publicadas e o pull público foi confirmado; a abertura do PR permanece pendente. Também não tenho evidência de auditoria completa de acessibilidade, desempenho ou segurança. A persistência depende da manutenção do volume: removê-lo apaga os dados. Como o `verificar.sh` faz limpeza destrutiva, sua execução foi isolada da stack de desenvolvimento.

## 3. Uso de IA

### 3.1 Intensidade e ferramentas

Usei IA de forma intensa em todas as etapas da entrega. O Codex apoiou a leitura da especificação, o planejamento, a implementação, os testes, a execução das verificações e a documentação. BMad ajudou a organizar os roteiros de planejamento e revisão; agentes especializados apoiaram o backend, o frontend e a preparação operacional. Consultei também o Jev para recomendações de fluxo e skills, mantendo comigo a decisão de autorizar cada etapa.

A maior parte do código, dos testes e da documentação foi produzida com assistência de IA. Minha participação foi orientar o escopo, acompanhar os resultados e revisar as fases antes de aprovar os commits. Também subi a stack e validei a interface manualmente. Organizei a entrega dessa forma para acompanhar o que mudava e comparar o resultado com a especificação. Os pontos do backend que ainda preciso aprofundar estão descritos na seção 3.4.

### 3.2 Opções de prompts técnicos baseados na SPEC

Elaborei os três modelos abaixo nesta revisão, a partir da SPEC e do código inicial do desafio.

**1. Corrigir o contrato de criação e distribuir as responsabilidades**

```text
Analise o POST /beneficiarios do código inicial: o controller recebe Beneficiario, verifica apenas o comprimento do CPF e grava pelo AppDbContext. Compare esse fluxo com as seções 1, 2.3, 4, 5 e 7 da SPEC e implemente a correção seguindo o módulo de Planos, sem trocar frameworks ou alterar seu comportamento.

Separe DTO de entrada, regras de domínio, coordenação da persistência e DTO de resposta. Aceite nome_completo, cpf, data_nascimento e plano_id; campos extras id, status e data_cadastro não devem influenciar UUID, ATIVO e timestamp UTC gerados pelo servidor. Valide nome após trim entre 3 e 120 caracteres e CPF com 11 dígitos ASCII e verificadores válidos, rejeitando sequências repetidas. Exija nascimento anterior ao dia atual em UTC e plano obrigatório.

Exija 201 com Location no sucesso, 400 para validação, 409 para CPF duplicado e 422 para plano inexistente ou excluído, com erros estruturados. Use acesso assíncrono ao banco. Acrescente testes de campos extras, limites e falhas; explique as responsabilidades de cada camada e apresente os resultados efetivamente executados, indicando qualquer lacuna.
```

Eu usei esse prompt para avaliar onde termina o transporte de dados e onde começam as regras de negócio. Conferi principalmente se a criação continua correta quando alguém chama a API diretamente, enviando campos controlados pelo servidor.

**2. Garantir integridade, ciclo de vida e paginação consistente**

```text
Parta do módulo inicial de Beneficiários, que não possui índice único de CPF nem endpoints individuais, e complete as seções 2.3, 3 e 4 da SPEC. Preserve .NET 10, PostgreSQL 17 e o padrão de Planos.

Garanta CPF único inclusive entre planos e após exclusão, com índice e migration que preservem dados existentes. Teste duas criações simultâneas: uma deve persistir, a outra retornar 409; confira as linhas no banco. Converta somente a violação esperada em conflito.

Implemente GET individual, PUT e DELETE lógico com os códigos previstos. CPF permanece imutável; INATIVO permite mudar status, mas recusa alteração cadastral com 409. Excluídos ficam fora das consultas e do total, mantêm CPF reservado e retornam 404 em operações posteriores. Plano inexistente ou excluído deve gerar 422 em gravações.

Entregue filtros combináveis, padrões pagina=1 e tamanho=10 e envelope dados/pagina/tamanho/total filtrado. Retorne 400 para pagina menor que 1 ou tamanho fora de 1..100. Documente ordenação estável com desempate e teste página excedente com 200 vazio. Investigue o FindAsync em laço sem confiar no comentário: comprove que as consultas não crescem com os itens. Relate testes e decisões pendentes.
```

Eu avaliei com esse modelo se as garantias sobrevivem à concorrência e à persistência real. Também verifiquei a diferença entre INATIVO e excluído e a evidência usada para afirmar que a listagem evita consultas adicionais por item.

**3. Construir o fluxo de Beneficiários no Angular**

```text
No frontend inicial, Beneficiários aparece como bloco pendente, enquanto Planos já usa modelo tipado e serviço isolado. Implemente a seção 9 da SPEC seguindo essa referência e mantendo a versão Angular 19 ou 20 do projeto. Limite as mudanças à interface; registre eventual incompatibilidade da API que impedir a integração.

Crie contratos tipados e serviço de Beneficiários com o endereço da API injetado; componentes não acessam HttpClient diretamente. Consuma dados/pagina/tamanho/total e mostre nome, CPF, nascimento, situação e nome do plano. Combine filtros de situação e plano, permita navegar entre páginas e verifique filtros sucessivos.

Inclua cadastro por POST e edição por PUT, com CPF somente leitura na edição. Valide obrigatoriedade, formato do CPF e nascimento passado; envie CPF com 11 dígitos sem máscara. Mostre campo e motivo dos erros estruturados 400, 409 e 422, preservando o formulário para correção.

Remova a linha somente após DELETE 204; em falha, mantenha o item e avise. Trate carregamento, erro e lista vazia. Acrescente testes pertinentes e verifique os fluxos no navegador, distinguindo comportamento observado de verificações ainda pendentes. Não inclua publicação ou alterações de infraestrutura.
```

Eu usei essa opção para conferir se a tela respeita o contrato HTTP e comunica as falhas a quem a utiliza. Avaliei o fluxo completo, especialmente filtros consecutivos, correção de formulário recusado e exclusão que falha no servidor.

### 3.3 O que fiz sem IA

Criei a branch `entrega/davi-oliveira`, organizei o ambiente local e subi Docker, API, banco e frontend. Ao longo das fases, revisei as alterações e confrontei os cenários de teste e seus resultados com os requisitos da SPEC, conferindo se a entrega atendia ao comportamento pedido. Também percorri a interface para validar os fluxos manualmente e aprovei os commits após cada revisão.

Para a entrega, preparei as builds Docker e publiquei as imagens da API e do frontend no Docker Hub. Minha participação envolveu revisão dos requisitos, validação do comportamento e preparação da aplicação para execução e avaliação. A maior parte da implementação, a criação dos testes e a execução das verificações automatizadas tiveram assistência de IA; a revisão dos resultados e a decisão de aprovar cada fase ficaram comigo.

### 3.4 O que ainda preciso estudar

Meu próximo passo em C#/.NET é aprofundar os testes, a concorrência, o tratamento de falhas do banco e os filtros. Quero conseguir explicar, com exemplos do projeto, como os testes verificam o comportamento usando PostgreSQL real, por que consultar o CPF antes de salvar não substitui o índice único e como duas requisições simultâneas são tratadas. Também preciso entender melhor quais falhas de persistência viram respostas da API e como os filtros do EF Core afetam os registros retornados, a paginação e o total da listagem.

Para organizar esse estudo, vou acompanhar o cadastro do início ao fim: controller → DTO de entrada → serviço de aplicação → entidade de domínio → DTO de resposta. Em cada etapa, quero identificar a responsabilidade da camada, a regra aplicada e o teste que verifica esse comportamento. As respostas da seção 4, preparadas com apoio de IA, serão meu roteiro inicial; ainda preciso validá-las pessoalmente no código e nos testes para sustentar a explicação com segurança.

## 4. Perguntas de compreensão

As respostas abaixo registram minha leitura do código com apoio de IA e seguem o foco de estudo descrito na seção 3.4.

### 4.1 Concorrência

Na implementação que revisei, duas requisições podem consultar o mesmo CPF antes de qualquer gravação.
A pré-consulta em `BeneficiarioServico.CriarAsync` não elimina essa corrida.
`AppDbContext.cs` declara o índice único global `IX_Beneficiarios_Cpf`, criado pela migration `CpfUnico`.
O PostgreSQL aceita uma gravação e rejeita a outra com SQLSTATE 23505.
O filtro do catch exige `DbUpdateException`, `PostgresException` e o nome exato desse índice.
Somente essa combinação vira `ConflitoException`, traduzida em 409 com detalhe `cpf/duplicado`.
O índice inclui excluídos e inativos, reservando o CPF globalmente, inclusive entre planos.

### 4.2 Um defeito corrigido

Escolhi o POST que recebia `Beneficiario` diretamente e misturava entrada com estado persistido.
Os setters públicos deixavam o cliente enviar identidade, situação e data de cadastro.
Em uma integração real, isso permitiria criar um cadastro INATIVO ou com data arbitrária.
`Api/Contratos/BeneficiarioContratos.cs` agora recebe somente nome, CPF, nascimento e plano.
`Dominio/Beneficiario.cs` valida as invariantes e define UUID, ATIVO e timestamp UTC no servidor.
O controller devolve um DTO explícito, sem expor a navegação EF do plano.
`BeneficiariosCriacaoTests` verifica os campos controlados pelo servidor e as entradas inválidas.

### 4.3 O trecho mais complexo

Escolhi o método `Criar`, de `Controllers/BeneficiariosController.cs`, como trecho para estudar e explicar o fluxo de cadastro com apoio de IA.
`[HttpPost]`, junto da rota do controller, associa o método a `POST /beneficiarios`.
Na assinatura, `[FromBody] BeneficiarioRequest requisicao` recebe o JSON em um DTO com nome, CPF, nascimento e plano, separado da entidade persistida.
`CancellationToken cancellationToken` recebe o sinal de cancelamento, repassado na chamada ao serviço.
`new BeneficiarioRequestDados(...)` reúne os quatro campos da requisição no contrato de dados da aplicação.
`await _servico.CriarAsync(dados, cancellationToken)` chama o serviço injetado e aguarda o beneficiário criado; o controller não grava diretamente pelo EF Core.
No serviço, `new Beneficiario(...)` aplica as validações do domínio e define ID, situação ATIVO e data de cadastro UTC; o DTO de entrada apenas transporta os dados.
O serviço também verifica o plano e a existência do CPF e coordena a persistência, incluindo o tratamento da violação do índice único.
`BeneficiarioResponse.De(beneficiario)` mapeia os sete campos explícitos da resposta, sem incluir a propriedade de navegação do plano.
Por fim, `Created(...)` devolve HTTP 201, o corpo com esse DTO e o cabeçalho `Location` com `/beneficiarios/{id}`.
