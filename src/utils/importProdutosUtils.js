import { isValidGTIN, normalizeGTIN, normalizeSKU } from './gtinValidator';

/**
 * Normaliza SKU para comparação case-insensitive ignorando apenas espaços externos.
 * Preserva caracteres especiais como /, ., _, - e não remove pontuações.
 *
 * @param {any} sku
 * @returns {string}
 */
export const normalizeSkuForComparison = (sku) => {
  return String(sku || '').trim().toLowerCase();
};

/**
 * Normaliza SKU para persistência no banco.
 * Apenas trim de espaços externos.
 *
 * @param {any} sku
 * @returns {string}
 */
export const normalizeSkuForStorage = (sku) => {
  return normalizeSKU(sku);
};

/**
 * Validador completo da planilha de importação de produtos.
 * Executa pré-validação de todas as linhas antes de qualquer escrita no banco.
 *
 * @param {object} params
 * @param {Array<object>} params.rows Linhas parsed do CSV
 * @param {Array<object>} [params.produtosExistentes=[]] Produtos já cadastrados no tenant
 * @param {string} params.organizationId ID da organização atual
 * @returns {object} Resultado detalhado da validação
 */
export const validateImportPlanilha = ({ rows = [], produtosExistentes = [], organizationId }) => {
  const errors = [];
  const skuToRows = new Map(); // normalizedSku -> array de { linha, row }
  const eanToRows = new Map(); // ean -> array de { linha, sku, row }

  if (!organizationId) {
    errors.push({
      linha: 0,
      campo: 'organization_id',
      tipo: 'TENANT_AUSENTE',
      mensagem: 'Organização não identificada. A importação foi bloqueada por segurança.',
    });
    return {
      isValid: false,
      errors,
      novos: [],
      atualizacoes: [],
      skuDuplicates: [],
      eanDuplicates: [],
    };
  }

  // Índice de produtos existentes no banco pelo SKU normalizado e pelo ID
  const existingBySku = new Map();
  const existingById = new Map();
  const existingByEan = new Map();

  for (const prod of produtosExistentes) {
    if (prod.sku) {
      existingBySku.set(normalizeSkuForComparison(prod.sku), prod);
    }
    if (prod.id) {
      existingById.set(String(prod.id), prod);
    }
    if (prod.codigo_barras) {
      existingByEan.set(String(prod.codigo_barras).trim(), prod);
    }
  }

  // 1ª Passagem: Validação individual de cada linha
  rows.forEach((row, index) => {
    const linhaNum = row.linha || index + 1;
    const rawSku = row.sku ?? row.codigo ?? row.codigo_interno ?? '';
    const cleanSku = normalizeSkuForStorage(rawSku);
    const normSku = normalizeSkuForComparison(cleanSku);

    // Validação obrigatória de SKU
    if (!cleanSku) {
      errors.push({
        linha: linhaNum,
        campo: 'sku',
        tipo: 'SKU_OBRIGATORIO',
        mensagem: `Linha ${linhaNum}: SKU/Código interno é obrigatório e não foi informado.`,
      });
    } else {
      if (!skuToRows.has(normSku)) {
        skuToRows.set(normSku, []);
      }
      skuToRows.get(normSku).push({ linha: linhaNum, row });
    }

    // Validação de divergência entre ID e SKU (se ID fornecido)
    const rawId = row.id ?? row.id_produto ?? null;
    if (rawId) {
      const prodExistingId = existingById.get(String(rawId));
      if (prodExistingId && cleanSku) {
        const existingProdNormSku = normalizeSkuForComparison(prodExistingId.sku);
        if (existingProdNormSku && existingProdNormSku !== normSku) {
          errors.push({
            linha: linhaNum,
            campo: 'id',
            tipo: 'CONFLITO_ID_SKU',
            mensagem: `Linha ${linhaNum}: ID "${rawId}" aponta para SKU "${prodExistingId.sku}", mas a linha contém SKU "${cleanSku}".`,
          });
        }
      }
    }

    // Validação do Código de Barras (EAN/GTIN)
    const rawEan = row.codigo_barras ?? row.ean ?? row.gtin ?? '';
    const trimmedEan = String(rawEan || '').trim();

    if (trimmedEan && !/^SEM\s*GTIN$/i.test(trimmedEan)) {
      if (!isValidGTIN(trimmedEan)) {
        errors.push({
          linha: linhaNum,
          campo: 'codigo_barras',
          tipo: 'EAN_INVALIDO',
          mensagem: `Linha ${linhaNum}: Código de barras "${trimmedEan}" inválido. Deve ser um GTIN válido (8, 12, 13 ou 14 dígitos com dígito verificador).`,
        });
      } else {
        // Validação de EAN duplicado entre SKUs diferentes na mesma planilha
        if (!eanToRows.has(trimmedEan)) {
          eanToRows.set(trimmedEan, []);
        }
        eanToRows.get(trimmedEan).push({ linha: linhaNum, sku: cleanSku, normSku });

        // Validação se o mesmo EAN já pertence a outro produto existente com SKU diferente
        const prodExistingEan = existingByEan.get(trimmedEan);
        if (prodExistingEan && cleanSku) {
          const existingEanNormSku = normalizeSkuForComparison(prodExistingEan.sku);
          if (existingEanNormSku && existingEanNormSku !== normSku) {
            errors.push({
              linha: linhaNum,
              campo: 'codigo_barras',
              tipo: 'EAN_JA_CADASTRADO_OUTRO_SKU',
              mensagem: `Linha ${linhaNum}: Código de barras "${trimmedEan}" já está associado a outro produto (SKU "${prodExistingEan.sku}"). O mesmo EAN não pode pertencer a SKUs distintos na mesma organização.`,
            });
          }
        }
      }
    }

    // Validação de variações com EAN ambíguo
    // Se a linha tiver múltiplas cores ou múltiplos tecidos separados por vírgula
    // e trouxer apenas 1 EAN, não podemos atribuir o mesmo EAN a vários produtos físicos.
    const corRaw = String(row.cor || row.variacao_de_cores || '').trim();
    const tecidoRaw = String(row.modelos_tecidos || row.tecidos || '').trim();
    const numCores = corRaw ? corRaw.split(',').map(c => c.trim()).filter(Boolean).length : 0;
    const numTecidos = tecidoRaw ? tecidoRaw.split(',').map(t => t.trim()).filter(Boolean).length : 0;
    const totalVariacoes = (numCores > 1 ? numCores : 1) * (numTecidos > 1 ? numTecidos : 1);

    if (totalVariacoes > 1 && trimmedEan && !/^SEM\s*GTIN$/i.test(trimmedEan)) {
      errors.push({
        linha: linhaNum,
        campo: 'codigo_barras',
        tipo: 'EAN_AMBIGUO_VARIACOES',
        mensagem: `Linha ${linhaNum}: Esta linha declara múltiplas variações (${totalVariacoes}) com um único EAN ("${trimmedEan}"). Cada item físico precisa de seu próprio EAN ou código de barras vazio.`,
      });
    }
  });

  // 2ª Passagem: Checar duplicidade de SKU dentro do próprio CSV
  const skuDuplicates = [];
  skuToRows.forEach((entries, normSku) => {
    if (entries.length > 1) {
      const linhas = entries.map(e => e.linha);
      const skuOriginal = entries[0].row.sku || normSku;
      skuDuplicates.push({ sku: skuOriginal, linhas });
      errors.push({
        linha: linhas[0],
        campo: 'sku',
        tipo: 'SKU_DUPLICADO_CSV',
        mensagem: `SKU "${skuOriginal}" aparece duplicado no CSV nas linhas: ${linhas.join(', ')}. Cada SKU deve aparecer apenas uma vez na planilha.`,
      });
    }
  });

  // 3ª Passagem: Checar duplicidade de EAN entre SKUs distintos dentro do próprio CSV
  const eanDuplicates = [];
  eanToRows.forEach((entries, ean) => {
    const distinctNormSkus = new Set(entries.map(e => e.normSku).filter(Boolean));
    if (distinctNormSkus.size > 1) {
      const conflito = entries.map(e => `linha ${e.linha} (SKU ${e.sku})`).join(', ');
      eanDuplicates.push({ ean, conflito });
      errors.push({
        linha: entries[0].linha,
        campo: 'codigo_barras',
        tipo: 'EAN_DUPLICADO_ENTRE_SKUS',
        mensagem: `Código de barras "${ean}" foi atribuído a SKUs diferentes no mesmo arquivo: ${conflito}.`,
      });
    }
  });

  // Classificação em novos vs atualizações
  const novos = [];
  const atualizacoes = [];

  rows.forEach((row, index) => {
    const cleanSku = normalizeSkuForStorage(row.sku ?? row.codigo ?? row.codigo_interno ?? '');
    const normSku = normalizeSkuForComparison(cleanSku);
    if (!normSku) return;

    const existingProduct = existingBySku.get(normSku);
    if (existingProduct) {
      atualizacoes.push({
        ...row,
        sku: cleanSku,
        codigo_barras: normalizeGTIN(row.codigo_barras ?? row.ean ?? row.gtin),
        id_existente: existingProduct.id,
        produto_existente: existingProduct,
      });
    } else {
      novos.push({
        ...row,
        sku: cleanSku,
        codigo_barras: normalizeGTIN(row.codigo_barras ?? row.ean ?? row.gtin),
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    novos,
    atualizacoes,
    skuDuplicates,
    eanDuplicates,
  };
};

/**
 * Constrói payload seguro para inserção de um novo produto vindo da importação.
 * Aplica defaults necessários e nunca inventa ID nem sufixo.
 */
export const buildInsertProductPayload = (item, organizationId, extraFields = {}) => {
  if (!organizationId) {
    throw new Error('organization_id é obrigatório para cadastrar produtos.');
  }

  const cleanSku = normalizeSkuForStorage(item.sku);
  if (!cleanSku) {
    throw new Error('SKU é obrigatório para cadastrar produtos.');
  }

  const cleanEan = normalizeGTIN(item.codigo_barras);

  return {
    organization_id: organizationId,
    sku: cleanSku,
    codigo_barras: cleanEan,
    nome: String(item.nome || '').trim(),
    modelo_referencia: item.modelo_referencia !== undefined ? String(item.modelo_referencia || '').trim() : null,
    categoria: item.categoria || 'Outros',
    ambiente: item.ambiente || null,
    fornecedor_id: item.fornecedor_id || null,
    fornecedor_nome: item.fornecedor_nome || '',
    preco_custo: Number(item.preco_custo) || 0,
    preco_venda: Number(item.preco_venda) || 0,
    quantidade_estoque: 0, // Regra do sistema: estoque CSV é ignorado na importação inicial
    estoque_minimo: Number(item.estoque_minimo) || 0,
    largura: item.largura !== undefined && item.largura !== '' ? Number(item.largura) : null,
    altura: item.altura !== undefined && item.altura !== '' ? Number(item.altura) : null,
    profundidade: item.profundidade !== undefined && item.profundidade !== '' ? Number(item.profundidade) : null,
    material: item.material || '',
    cor: item.cor || '',
    cor_hex: item.cor_hex || null,
    variacoes: [],
    fotos: [],
    ativo: true,
    is_parent: false,
    parent_id: null,
    ...extraFields,
  };
};

/**
 * Constrói payload cirúrgico para atualização (reimportação) de um produto existente.
 * Atualiza APENAS campos presentes no CSV.
 * NUNCA envia arrays vazios de fotos ou variações para não sobrescrever dados existentes.
 * NUNCA sobrescreve estoque, ativo, fotos ou variações ausentes.
 */
export const buildUpdateProductPayload = (item, extraFields = {}) => {
  const payload = {};

  if (item.nome !== undefined && String(item.nome).trim()) {
    payload.nome = String(item.nome).trim();
  }

  if (item.modelo_referencia !== undefined) {
    payload.modelo_referencia = String(item.modelo_referencia || '').trim() || null;
  }

  if (item.categoria !== undefined && item.categoria) {
    payload.categoria = item.categoria;
  }

  if (item.ambiente !== undefined) {
    payload.ambiente = item.ambiente || null;
  }

  if (item.fornecedor_id !== undefined && item.fornecedor_id) {
    payload.fornecedor_id = item.fornecedor_id;
  }

  if (item.fornecedor_nome !== undefined) {
    payload.fornecedor_nome = item.fornecedor_nome || '';
  }

  if (item.preco_custo !== undefined && item.preco_custo !== '') {
    payload.preco_custo = Number(item.preco_custo);
  }

  if (item.preco_venda !== undefined && item.preco_venda !== '') {
    payload.preco_venda = Number(item.preco_venda);
  }

  if (item.largura !== undefined && item.largura !== '') {
    payload.largura = Number(item.largura);
  }

  if (item.altura !== undefined && item.altura !== '') {
    payload.altura = Number(item.altura);
  }

  if (item.profundidade !== undefined && item.profundidade !== '') {
    payload.profundidade = Number(item.profundidade);
  }

  if (item.material !== undefined) {
    payload.material = item.material || '';
  }

  if (item.cor !== undefined) {
    payload.cor = item.cor || '';
  }

  if (item.cor_hex !== undefined) {
    payload.cor_hex = item.cor_hex || null;
  }

  // Código de barras: se informado no CSV, normaliza e atualiza
  if (item.codigo_barras !== undefined) {
    payload.codigo_barras = normalizeGTIN(item.codigo_barras);
  }

  // Incorpora extras explícitos sanitizados
  Object.assign(payload, extraFields);

  return payload;
};
