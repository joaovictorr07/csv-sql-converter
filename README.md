# CSV to SQL Converter

SPA em Angular 21 para importar arquivos CSV, configurar tabelas e relacionamentos, e gerar scripts SQL no navegador.

O projeto roda inteiramente no client-side. Não há backend, upload para terceiros ou dependência de API externa para o processamento dos dados.

## Tecnologias

- **Framework:** Angular 21 com Standalone Components
- **Estado:** Angular Signals
- **Build / Dev Server:** Angular CLI com builder moderno
- **UI:** Tailwind CSS via CDN
- **Linguagem:** TypeScript
- **Processamento pesado:** Web Worker

## Funcionalidades

- Importação de um ou mais arquivos CSV
- Detecção inicial de delimitador
- Reparse manual com delimitador configurável
- Mapeamento de colunas CSV para colunas SQL
- Suporte a `INSERT`, `UPDATE` e `DELETE`
- Suporte a configuração parent/child no mesmo arquivo ou entre arquivos
- Geração de SQL em background via Web Worker
- Loading global bloqueante durante a geração

## Como rodar

### Pré-requisitos

- Node.js 18+

### Instalar dependências

```bash
npm install
```

### Rodar em desenvolvimento

```bash
npm run dev
```

Por padrão, o projeto sobe em `http://localhost:3000`.

### Build de produção

```bash
npm run build
```

## Arquitetura Atual

### 1. Shell da aplicação

- `AppComponent` monta a tela principal
- `UploadComponent` recebe os CSVs
- `TableConfigComponent` concentra a configuração de cada tabela
- `AppLoadingOverlayComponent` renderiza o loading global da aplicação

### 2. Estado e coordenação

O estado principal fica em `StoreService`, que controla:

- tabelas importadas
- operação SQL selecionada
- SQL gerado
- estado de erro da geração
- estado de execução (`isGenerating`)

O store continua responsável pelo parsing e pelas configurações da UI, mas não executa mais a geração pesada diretamente.

### 3. Geração de SQL

A geração foi separada em três camadas:

- `sql-generation.ts`: lógica pura e reutilizável de montagem do SQL
- `sql-generation.worker.ts`: ponto de execução em background
- `SqlGenerationService`: ponte entre a aplicação e o worker

Fluxo:

1. a UI chama `store.generate()`
2. o store ativa o loading global
3. o `SqlGenerationService` cria o worker e envia um payload serializável
4. o worker executa `buildSql(...)`
5. o resultado volta para o store
6. o loading fecha e a UI atualiza o output

Não existe fallback para a main thread. Se o worker falhar, a operação falha, o SQL anterior é preservado e a UI exibe erro.

### 4. Loading global

O loading centralizado usa:

- `LoadingService` para estado global baseado em `signal`
- `AppLoadingOverlayComponent` para o overlay full-screen

Esse fluxo evita implementar spinners locais e mantém um contrato único para operações assíncronas bloqueantes.

## Estrutura relevante

```text
src/
  components/
    app-loading-overlay.component.ts
    table-config.component.ts
    upload.component.ts
  services/
    loading.service.ts
    sql-generation.service.ts
    store.service.ts
  types/
    loading.ts
    sql-generation.ts
    sql-operation.ts
  utils/
    sql-generation.ts
  workers/
    sql-generation.worker.ts
```

## Comportamento esperado na geração

- Ao iniciar a geração, a UI fica bloqueada por overlay global
- O botão de gerar fica desabilitado
- A ação de copiar também fica desabilitada
- Apenas uma geração pode ficar ativa por vez
- Em sucesso, o SQL exibido é substituído pelo novo resultado
- Em erro, o SQL anterior é mantido e a mensagem de falha aparece na área de geração

## Observações

- O worker recebe apenas dados serializáveis
- A lógica de SQL foi isolada para facilitar manutenção e testes futuros
- Upload e reparse continuam executando no fluxo principal; o uso de worker hoje cobre apenas a geração de SQL
