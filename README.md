# CSV to SQL Converter

Uma aplicação Single Page (SPA) de alta performance desenvolvida com Angular 21 para converter dados CSV em instruções SQL INSERT.

Este projeto foi prototipado para rodar inteiramente no Client-side, garantindo privacidade e velocidade, sem necessidade de backend ou chaves de API.

## Tecnologias

- **Framework:** Angular 21 (Standalone Components)  
- **State Management:** Angular Signals (signal, computed, effect)  
- **Build Tool:** Vite (via Angular CLI)  
- **Estilização:** Tailwind CSS  
- **Linguagem:** TypeScript 5.8  

## Funcionalidades

- **Conversão Reativa:** Utiliza a arquitetura de Signals para converter o input CSV em SQL instantaneamente ao digitar ou colar.  
- **Processamento Local:** Toda a lógica de parseamento e geração de strings roda no navegador do usuário.  
- **Leve e Rápido:** Sem dependências pesadas de IA ou serviços de nuvem.  

## Como rodar o projeto

### Pré-requisitos

- Node.js (v18 ou superior)

### Instalação das dependências

```bash
npm install
````

### Executar o servidor de desenvolvimento

```bash
npm run dev
# ou
ng serve
```

### Acesso

Abra o navegador em:
[http://localhost:4200](http://localhost:4200)

## Arquitetura

O projeto não utiliza RxJS complexo (BehaviorSubjects) para o fluxo de dados principal, optando pela nova primitiva reativa do Angular:
