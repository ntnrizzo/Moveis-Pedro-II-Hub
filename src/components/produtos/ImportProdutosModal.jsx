import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { calcularPrecoFinalImportacao } from '@/utils/markupCalculator';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/contexts/TenantContext';
import { useLojas } from '@/hooks/useLojas';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
    Upload,
    FileSpreadsheet,
    Check,
    AlertTriangle,
    Loader2,
    Download,
    X,
    Package,
    Sparkles
} from 'lucide-react';
import { toast } from 'sonner';
import { getColorHex } from './FurnitureColorPicker';
import { detectProductKeywordSuggestion } from '@/lib/productKeywordDetector';
import {
    validateImportPlanilha,
    buildInsertProductPayload,
    buildUpdateProductPayload,
    normalizeSkuForComparison,
    normalizeSkuForStorage
} from '@/utils/importProdutosUtils';
import { isValidGTIN, normalizeGTIN } from '@/utils/gtinValidator';

// Template CSV - NOTA: Lojas são carregadas dinamicamente
const CSV_TEMPLATE_HEADER = `SKU,CÓDIGO DE BARRAS,FABRICANTE / FORNECEDOR,DESCRIÇÃO DO PRODUTO,MODELO / REFERÊNCIA,PREÇO DE CUSTO,LARGURA,ALTURA,PROFUNDIDADE,EXTRA,VARIAÇÃO DE CORES,MODELOS DE TECIDOS,ESTOQUE CD`;
const CSV_TEMPLATE_FOOTER = `,IMPOSTOS,FRETE,IPI,MARKUP,PREÇO VENDA FINAL,DESCONTOS VENDEDOR,DESCONTOS GERENCIAL,MOVEIS MONTAGEM`;

// Mapeamento BASE de colunas do CSV para campos internos
// As colunas de estoque por loja são geradas dinamicamente
const BASE_COLUMN_MAPPING = {
    // === SKU / CÓDIGO INTERNO ===
    'sku': 'sku',
    'código': 'sku',
    'codigo': 'sku',
    'código interno': 'sku',
    'codigo interno': 'sku',

    // === CÓDIGO DE BARRAS / EAN / GTIN ===
    'código de barras': 'codigo_barras',
    'codigo de barras': 'codigo_barras',
    'codigo_barras': 'codigo_barras',
    'ean': 'codigo_barras',
    'gtin': 'codigo_barras',

    // === ID DO PRODUTO (opcional para arquivos exportados pelo próprio sistema) ===
    'id do produto': 'id',
    'id produto': 'id',
    'id': 'id',

    // === FABRICANTE / FORNECEDOR (com variações/typos) ===
    'fabricante / fornecedor': 'fornecedor_nome',
    'fabricante / fornencedor': 'fornecedor_nome',
    'fabricante/fornecedor': 'fornecedor_nome',
    'fornecedor': 'fornecedor_nome',
    'fabricante': 'fornecedor_nome',

    // === DESCRIÇÃO DO PRODUTO ===
    'descrição do produto': 'nome',
    'descricao do produto': 'nome',
    'descrição': 'nome',
    'descricao': 'nome',
    'nome': 'nome',
    'produto': 'nome',
    'nome do produto': 'nome',

    // === MODELO / REFERÊNCIA ===
    'modelo / referência': 'modelo_referencia',
    'modelo / referencia': 'modelo_referencia',
    'modelo/referência': 'modelo_referencia',
    'modelo': 'modelo_referencia',
    'referência': 'modelo_referencia',
    'referencia': 'modelo_referencia',
    'linha': 'modelo_referencia',
    'coleção': 'modelo_referencia',
    'colecao': 'modelo_referencia',
    'ref': 'modelo_referencia',
    'modelo/ref': 'modelo_referencia',
    'modelo / ref': 'modelo_referencia',
    'linha/modelo': 'modelo_referencia',
    'linha / modelo': 'modelo_referencia',

    // === PREÇO DE CUSTO ===
    'preço de custo': 'preco_custo',
    'preco de custo': 'preco_custo',
    'preco_custo': 'preco_custo',
    'custo': 'preco_custo',

    // === DIMENSÕES ===
    'largura': 'largura',
    'altura': 'altura',
    'profundidade': 'profundidade',
    'extra': 'dimensao_extra',

    // === VARIAÇÕES ===
    'variação de cores': 'cor',
    'variacao de cores': 'cor',
    'cor': 'cor',
    'cores': 'cor',
    'variação': 'cor',
    'variacao': 'cor',
    'acabamento': 'cor',
    'cores/acabamentos': 'cor',
    'cor/acabamento': 'cor',
    'cor / acabamento': 'cor',
    'modelos de tecidos': 'modelos_tecidos',
    'tecidos': 'modelos_tecidos',

    // === ESTOQUE CD (sempre presente) ===
    'estoque cd': 'estoque_cd',
    'estoque_cd': 'estoque_cd',
    'cd': 'estoque_cd',

    // === IMPOSTOS / CUSTEIO ===
    'impostos': 'impostos_percentual',
    'frete': 'frete_custo',
    'ipi': 'ipi_percentual',

    // === MARKUP / GRUPOS ===
    'grupo 1: prontos': 'markup_grupo1_prontos',
    'grupo 1 prontos': 'markup_grupo1_prontos',
    'prontos': 'markup_grupo1_prontos',
    'grupo 2: montagem': 'markup_grupo2_montagem',
    'grupo 2 montagem': 'markup_grupo2_montagem',
    'grupo 3: lustre': 'markup_grupo3_lustre',
    'grupo 3 lustre': 'markup_grupo3_lustre',
    'lustre': 'markup_grupo3_lustre',
    'markup': 'markup_aplicado',

    // === PREÇO DE VENDA ===
    'preço venda final': 'preco_venda',
    'preco venda final': 'preco_venda',
    'preco_venda': 'preco_venda',
    'preco': 'preco_venda',
    'preço': 'preco_venda',
    'valor': 'preco_venda',

    // === DESCONTOS ===
    'descontos vendedor': 'desconto_max_vendedor',
    'desconto vendedor': 'desconto_max_vendedor',
    'descontos gerencial': 'desconto_max_gerencial',
    'desconto gerencial': 'desconto_max_gerencial',

    // === MONTAGEM ===
    'moveis montagem': 'requer_montagem',
    'móveis montagem': 'requer_montagem',
    'montagem / terceirizado': 'montagem_terceirizado',
    'terceirizado': 'montagem_terceirizado',

    // === CAMPOS EXTRAS ===
    'categoria': 'categoria',
    'ambiente': 'ambiente',
    'material': 'material',
    'tamanho': 'tamanho',
    'grupos': '_ignorar',
    'espera': '_ignorar',
};

export default function ImportProdutosModal({ isOpen, onClose, onSuccess }) {
    const [file, setFile] = useState(null);
    const [parsedData, setParsedData] = useState([]);
    const [groupedProducts, setGroupedProducts] = useState([]);
    const [errors, setErrors] = useState([]);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentlyProcessing, setCurrentlyProcessing] = useState([]); // Visualização mini-grade
    const [step, setStep] = useState(1); // 1: upload, 2: preview, 3: importing, 4: enriching NCM
    const cancelImportRef = React.useRef(false);
    const [produtosExistentes, setProdutosExistentes] = useState(new Map());
    const [catalogoProdutos, setCatalogoProdutos] = useState([]);
    const [catalogoError, setCatalogoError] = useState(null);
    const [validationResult, setValidationResult] = useState(null);
    const [importSummary, setImportSummary] = useState(null); // { criados, atualizados, ignorados, falharam, falhasDetalhadas }


    // Verificação de permissão estrita para dados financeiros
    const { user } = useAuth();
    const showFinancials = user?.cargo === 'Administrador';

    // Multi-Tenant: Carrega lojas dinâmicas
    const { data: lojas = [] } = useLojas();
    const { organization } = useTenant();

    const normalizeCodigo = useCallback((codigo) => String(codigo || '').trim().toLowerCase(), []);

    // Pré-carrega o catálogo existente completo com SKU e GTIN para validação de unicidade e reimportação
    useEffect(() => {
        if (!isOpen) return;

        const carregarProdutosExistentes = async () => {
            if (!organization?.id) {
                setCatalogoError('Organização não identificada. A importação foi bloqueada por segurança.');
                return;
            }

            try {
                setCatalogoError(null);
                const listaCatalogo = [];
                const produtosMap = new Map();
                const pageSize = 1000;
                let from = 0;
                let keepFetching = true;

                while (keepFetching) {
                    const { data: produtos, error } = await supabase
                        .from('produtos')
                        .select('id, sku, codigo_barras, nome, modelo_referencia, preco_venda, preco_custo, organization_id')
                        .eq('organization_id', organization.id)
                        .range(from, from + pageSize - 1);

                    if (error) throw error;

                    (produtos || []).forEach((p) => {
                        listaCatalogo.push(p);
                        const chaveSku = normalizeSkuForComparison(p.sku);
                        if (chaveSku) produtosMap.set(chaveSku, p);
                    });

                    if (!produtos || produtos.length < pageSize) {
                        keepFetching = false;
                    } else {
                        from += pageSize;
                    }
                }

                setCatalogoProdutos(listaCatalogo);
                setProdutosExistentes(produtosMap);
            } catch (error) {
                console.error('[Import] Erro ao carregar produtos existentes:', error);
                setCatalogoError('Falha ao carregar catálogo existente da organização: ' + error.message);
            }
        };

        carregarProdutosExistentes();
    }, [isOpen, organization?.id, normalizeCodigo]);

    // Gera mapeamento dinâmico de colunas baseado nas lojas cadastradas
    const COLUMN_MAPPING = useMemo(() => {
        const dynamicMapping = { ...BASE_COLUMN_MAPPING };

        // Adiciona mapeamentos dinâmicos para cada loja
        lojas.forEach(loja => {
            if (!loja) return;
            const codigo = loja.codigo ? String(loja.codigo) : '';
            const nome = loja.nome ? String(loja.nome) : '';
            const identifier = codigo || nome;
            if (!identifier) return;

            const codigoNormalizado = codigo.toLowerCase().replace(/\s+/g, '_');
            const nomeNormalizado = nome.toLowerCase().replace(/\s+/g, '_');
            const fieldName = `estoque_${codigoNormalizado || nomeNormalizado}`;

            // Várias formas de escrever o nome da loja no CSV
            if (codigo) {
                dynamicMapping[`estoque loja ${codigo.toLowerCase()}`] = fieldName;
                dynamicMapping[`estoque ${codigo.toLowerCase()}`] = fieldName;
                dynamicMapping[codigo.toLowerCase()] = fieldName;
                dynamicMapping[codigoNormalizado] = fieldName;
            }
            if (nome) {
                dynamicMapping[`estoque loja ${nome.toLowerCase()}`] = fieldName;
                dynamicMapping[`estoque ${nome.toLowerCase()}`] = fieldName;
                dynamicMapping[nomeNormalizado] = fieldName;
            }
        });

        // Futura = placeholder (ignorar, mas ler para não quebrar importação)
        dynamicMapping['estoque loja futura'] = '_ignorar';
        dynamicMapping['futura'] = '_ignorar';

        return dynamicMapping;
    }, [lojas]);

    // Gera template CSV dinâmico com lojas
    const CSV_TEMPLATE = useMemo(() => {
        const lojasHeaders = lojas.map(l => `ESTOQUE LOJA ${(l?.nome || '').toUpperCase()}`).join(',');
        return `${CSV_TEMPLATE_HEADER},${lojasHeaders}${CSV_TEMPLATE_FOOTER}\nALT-SF3R-CINZA,7891000315507,Altaro,Sofá 3 Lugares,ALT-SF3R,1200,220,95,100,,Cinza,Suede,5${',0'.repeat(lojas.length)},12,150,5,100,2640,5,15,SIM`;
    }, [lojas]);

    const buildVariationToken = (value, fallback = '') => {
        const token = String(value || '')
            .substring(0, 30)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return token || fallback;
    };

    const buildVariationSuffix = (cor = null, tecido = null) => {
        const parts = [];
        const corPart = buildVariationToken(cor);
        const tecidoPart = buildVariationToken(tecido);

        if (corPart) parts.push(corPart);
        if (tecidoPart) parts.push(tecidoPart);

        return parts.join('-');
    };

    // Gerar SKU único e DETERMINÍSTICO
    // Formato: FOR-MOD-COR-TECIDO (sanitizado)
    const generateSKU = (fornecedor, modelo, cor = null, tecido = null, nome = '') => {
        const forPart = (fornecedor || 'GEN').substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const modPart = (modelo || 'PRD').substring(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');

        let sku = `${forPart}-${modPart}`;

        if (nome) {
            const nameSlug = nome
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .substring(0, 8);
            if (nameSlug) {
                sku += `-${nameSlug}`;
            }
        }

        const variationSuffix = buildVariationSuffix(cor, tecido);
        if (variationSuffix) {
            sku += `-${variationSuffix}`;
        }

        return sku;
    };

    // Normaliza nome da coluna
    const normalizeColumn = (col) => {
        // Primeiro tenta com lowercase e trim apenas
        const lower = col.toLowerCase().trim();
        if (COLUMN_MAPPING[lower]) {
            return COLUMN_MAPPING[lower];
        }
        // Depois tenta normalizando espaços múltiplos para um só
        const normalized = lower.replace(/\s+/g, ' ');
        if (COLUMN_MAPPING[normalized]) {
            return COLUMN_MAPPING[normalized];
        }
        // Retorna o valor normalizado (mesmo que não mapeado)
        return normalized;
    };

    // Parse valor numérico (aceita vírgula como decimal)
    // Parse valor numérico (aceita vírgula como decimal e ignora pontos de milhar)
    const parseNum = (val) => {
        if (!val && val !== 0) return null;
        if (typeof val === 'number') return val;

        let cleaned = String(val).replace(/[R$\s]/g, '');

        // Se tiver vírgula, assume que é decimal e remove pontos de milhar
        if (cleaned.includes(',')) {
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        }
        // Se não tiver vírgula mas tiver pontos, verifica se parede ser milhar
        // Ex: 1.200 (1200) vs 1.2 (1.2) - Na dúvida, JS trata ponto como decimal

        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    };

    // Parse booleano (SIM/NÃO)
    const parseBool = (val) => {
        if (!val) return false;
        const v = String(val).toLowerCase().trim();
        return v === 'sim' || v === 's' || v === 'true' || v === '1';
    };

    // Numeric(5,2) aceita apenas valores entre -999.99 e 999.99
    const sanitizeNumeric52 = (value, fallback = 0) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        if (num > 999.99) return 999.99;
        if (num < -999.99) return -999.99;
        return num;
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const isTransientNetworkError = (err) => {
        const msg = `${err?.message || ''} ${err?.details || ''}`.toLowerCase();
        return (
            msg.includes('failed to fetch') ||
            msg.includes('network') ||
            msg.includes('err_failed') ||
            msg.includes('timeout') ||
            (!err?.code && msg.includes('typeerror'))
        );
    };

    const withRetry = async (operation, maxAttempts = 4) => {
        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (err) {
                lastErr = err;
                if (!isTransientNetworkError(err) || attempt === maxAttempts) {
                    throw err;
                }
                await sleep(250 * attempt);
            }
        }
        throw lastErr;
    };

    // Parse CSV com reagrupamento inteligente de campos de variação
    const parseCSV = (text) => {
        const lines = text.trim().split('\n');

        // Detectar separador automaticamente (vírgula ou ponto-e-vírgula)
        const firstLine = lines[0];
        const commaCount = (firstLine.match(/,/g) || []).length;
        const semicolonCount = (firstLine.match(/;/g) || []).length;
        const separator = semicolonCount > commaCount ? ';' : ',';

        console.log('[Import] Separador detectado:', separator, '(vírgulas:', commaCount, 'ponto-e-vírgulas:', semicolonCount, ')');

        // Função auxiliar: parse de uma linha CSV respeitando aspas
        const parseLine = (line) => {
            const vals = [];
            let cur = '';
            let inQuotes = false;
            for (const char of line) {
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === separator && !inQuotes) {
                    vals.push(cur.trim());
                    cur = '';
                } else {
                    cur += char;
                }
            }
            vals.push(cur.trim());
            return vals;
        };

        const rawHeaders = parseLine(firstLine).map(h => h.replace(/"/g, ''));
        console.log('[Import] Headers encontrados:', rawHeaders.slice(0, 5), '...');

        const headers = rawHeaders.map((h, index) => {
            let mapped = normalizeColumn(h);
            if (!mapped || mapped === '') {
                // Fallbacks baseados na posição exata da planilha padrão quando o cabeçalho estiver vazio/não reconhecido
                if (index === 0) mapped = 'fornecedor_nome';
                if (index === 1) mapped = 'nome';
                if (index === 2) mapped = 'modelo_referencia';
                if (index === 3) mapped = 'preco_custo';
                if (index === 4) mapped = 'largura';
                if (index === 5) mapped = 'altura';
                if (index === 6) mapped = 'profundidade';
                if (index === 7) mapped = 'dimensao_extra';
                if (index === 8) mapped = 'cor';
                if (index === 9) mapped = 'modelos_tecidos';
                if (index === 10) mapped = 'estoque_cd';
            }
            return mapped;
        });
        console.log('[Import] Headers mapeados:', headers);

        // Colunas de variação com posição FIXA na planilha:
        // J (índice 9) = VARIAÇÃO DE CORES
        // K (índice 10) = MODELOS DE TECIDOS
        // Essas colunas podem conter valores separados por vírgula e precisam
        // ser reagrupadas quando o CSV usa vírgula como separador.
        const VARIATION_COL_INDICES = [9, 10];
        const expectedCols = headers.length;

        console.log('[Import] Colunas esperadas:', expectedCols, '| Colunas de variação (fixas): J(9) e K(10)');

        const data = [];
        const parseErrors = [];

        for (let i = 1; i < lines.length; i++) {
            let values = parseLine(lines[i]);

            // ========================
            // REAGRUPAMENTO INTELIGENTE
            // ========================
            // Quando o CSV usa vírgula como separador E a linha tem MAIS valores
            // que colunas no header, significa que vírgulas dentro das colunas J/K
            // (VARIAÇÃO DE CORES / MODELOS DE TECIDOS) foram interpretadas como
            // separadores de coluna. Reagrupamos os excedentes de volta.
            if (separator === ',' && values.length > expectedCols && VARIATION_COL_INDICES.length > 0) {
                const excess = values.length - expectedCols;
                console.log(`[Import] Linha ${i + 1}: ${values.length} valores (esperado ${expectedCols}), reagrupando ${excess} excedentes`);

                const rebuilt = [];
                let vi = 0; // índice atual em values[]

                for (let hi = 0; hi < expectedCols; hi++) {
                    if (vi >= values.length) {
                        rebuilt.push('');
                        continue;
                    }

                    if (VARIATION_COL_INDICES.includes(hi)) {
                        // Coluna de variação (J ou K) — absorver valores extras
                        let merged = values[vi];
                        vi++;

                        // Calcula excedentes restantes
                        const remainingValues = values.length - vi;
                        const remainingHeaders = expectedCols - hi - 1;
                        let excessHere = remainingValues - remainingHeaders;

                        while (excessHere > 0 && vi < values.length) {
                            const nextVal = values[vi];
                            const isNumeric = /^\s*[R$]*\s*[\d.,]+\s*$/.test(nextVal);
                            const isEmpty = !nextVal || nextVal.trim() === '';

                            // Se parece um número puro (preço, estoque), parar
                            if (isNumeric && excessHere <= 2) break;
                            if (isEmpty && excessHere <= 1) break;

                            merged += ', ' + nextVal;
                            vi++;
                            excessHere--;
                        }

                        rebuilt.push(merged);
                    } else {
                        rebuilt.push(values[vi] || '');
                        vi++;
                    }
                }

                values = rebuilt;
                console.log(`[Import] Linha ${i + 1}: Reagrupado → Cor: "${values[9] || ''}" | Tecido: "${values[10] || ''}"`);
            }

            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });

            // Check if the entire row is empty
            const isRowEmpty = Object.values(row).every(val => String(val).trim() === '');
            if (isRowEmpty) {
                continue;
            }

            // Validação inteligente: se não tem nome, verificar se é linha de separação/cabeçalho
            // ou se é um produto real com nome faltando
            if (!row.nome || String(row.nome).trim() === '') {
                // Verificar se tem dados significativos de produto (preço, modelo, etc.)
                const temPreco = parseNum(row.preco_custo) > 0 || parseNum(row.preco_venda) > 0;
                const temModelo = row.modelo_referencia && String(row.modelo_referencia).trim().length > 0;

                if (temPreco || temModelo) {
                    // Tem dados reais mas falta o nome → erro real
                    parseErrors.push(`Linha ${i + 1}: Nome/Descrição do produto é obrigatório (tem preço/modelo mas sem nome)`);
                }
                // Caso contrário: linha de separação/cabeçalho → ignorar silenciosamente
                continue;
            }

            // Extrair estoque dinâmico por loja
            const estoquePorLoja = {};
            lojas.forEach(loja => {
                if (!loja) return;
                const identifier = (loja.codigo || loja.nome || '').toLowerCase().replace(/\s+/g, '_');
                if (!identifier) return;
                const fieldName = `estoque_${identifier}`;
                estoquePorLoja[fieldName] = parseInt(row[fieldName]) || 0;
            });

            // Converter valores numéricos com sanitização Enterprise
            const processedRow = {
                ...row,
                preco_custo: parseNum(row.preco_custo) || 0,
                largura: parseNum(row.largura),
                altura: parseNum(row.altura),
                profundidade: parseNum(row.profundidade),
                impostos_percentual: sanitizeNumeric52(parseNum(row.impostos_percentual), 0),
                frete_custo: parseNum(row.frete_custo) || 0,
                ipi_percentual: sanitizeNumeric52(parseNum(row.ipi_percentual), 0),
                markup_grupo1_prontos: sanitizeNumeric52(parseNum(row.markup_grupo1_prontos), 0),
                markup_grupo2_montagem: sanitizeNumeric52(parseNum(row.markup_grupo2_montagem), 0),
                markup_grupo3_lustre: sanitizeNumeric52(parseNum(row.markup_grupo3_lustre), 0),
                markup_aplicado: sanitizeNumeric52(parseNum(row.markup_aplicado), 0),
                desconto_max_vendedor: sanitizeNumeric52(parseNum(row.desconto_max_vendedor), 5),
                desconto_max_gerencial: sanitizeNumeric52(parseNum(row.desconto_max_gerencial), 15),
                requer_montagem: parseBool(row.requer_montagem),
                montagem_terceirizado: parseBool(row.montagem_terceirizado),
                // Estoque dinâmico por loja
                ...estoquePorLoja,
                linha: i + 1
            };

            // Calcula o preco_venda caso não venha preenchido (usa o utilitário que lê frete, IPI e markups)
            processedRow.preco_venda = parseNum(row.preco_venda) || calcularPrecoFinalImportacao(processedRow) || 0;

            data.push(processedRow);
        }

        return { data, errors: parseErrors };
    };

    // Explode variações de cor e tecido separadas por vírgula em linhas individuais
    // Regra: quando ambas existirem, gera combinação cartesiana (cor x tecido)
    const prepareProducts = (data) => {
        const result = [];

        for (const row of data) {
            const corRaw = row.cor ? String(row.cor).trim() : '';
            const tecidoRaw = row.modelos_tecidos ? String(row.modelos_tecidos).trim() : '';

            // Se tiver vírgula, split em múltiplas variações
            const cores = corRaw
                ? [...new Set(corRaw.split(',').map(c => c.trim()).filter(c => c.length > 0))]
                : [];
            const tecidos = tecidoRaw
                ? [...new Set(tecidoRaw.split(',').map(c => c.trim()).filter(c => c.length > 0))]
                : [];

            const combinacoes = [];
            if (cores.length > 0 && tecidos.length > 0) {
                for (const cor of cores) {
                    for (const tecido of tecidos) {
                        combinacoes.push({ cor, tecido });
                    }
                }
            } else if (cores.length > 0) {
                cores.forEach(cor => combinacoes.push({ cor, tecido: '' }));
            } else if (tecidos.length > 0) {
                tecidos.forEach(tecido => combinacoes.push({ cor: '', tecido }));
            } else {
                combinacoes.push({ cor: '', tecido: '' });
            }

            const estoqueZerado = Object.keys(row).reduce((acc, key) => {
                if (key.startsWith('estoque_')) {
                    acc[key] = 0;
                }
                return acc;
            }, {});

            if (combinacoes.length <= 1) {
                // Produto único (sem variação ou variação única)
                const unica = combinacoes[0];
                result.push({
                    ...row,
                    ...estoqueZerado,
                    cor: unica.cor || '',
                    modelos_tecidos: unica.tecido || '',
                    cor_hex: unica.cor ? getColorHex(unica.cor) : null,
                    variacoes: []
                });
            } else {
                // Múltiplas variações
                // NOTA: Se o CSV trouxer um único EAN para múltiplas variações, a pré-validação bloqueará.
                // Aqui cada variação recebe seu próprio SKU derivado para unicidade, e EAN null.
                console.log(`[Import] Linha ${row.linha}: Explodindo ${combinacoes.length} variações de "${row.nome}"`);
                for (const variacao of combinacoes) {
                    const varToken = [variacao.cor, variacao.tecido]
                        .filter(Boolean)
                        .join('-')
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '-');
                    const varSku = row.sku ? `${row.sku}-${varToken}` : '';

                    result.push({
                        ...row,
                        ...estoqueZerado,
                        sku: varSku || row.sku,
                        codigo_barras: null, // Variações não herdam EAN ambíguo único
                        cor: variacao.cor,
                        modelos_tecidos: variacao.tecido,
                        cor_hex: variacao.cor ? getColorHex(variacao.cor) : null,
                        variacoes: []
                    });
                }
            }
        }

        console.log(`[Import] prepareProducts: ${data.length} linhas CSV → ${result.length} produtos individuais`);
        return result;
    };

    // Handle file upload
    const handleFileUpload = useCallback((e) => {
        const uploadedFile = e.target.files[0];
        if (!uploadedFile) {
            console.log('[Import] Nenhum arquivo selecionado');
            return;
        }

        console.log('[Import] Arquivo selecionado:', uploadedFile.name, uploadedFile.type);
        setFile(uploadedFile);

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target.result;
                console.log('[Import] Arquivo lido, primeiros 500 chars:', text.substring(0, 500));
                console.log('[Import] Total de caracteres:', text.length);

                const { data, errors: parseErrors } = parseCSV(text);
                console.log('[Import] Parse concluído. Produtos:', data.length, 'Erros:', parseErrors.length);

                if (parseErrors.length > 0) {
                    console.log('[Import] Erros de parse:', parseErrors);
                }

                setParsedData(data);
                setErrors(parseErrors);

                if (data.length > 0) {
                    const prepared = prepareProducts(data);
                    console.log('[Import] Produtos preparados:', prepared.length);
                    setGroupedProducts(prepared);

                    // Executar pré-validação completa e estrita
                    const valResult = validateImportPlanilha({
                        rows: prepared,
                        produtosExistentes: catalogoProdutos,
                        organizationId: organization?.id,
                    });

                    setValidationResult(valResult);
                    setStep(2);
                } else {
                    console.log('[Import] Nenhum produto encontrado nos dados');
                    toast.error('Nenhum produto encontrado no arquivo. Verifique o formato.');
                }
            } catch (error) {
                console.error('[Import] Erro ao processar arquivo:', error);
                toast.error('Erro ao processar arquivo: ' + error.message);
            }
        };
        reader.onerror = (error) => {
            console.error('[Import] Erro ao ler arquivo:', error);
            toast.error('Erro ao ler arquivo');
        };
        reader.readAsText(uploadedFile);
    }, [catalogoProdutos, organization?.id]);

    // Download template
    const downloadTemplate = () => {
        const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'template_produtos.csv';
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const suggestionCache = useMemo(() => new Map(), []);

    const getSuggestedMetadata = useCallback((item) => {
        const cacheKey = String(item?.nome || '').trim().toLowerCase();
        if (!cacheKey) {
            return { categoria: item?.categoria || '', ambiente: item?.ambiente || '' };
        }

        if (suggestionCache.has(cacheKey)) {
            return suggestionCache.get(cacheKey);
        }

        const detected = detectProductKeywordSuggestion(item.nome, { returnDefault: true });
        const resolved = {
            categoria: item.categoria || detected.categoriaSuggestion,
            ambiente: item.ambiente || detected.ambienteSuggestion
        };
        suggestionCache.set(cacheKey, resolved);
        return resolved;
    }, [suggestionCache]);

    // Import products
    const handleImport = async () => {
        if (!organization?.id) {
            toast.error('Organização não identificada. A importação foi bloqueada por segurança.');
            return;
        }

        if (catalogoError) {
            toast.error('Não é possível importar enquanto o catálogo não puder ser verificado.');
            return;
        }

        if (!validationResult || !validationResult.isValid) {
            toast.error('A planilha contém erros impeditivos de SKU/EAN. Corrija o arquivo antes de importar.');
            return;
        }

        cancelImportRef.current = false;
        setImporting(true);
        setStep(3);
        setProgress(0);
        setImportSummary(null);

        let fornecedoresMap = {};
        const normalizeFornecedor = (nome) => String(nome || '').trim().toLowerCase();

        try {
            // 1. Fornecedores
            const fornecedoresNomes = [...new Set(
                groupedProducts
                    .map(p => p.fornecedor_nome)
                    .filter(nome => nome && nome.trim())
            )];

            if (fornecedoresNomes.length > 0) {
                console.log('[Import] Verificando fornecedores:', fornecedoresNomes);
                const fornecedoresExistentes = await base44.entities.Fornecedor.list();
                const nomesExistentes = new Set(
                    fornecedoresExistentes.map(f => normalizeFornecedor(f.nome_empresa))
                );

                fornecedoresExistentes.forEach(f => {
                    const chave = normalizeFornecedor(f.nome_empresa);
                    if (chave) fornecedoresMap[chave] = f.id;
                });

                const novosFornecedores = fornecedoresNomes.filter(
                    nome => !nomesExistentes.has(normalizeFornecedor(nome))
                );

                for (const nomeFornecedor of novosFornecedores) {
                    try {
                        const novoFornecedor = await base44.entities.Fornecedor.create({
                            nome_empresa: nomeFornecedor
                        });
                        const chave = normalizeFornecedor(nomeFornecedor);
                        if (chave && novoFornecedor?.id) {
                            fornecedoresMap[chave] = novoFornecedor.id;
                        }
                    } catch (err) {
                        console.warn('[Import] Erro ao criar fornecedor:', nomeFornecedor, err);
                    }
                }
            }
        } catch (err) {
            console.warn('[Import] Erro ao processar fornecedores:', err);
        }

        const totalProdutos = groupedProducts.length;
        let processados = 0;
        let criados = 0;
        let atualizados = 0;
        let ignorados = 0;
        let falharam = 0;
        const falhasDetalhadas = [];
        const produtoIdsCriadosOuAtualizados = [];

        // Separar itens entre inserções (novos) e atualizações (existentes)
        const itemsToInsert = [];
        const itemsToUpdate = [];

        for (const item of groupedProducts) {
            const chaveSku = normalizeSkuForComparison(item.sku);
            const existing = produtosExistentes.get(chaveSku);
            const { categoria, ambiente } = getSuggestedMetadata(item);
            const fornecedorId = fornecedoresMap[normalizeFornecedor(item.fornecedor_nome)] || null;

            if (existing) {
                const payload = buildUpdateProductPayload({
                    item,
                    existingProduct: existing,
                    organizationId: organization.id,
                    fornecedorId,
                    categoria,
                    ambiente
                });
                itemsToUpdate.push({ payload, existing, originalItem: item });
            } else {
                const payload = buildInsertProductPayload({
                    item,
                    organizationId: organization.id,
                    fornecedorId,
                    categoria,
                    ambiente
                });
                itemsToInsert.push({ payload, originalItem: item });
            }
        }

        console.log(`[Import] Total: ${totalProdutos} | Inserções: ${itemsToInsert.length} | Atualizações: ${itemsToUpdate.length}`);

        // Processar inserções em lotes
        const INSERT_BATCH_SIZE = 50;
        for (let i = 0; i < itemsToInsert.length; i += INSERT_BATCH_SIZE) {
            if (cancelImportRef.current) break;

            const chunk = itemsToInsert.slice(i, i + INSERT_BATCH_SIZE);
            setCurrentlyProcessing(() => chunk.slice(0, 3).map(c => c.originalItem.nome + (c.originalItem.cor ? ` (${c.originalItem.cor})` : '')));

            const payloads = chunk.map(c => c.payload);

            try {
                const { data: inserted, error: batchErr } = await withRetry(async () =>
                    supabase
                        .from('produtos')
                        .insert(payloads)
                        .select('id')
                );

                if (batchErr) throw batchErr;

                const ids = (inserted || []).map(p => p.id).filter(Boolean);
                criados += ids.length;
                produtoIdsCriadosOuAtualizados.push(...ids);
            } catch (batchErr) {
                console.warn('[Import] Falha no lote de inserção, tentando individualmente:', batchErr);
                for (const entry of chunk) {
                    try {
                        const { data: single, error: singleErr } = await withRetry(async () =>
                            supabase
                                .from('produtos')
                                .insert(entry.payload)
                                .select('id')
                        );
                        if (singleErr) throw singleErr;
                        if (single?.[0]?.id) {
                            criados++;
                            produtoIdsCriadosOuAtualizados.push(single[0].id);
                        }
                    } catch (singleErr) {
                        console.error('[Import] Erro ao inserir produto:', entry.originalItem.sku, singleErr);
                        falharam++;
                        falhasDetalhadas.push(`${entry.originalItem.sku || entry.originalItem.nome}: ${singleErr.message || 'Erro ao inserir'}`);
                    }
                }
            }

            processados += chunk.length;
            setProgress(5 + Math.round((processados / totalProdutos) * 85));
            await sleep(20);
        }

        // Processar atualizações cirúrgicas (update por id + organization_id)
        for (const entry of itemsToUpdate) {
            if (cancelImportRef.current) break;

            setCurrentlyProcessing([entry.originalItem.nome + (entry.originalItem.cor ? ` (${entry.originalItem.cor})` : '')]);

            try {
                const { error: updateErr } = await withRetry(async () =>
                    supabase
                        .from('produtos')
                        .update(entry.payload)
                        .eq('id', entry.existing.id)
                        .eq('organization_id', organization.id)
                );

                if (updateErr) throw updateErr;

                atualizados++;
                produtoIdsCriadosOuAtualizados.push(entry.existing.id);
            } catch (updateErr) {
                console.error('[Import] Erro ao atualizar produto:', entry.originalItem.sku, updateErr);
                falharam++;
                falhasDetalhadas.push(`${entry.originalItem.sku}: ${updateErr.message || 'Erro ao atualizar'}`);
            }

            processados++;
            setProgress(5 + Math.round((processados / totalProdutos) * 85));
            if (processados % 10 === 0) await sleep(10);
        }

        // Histórico de preços
        if (produtoIdsCriadosOuAtualizados.length > 0) {
            const historicos = produtoIdsCriadosOuAtualizados.map(produtoId => ({
                organization_id: organization.id,
                produto_id: produtoId,
                preco_antigo: 0,
                preco_novo: 0,
                tipo: 'venda',
                motivo: `Importação Smart - ${file?.name || 'arquivo'}`,
                usuario_nome: user?.nome || 'Sistema'
            }));

            const HISTORICO_BATCH_SIZE = 500;
            for (let i = 0; i < historicos.length; i += HISTORICO_BATCH_SIZE) {
                const chunk = historicos.slice(i, i + HISTORICO_BATCH_SIZE);
                try {
                    await supabase.from('historico_precos').insert(chunk);
                } catch (err) {
                    console.warn('[Import] Histórico de preços falhou:', err);
                }
            }
        }

        setProgress(100);
        setImporting(false);
        setCurrentlyProcessing([]);

        const summary = {
            criados,
            atualizados,
            ignorados,
            falharam,
            falhasDetalhadas
        };
        setImportSummary(summary);

        if (cancelImportRef.current) {
            toast.warning(`Importação interrompida. ${criados} criados, ${atualizados} atualizados de ${totalProdutos}.`);
        } else if (falharam === 0) {
            toast.success(`Importação concluída com sucesso! ${criados} criado(s), ${atualizados} atualizado(s).`);
            onSuccess?.();
        } else {
            toast.warning(`Importação finalizada com ${falharam} falha(s). Verifique o resumo.`);
            if (criados > 0 || atualizados > 0) {
                onSuccess?.();
            }
        }
    };

    // Reset and close
    const handleClose = () => {
        setFile(null);
        setParsedData([]);
        setGroupedProducts([]);
        setErrors([]);
        setStep(1);
        setProgress(0);
        setCurrentlyProcessing([]);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="w-5 h-5" />
                        Importar Produtos via Planilha
                    </DialogTitle>
                    <DialogDescription>
                        {step === 1 && "Faça upload de um arquivo CSV para importar produtos em lote."}
                        {step === 2 && "Revise os produtos e seus dados fiscais antes de importar."}
                        {step === 3 && "Aguarde enquanto os produtos são importados para o sistema."}
                        {step === 4 && "Enriquecendo produtos com códigos NCM usando inteligência artificial."}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-4">
                    {/* Step 1: Upload */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <Alert>
                                <AlertDescription>
                                    Faça upload de um arquivo CSV com os produtos.
                                    Quando houver listas de cores e tecidos, o sistema gera combinações (cor x tecido).
                                    Os estoques informados no CSV são ignorados e devem ser lançados depois no sistema.
                                </AlertDescription>
                            </Alert>

                            <div className="flex justify-center">
                                <Button variant="outline" onClick={downloadTemplate} className="gap-2">
                                    <Download className="w-4 h-4" />
                                    Baixar Modelo CSV
                                </Button>
                            </div>

                            <label className="cursor-pointer block">
                                <input
                                    type="file"
                                    accept=".csv,.txt"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                                <div className="border-2 border-dashed rounded-lg p-12 text-center hover:bg-gray-50 transition-colors">
                                    <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                                    <p className="text-lg font-medium text-gray-700">
                                        Clique para selecionar arquivo
                                    </p>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Formato aceito: CSV
                                    </p>
                                </div>
                            </label>

                            <Card className="bg-gray-50">
                                <CardContent className="p-4">
                                    <Label className="text-sm font-semibold mb-2 block">
                                        Colunas aceitas (principais):
                                    </Label>
                                    <div className="flex flex-wrap gap-1 mb-2">
                                        {['DESCRIÇÃO DO PRODUTO*', 'FABRICANTE/FORNECEDOR', 'MODELO/REFERÊNCIA', 'PREÇO DE CUSTO', 'PREÇO VENDA FINAL', 'VARIAÇÃO DE CORES'].map(col => (
                                            <Badge key={col} variant={col.includes('*') ? 'default' : 'outline'} className="text-xs">
                                                {col.replace('*', '')}
                                                {col.includes('*') && <span className="text-red-300 ml-0.5">*</span>}
                                            </Badge>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {['LARGURA', 'ALTURA', 'PROFUNDIDADE', 'ESTOQUE CD', 'ESTOQUE LOJAS', 'MARKUP', 'IMPOSTOS', 'FRETE', 'IPI', 'DESCONTOS', 'MONTAGEM'].map(col => (
                                            <Badge key={col} variant="outline" className="text-xs">
                                                {col}
                                            </Badge>
                                        ))}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">* Campos obrigatórios. Sistema aceita múltiplos formatos de cabeçalho.</p>
                                    <p className="text-xs text-amber-700 mt-1">Campos de estoque no CSV são aceitos apenas para compatibilidade e não são importados.</p>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Step 2: Preview */}
                    {step === 2 && (
                        <div className="space-y-4">
                            {catalogoError && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="w-4 h-4" />
                                    <AlertDescription>
                                        <p className="font-semibold">Erro ao carregar catálogo:</p>
                                        <p className="text-sm">{catalogoError}</p>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {errors.length > 0 && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="w-4 h-4" />
                                    <AlertDescription>
                                        <p className="font-medium mb-1">{errors.length} erro(s) de formato na leitura do arquivo:</p>
                                        <ul className="text-sm list-disc list-inside">
                                            {errors.slice(0, 5).map((err, i) => (
                                                <li key={i}>{err}</li>
                                            ))}
                                            {errors.length > 5 && (
                                                <li>... e mais {errors.length - 5} erros</li>
                                            )}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {/* Validação de Identidade (SKU / GTIN) */}
                            {validationResult && !validationResult.isValid && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="w-4 h-4" />
                                    <AlertDescription>
                                        <p className="font-semibold mb-1">
                                            Importação bloqueada por inconsistência ({validationResult.blockingErrors.length} erro(s) impeditivo(s)):
                                        </p>
                                        <p className="text-xs mb-2">
                                            O sistema exige SKU obrigatório/único e EAN válido (GTIN-8/12/13/14 com checksum). Corrija a planilha para prosseguir:
                                        </p>
                                        <ul className="text-xs list-disc list-inside max-h-40 overflow-y-auto space-y-1">
                                            {validationResult.blockingErrors.map((err, i) => (
                                                <li key={i}>{err}</li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {validationResult && validationResult.isValid && (
                                <div className="flex flex-wrap items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-xs">
                                    <Badge variant="outline" className="bg-white text-green-700 border-green-300 font-semibold">
                                        ✓ Validação de integridade aprovada
                                    </Badge>
                                    <span className="text-green-800">
                                        <strong>{validationResult.stats.novos}</strong> novo(s) a cadastrar
                                    </span>
                                    <span className="text-gray-400">•</span>
                                    <span className="text-blue-800">
                                        <strong>{validationResult.stats.atualizacoes}</strong> existente(s) a atualizar
                                    </span>
                                </div>
                            )}

                            {validationResult && validationResult.warnings && validationResult.warnings.length > 0 && (
                                <Alert className="bg-amber-50 border-amber-200 text-amber-900">
                                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                                    <AlertDescription>
                                        <p className="font-semibold text-xs mb-1">Avisos ({validationResult.warnings.length}):</p>
                                        <ul className="text-xs list-disc list-inside max-h-24 overflow-y-auto">
                                            {validationResult.warnings.map((w, i) => (
                                                <li key={i}>{w}</li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}

                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-semibold">
                                        {groupedProducts.length} produto(s) a importar
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        {parsedData.length} linha(s) no CSV
                                        {groupedProducts.length > parsedData.length && (
                                            <span className="text-blue-600 ml-1">
                                                (expandido de {parsedData.length} por variações de cor/tecido)
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                                    <X className="w-4 h-4 mr-1" />
                                    Escolher outro arquivo
                                </Button>
                            </div>

                            <Alert>
                                <AlertDescription>
                                    Estoque inicial dos itens importados será 0. Preencha os saldos por CD/loja diretamente no sistema após concluir a importação.
                                </AlertDescription>
                            </Alert>

                            <div className="space-y-3 max-h-[400px] overflow-y-auto">
                                {groupedProducts.slice(0, 200).map((product, index) => {
                                    // Regra de importação: estoque CSV é ignorado e inicia em 0
                                    let estoqueTotal = 0;

                                    // Se houver variações, calcula o range. Se não, usa o preço do produto.
                                    let precoMin = 0;
                                    let precoMax = 0;

                                    if (product.variacoes && product.variacoes.length > 0) {
                                        const precos = product.variacoes.map(v => v.preco_venda || 0).filter(p => p > 0);
                                        precoMin = precos.length > 0 ? Math.min(...precos) : 0;
                                        precoMax = precos.length > 0 ? Math.max(...precos) : 0;

                                        // Somar estoque das variações se existirem
                                        estoqueTotal = product.variacoes.reduce((sum, v) => {
                                            const estVar = 0;
                                            return sum + estVar;
                                        }, 0);
                                    } else {
                                        precoMin = product.preco_venda || 0;
                                        precoMax = precoMin;
                                    }

                                    return (
                                        <Card key={index} className="overflow-hidden">
                                            {/* Cabeçalho do produto */}
                                            <div className="bg-gray-50 px-4 py-3 border-b">
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        <h4 className="font-bold text-base flex items-center gap-2">
                                                            <Package className="w-4 h-4 text-green-600" />
                                                            {product.nome}{product.modelo_referencia ? ` - ${product.modelo_referencia}` : ''}
                                                        </h4>
                                                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                                                            {product.sku && (
                                                                <span>SKU: <span className="font-mono font-semibold text-gray-800">{product.sku}</span></span>
                                                            )}
                                                            {product.codigo_barras && (
                                                                <span>EAN: <span className="font-mono font-medium text-gray-700">{product.codigo_barras}</span></span>
                                                            )}
                                                            {product.fornecedor_nome && (
                                                                <span>Fornecedor: <span className="font-medium text-gray-700">{product.fornecedor_nome}</span></span>
                                                            )}
                                                            {product.categoria && (
                                                                <span>Categoria: <span className="font-medium text-gray-700">{product.categoria}</span></span>
                                                            )}
                                                            {product.cor && (
                                                                <span className="flex items-center gap-1">
                                                                    Cor:
                                                                    <div className="w-2 h-2 rounded-full border shadow-sm flex-shrink-0"
                                                                        style={{ backgroundColor: getColorHex(product.cor) || '#ccc' }}
                                                                    />
                                                                    <span className="font-medium text-gray-700">{product.cor}</span>
                                                                </span>
                                                            )}
                                                            {(product.largura || product.altura || product.profundidade) && (
                                                                <span>Dimensões: <span className="font-medium text-gray-700">{product.largura || '?'}x{product.altura || '?'}x{product.profundidade || '?'} cm</span></span>
                                                            )}
                                                            {showFinancials && product.markup_aplicado && (
                                                                <span>Markup: <span className="font-medium text-gray-700">{product.markup_aplicado}</span></span>
                                                            )}
                                                            {product.ncm && (
                                                                <span>NCM: <span className="font-medium">{product.ncm}</span></span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="text-right flex-shrink-0">
                                                        {product.variacoes.length > 0 && (
                                                            <Badge variant="secondary" className="mb-1">
                                                                {product.variacoes.length} variação(ões)
                                                            </Badge>
                                                        )}
                                                        <div className="text-xs text-gray-500">
                                                            {estoqueTotal} un total
                                                        </div>
                                                        <div className="text-sm font-semibold text-green-600">
                                                            {precoMin === precoMax ?
                                                                `R$ ${precoMin.toFixed(2)}` :
                                                                `R$ ${precoMin.toFixed(2)} - R$ ${precoMax.toFixed(2)}`
                                                            }
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Tabela de variações (apenas se houver mais de uma ou se for legível) */}
                                            {product.variacoes.length > 0 && (
                                                <CardContent className="p-0">
                                                    <div className="max-h-[180px] overflow-y-auto">
                                                        <table className="w-full text-xs">
                                                            <thead className="bg-gray-100 sticky top-0">
                                                                <tr>
                                                                    <th className="text-left px-3 py-2 font-medium">Cor</th>
                                                                    <th className="text-left px-3 py-2 font-medium">Dimensões</th>
                                                                    {showFinancials && <th className="text-right px-3 py-2 font-medium">Custo</th>}
                                                                    <th className="text-right px-3 py-2 font-medium">Venda</th>
                                                                    <th className="text-right px-3 py-2 font-medium">Est.</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {product.variacoes.map((v, i) => {
                                                                    const estVar = 0;

                                                                    const dims = [v.largura, v.altura, v.profundidade].filter(d => d).join('×');

                                                                    return (
                                                                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                                            <td className="px-3 py-2">
                                                                                <div className="flex items-center gap-2">
                                                                                    <div
                                                                                        className="w-4 h-4 rounded border shadow-sm flex-shrink-0"
                                                                                        style={{ backgroundColor: v.cor_hex || '#ccc' }}
                                                                                    />
                                                                                    <span className="truncate max-w-[100px]" title={v.cor || 'Sem cor'}>
                                                                                        {v.cor || 'Sem cor'}
                                                                                    </span>
                                                                                    {v.tamanho && (
                                                                                        <span className="text-gray-400">({v.tamanho})</span>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-3 py-2 text-gray-500">
                                                                                {dims ? `${dims} cm` : '-'}
                                                                            </td>
                                                                            {showFinancials && (
                                                                                <td className="px-3 py-2 text-right text-gray-500">
                                                                                    {v.preco_custo > 0 ? `R$ ${v.preco_custo.toFixed(2)}` : '-'}
                                                                                </td>
                                                                            )}
                                                                            <td className="px-3 py-2 text-right font-medium text-green-600">
                                                                                R$ {(v.preco_venda || 0).toFixed(2)}
                                                                            </td>
                                                                            <td className="px-3 py-2 text-right">
                                                                                <Badge
                                                                                    variant={estVar > 0 ? 'secondary' : 'outline'}
                                                                                    className="text-xs px-1.5"
                                                                                >
                                                                                    {estVar}
                                                                                </Badge>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </CardContent>
                                            )}
                                        </Card>
                                    );
                                })}
                                {groupedProducts.length > 200 && (
                                    <div className="text-center py-6 border-2 border-dashed rounded-lg bg-gray-50">
                                        <p className="text-gray-500">
                                            Mostrando visualização dos primeiros <span className="font-semibold text-gray-700">200</span> produtos para otimizar o desempenho.
                                        </p>
                                        <p className="font-medium text-green-700 mt-1">
                                            Fique tranquilo! Todos os {groupedProducts.length} produtos da planilha serão importados ao continuar.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 3: Importing */}
                    {step === 3 && (
                        <div className="space-y-6 py-8">
                            <div className="text-center">
                                {importing ? (
                                    <>
                                        <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-green-600" />
                                        <p className="text-lg font-medium">Importando produtos...</p>
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-12 h-12 mx-auto mb-4 text-green-600" />
                                        <p className="text-lg font-medium text-green-600">Importação concluída!</p>
                                    </>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Progress value={progress} className="h-2" />
                                <div className="flex justify-between items-center text-sm text-gray-500">
                                    <span>{importing ? 'Processando itens...' : 'Processamento finalizado'}</span>
                                    <span className="font-semibold">{progress}%</span>
                                </div>
                            </div>

                            {/* Resumo pós-importação */}
                            {!importing && importSummary && (
                                <div className="mt-6 space-y-4">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                                        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                            <p className="text-xs text-green-700 font-medium">Criados</p>
                                            <p className="text-2xl font-bold text-green-800">{importSummary.criados}</p>
                                        </div>
                                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                            <p className="text-xs text-blue-700 font-medium">Atualizados</p>
                                            <p className="text-2xl font-bold text-blue-800">{importSummary.atualizados}</p>
                                        </div>
                                        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                            <p className="text-xs text-gray-600 font-medium">Ignorados</p>
                                            <p className="text-2xl font-bold text-gray-700">{importSummary.ignorados}</p>
                                        </div>
                                        <div className={`p-3 rounded-lg border ${importSummary.falharam > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                                            <p className={`text-xs font-medium ${importSummary.falharam > 0 ? 'text-red-700' : 'text-gray-600'}`}>Falhas</p>
                                            <p className={`text-2xl font-bold ${importSummary.falharam > 0 ? 'text-red-800' : 'text-gray-700'}`}>{importSummary.falharam}</p>
                                        </div>
                                    </div>

                                    {importSummary.falhasDetalhadas?.length > 0 && (
                                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                            <p className="text-xs font-semibold text-red-800 mb-2">Erros detalhados:</p>
                                            <ul className="text-xs text-red-700 list-disc list-inside max-h-36 overflow-y-auto space-y-1 font-mono">
                                                {importSummary.falhasDetalhadas.map((falha, idx) => (
                                                    <li key={idx}>{falha}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Visualização de Grade: Itens sendo processados agora */}
                            {importing && currentlyProcessing.length > 0 && (
                                <div className="mt-8 pt-6 border-t border-gray-100">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3 text-center">Processando Itens ({groupedProducts.length}x)</p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {currentlyProcessing.map((itemName, idx) => (
                                            <div
                                                key={`${itemName}-${idx}`}
                                                className="bg-gray-50 rounded-md border border-gray-100 p-3 flex items-center gap-3 animate-pulse shadow-sm"
                                            >
                                                <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center flex-shrink-0">
                                                    <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                                                </div>
                                                <p className="text-sm font-medium text-gray-700 truncate" title={itemName}>
                                                    {itemName}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => {
                            if (importing) {
                                cancelImportRef.current = true;
                                toast.info('Cancelando importação...');
                            } else {
                                handleClose();
                            }
                        }}
                    >
                        {step === 3 && !importing ? 'Concluir' : 'Cancelar'}
                    </Button>
                    {step === 2 && (
                        <div className="flex gap-2">
                            

                            <Button
                                onClick={handleImport}
                                disabled={!validationResult?.isValid || !organization?.id || !!catalogoError || groupedProducts.length === 0 || importing}
                                className="bg-green-600 hover:bg-green-700 gap-2 disabled:opacity-50"
                            >
                                <Upload className="w-4 h-4" />
                                Importar {groupedProducts.length} Produto(s)
                            </Button>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
