# MPII Hub 2.0 — Fundação

## Princípios

1. O MPII Hub é o SaaS; PDV, Estoque, Logística, Montagem etc. são módulos.
2. Cada empresa é um tenant isolado.
3. O produto não depende do SKU como identidade primária.
4. Identificadores externos (SKU, código do fornecedor, código interno, código de barras) são referências.
5. O PDV nunca deve bloquear uma venda só porque o cadastro do produto está incompleto.
6. Produto incompleto vira pendência administrativa.
7. Regras de negócio críticas ficam no backend/banco, não espalhadas pelos componentes React.
8. O motor de interpretação inicial é determinístico e não usa IA.

## Fluxo do produto no PDV

```
Entrada do vendedor
      |
      v
Identificador (SKU/EAN/código)
      |
      v
Resolver identificador
      |
  +---+---+
  |       |
achou   não achou
  |       |
  |       v
  |   cria produto
  |   incompleto
  |       |
  +---+---+
      |
      v
Produto disponível no pedido
```

## Interpretação sem IA

O interpretador trabalha em camadas:

- normalização de acentos e separadores;
- abreviações configuradas;
- extração de variações;
- chave de modelo;
- similaridade de texto;
- similaridade por tokens;
- categoria, marca e fornecedor como sinais adicionais.

Thresholds iniciais:

- 90–100: associação automática;
- 70–89: sugestão para confirmação;
- 0–69: não associar.

Esses valores serão calibrados com dados reais antes de serem tratados como regra definitiva.

## Banco

A V2 introduz:

- `produto_modelos`: agrupamento comercial de produtos relacionados;
- `produto_identificadores`: identidade externa por empresa;
- `produtos.modelo_id`: vínculo opcional com o modelo;
- `produtos.cadastro_status`: completo, incompleto ou pendente.

A resolução é idempotente e protegida por unicidade por empresa + tipo + valor normalizado.

## Próxima etapa

1. Validar/aplicar a migration em ambiente de desenvolvimento.
2. Testar o fluxo de SKU inexistente no PDV.
3. Criar tela de pendências de produtos.
4. Criar tela de organização por modelo.
5. Separar o restante do domínio em módulos V2.
6. Depois iniciar o onboarding SaaS e Platform Admin.
