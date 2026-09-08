import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant, useLojas } from '@/contexts/TenantContext';
import { useAuth } from '@/hooks/useAuth';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
    Package,
    Palette,
    DollarSign,
    ImageIcon,
    ClipboardCheck,
    Check,
    Loader2,
    Plus,
    Trash2,
    AlertTriangle,
    Ruler,
    Upload,
    X,
    Link as LinkIcon,
    ChevronsUpDown,
    Warehouse
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { CATEGORIAS, AMBIENTES, MATERIAIS, TIPOS_ENTREGA, CAMPOS_ESTOQUE_LOJA, obterCampoEstoqueDaLoja } from '@/constants/productConstants';
import {
    normalizeProductName,
    normalizeColor,
    checkDuplicateProduct,
    validateProduct,
    validateVariations,
    formatPrice,
    formatDimensions,
    generateSKU
} from '@/utils/productFormatters';
import { calculateFinalPriceFromMarkup, toMultiplierFromPercent, toPercentFromMultiplier } from '@/utils/markupCalculator';
import FornecedorModal from '@/components/cadastros/FornecedorModal';
import FurnitureColorPicker, { getColorHex } from './FurnitureColorPicker';
import ProdutoHistoricoTab from './ProdutoHistoricoTab';
import { detectProductKeywordSuggestion } from '@/lib/productKeywordDetector';
import { isValidGTIN, normalizeGTIN, normalizeSKU, generateSafeSKU } from '@/utils/gtinValidator';

const VIEW_OPTIONS = [
    { id: 'ficha', name: 'Ficha do Produto', icon: Package },
    { id: 'historico', name: 'Histórico', icon: ClipboardCheck },
];

const FIELD_TO_SECTION = {
    sku: 'secao-identificacao',
    codigo_barras: 'secao-identificacao',
    ncm: 'secao-fiscal-logistico',
    cest: 'secao-fiscal-logistico',
    cfop: 'secao-fiscal-logistico',
    origem_mercadoria: 'secao-fiscal-logistico',
    peso_bruto: 'secao-fiscal-logistico',
    peso_liquido: 'secao-fiscal-logistico',
    altura_embalagem: 'secao-fiscal-logistico',
    largura_embalagem: 'secao-fiscal-logistico',
    profundidade_embalagem: 'secao-fiscal-logistico',
    preco_venda: 'secao-financeiro-estoque',
    valor_montagem: 'secao-financeiro-estoque',
    preco_custo_tabela: 'secao-financeiro-estoque',
    impostos_percentual: 'secao-financeiro-estoque',
    frete_custo: 'secao-financeiro-estoque',
    ipi_percentual: 'secao-financeiro-estoque',
    estoque_cd: 'secao-financeiro-estoque',
    estoque_minimo: 'secao-financeiro-estoque',
    estoque_ideal: 'secao-financeiro-estoque',
    largura: 'secao-caracteristicas',
    altura: 'secao-caracteristicas',
    profundidade: 'secao-caracteristicas',
    cor: 'secao-caracteristicas',
    material: 'secao-caracteristicas',
    nome: 'secao-identificacao',
    categoria: 'secao-identificacao',
    fornecedor_id: 'secao-identificacao',
    fotos: 'secao-fotos'
};

const FornecedorCombobox = ({ fornecedores = [], value, onChange, disabled }) => {
    const [open, setOpen] = useState(false);
    const fornecedorSelecionado = fornecedores.find((f) => String(f.id) === String(value));
    const label = fornecedorSelecionado
        ? (fornecedorSelecionado.nome || fornecedorSelecionado.nome_empresa || 'Fornecedor')
        : 'Selecione o fornecedor';

    const fornecedoresFiltrados = useMemo(
        () => [...fornecedores].sort((a, b) => (a.nome_empresa || a.nome || '').localeCompare((b.nome_empresa || b.nome || ''), 'pt-BR')),
        [fornecedores]
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className="w-full justify-between bg-white"
                >
                    <span className="truncate">{label}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Buscar fornecedor..." />
                    <CommandList>
                        <CommandEmpty>Nenhum fornecedor encontrado.</CommandEmpty>
                        <CommandGroup>
                            {fornecedoresFiltrados.map((fornecedor) => {
                                const fornecedorNome = fornecedor.nome || fornecedor.nome_empresa || 'Fornecedor';
                                return (
                                    <CommandItem
                                        key={fornecedor.id}
                                        value={`${fornecedorNome} ${fornecedor.cnpj || ''}`}
                                        onSelect={() => {
                                            onChange(String(fornecedor.id));
                                            setOpen(false);
                                        }}
                                    >
                                        <Check className="mr-2 h-4 w-4 opacity-0" />
                                        <span className="truncate">{fornecedorNome}</span>
                                        {fornecedor.cnpj ? <span className="ml-2 text-xs text-muted-foreground">{fornecedor.cnpj}</span> : null}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

const ESTOQUE_LOJA_FIELDS = Object.values(CAMPOS_ESTOQUE_LOJA).filter((field) => field !== 'estoque_cd');

const parseFlexibleCharge = (rawValue, baseAmount) => {
    const rawText = String(rawValue ?? '').trim();
    if (!rawText) {
        return {
            rawText,
            isPercent: false,
            value: 0,
            percent: 0,
            amount: 0,
            isValid: true,
        };
    }

    const normalized = rawText
        .replace(/\s+/g, '')
        .replace('R$', '')
        .replace(',', '.');

    const isPercent = normalized.includes('%');
    const numericText = normalized.replace('%', '');
    const value = parseFloat(numericText);

    if (!Number.isFinite(value) || value < 0) {
        return {
            rawText,
            isPercent,
            value: 0,
            percent: 0,
            amount: 0,
            isValid: false,
        };
    }

    if (isPercent) {
        return {
            rawText,
            isPercent: true,
            value,
            percent: value,
            amount: baseAmount > 0 ? (baseAmount * value) / 100 : 0,
            isValid: true,
        };
    }

    return {
        rawText,
        isPercent: false,
        value,
        percent: baseAmount > 0 ? (value / baseAmount) * 100 : 0,
        amount: value,
        isValid: true,
    };
};

const formatCurrencyBRL = (value) =>
    Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

// Estado inicial do formulário
const INITIAL_FORM_DATA = {
    nome: '',
    sku: '',
    modelo_referencia: '',
    categoria: '',
    ambiente: '',
    fornecedor_id: '',
    fornecedor_nome: '',
    descricao: '',
    tipo_entrega_padrao: 'desmontado',
    material: '',
    // === DADOS FISCAIS ===
    ncm: '',
    cest: '',
    cfop: '',
    unidade: 'UN', // Unidade comercial: UN, PC, CX, KG, MT
    origem_mercadoria: '0', // 0=Nacional, 1=Estrangeira importação direta, etc
    // Override fiscal por produto (vazio = usa padrão da org)
    csosn: '',
    cst_icms: '',
    cst_pis: '',
    cst_cofins: '',
    aliquota_icms: '',
    percentual_tributos: '',
    // === DADOS LOGÍSTICOS (Cubagem/Peso) ===
    peso_bruto: '',
    peso_liquido: '',
    altura_embalagem: '',
    largura_embalagem: '',
    profundidade_embalagem: '',
    // Preços
    preco_custo: '',
    preco_custo_tabela: '', // Preço fixo do fornecedor (tabela)
    impostos_percentual: '', // % estimada de impostos para formação de preço
    frete_custo: '', // % de frete para formação de preço
    ipi_percentual: '', // % de IPI para formação de preço
    preco_custo_promocional: '', // Preço quando comprado em promoção
    promocao_inicio: '', // Data início da promoção
    promocao_fim: '', // Data fim da promoção
    promocao_observacao: '', // Observação da promoção
    tem_promocao: false, // Toggle para ativar seção promocional
    preco_venda: '',
    markup_multiplicador: '',
    markup_percentual: '',
    preco_final_sugerido: '',
    preco_final_manual: '',
    usar_markup_fornecedor: false,
    valor_montagem: '',
    // Dimensões do produto
    largura: '',
    altura: '',
    profundidade: '',
    // Cor do produto (único, sem variações)
    cor: '',
    cor_hex: '',
    cores: [],
    // Estoque
    estoque_cd: '',
    // Dynamic store fields will be merged in useEffect
    quantidade_estoque: '', // Será a soma
    estoque_minimo: '',
    estoque_ideal: '',
    fotos: [],
    codigo_barras: '',
    ativo: true,
};


export default function ProdutoCadastroCompleto({
    isOpen,
    onClose,
    onSave,
    produto = null,
    isLoading = false,
    focusField = null,
    readOnly = false
}) {
    const [formData, setFormData] = useState(INITIAL_FORM_DATA);
    const [errors, setErrors] = useState({});
    const [duplicatas, setDuplicatas] = useState([]);
    const [uploadingImages, setUploadingImages] = useState(false);
    const [fotoUrlInput, setFotoUrlInput] = useState('');
    const [activeView, setActiveView] = useState('ficha');
    const [showFornecedorModal, setShowFornecedorModal] = useState(false);
    const [dismissedSuggestionName, setDismissedSuggestionName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const submitLockRef = useRef(false);

    // Multi-Tenant: Carrega lojas dinâmicas e configurações
    const { data: lojas = [] } = useLojas();
    const { settings, organization } = useTenant();
    const { user } = useAuth();
    const isVendedor = String(user?.cargo || '').toLowerCase().includes('vendedor');
    const showFinancials = !readOnly;

    const estoqueUnits = useMemo(() => {
        const units = [];
        const usedFields = new Set();

        const addUnit = (label, field) => {
            if (!field || usedFields.has(field)) return;
            usedFields.add(field);
            units.push({ label, field });
        };

        addUnit('Depósito / CD', 'estoque_cd');
        (lojas || []).forEach(loja => {
            const field = obterCampoEstoqueDaLoja(loja);
            const label = loja?.nome || loja?.codigo || 'Loja';
            addUnit(label, field);
        });

        return units;
    }, [lojas]);

    // Busca dados necessários
    const { data: fornecedores } = useQuery({
        queryKey: ['fornecedores'],
        queryFn: () => base44.entities.Fornecedor.list()
    });

    const { data: produtosExistentes } = useQuery({
        queryKey: ['produtos-para-duplicata'],
        queryFn: () => base44.entities.Produto.list()
    });

    const coresCatalogo = useMemo(() => {
        const setCores = new Set();
        (produtosExistentes || []).forEach((p) => {
            const corRaw = String(p?.cor || '').trim();
            if (!corRaw) return;
            corRaw
                .split('/')
                .map((c) => c.trim())
                .filter(Boolean)
                .forEach((c) => setCores.add(c));
        });
        return Array.from(setCores).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }, [produtosExistentes]);

    const keywordSuggestion = useMemo(
        () => detectProductKeywordSuggestion(formData.nome, {
            returnDefault: true,
            defaultCategoria: 'Outros',
        }),
        [formData.nome]
    );

    const normalizedSuggestionName = useMemo(
        () => (formData.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
        [formData.nome]
    );

    const suggestedCategoria = keywordSuggestion.categoriaSuggestion;
    const suggestedAmbiente = AMBIENTES.includes(keywordSuggestion.ambienteSuggestion)
        ? keywordSuggestion.ambienteSuggestion
        : null;

    const canApplyCategoriaSuggestion = suggestedCategoria
        && CATEGORIAS.includes(suggestedCategoria)
        && suggestedCategoria !== formData.categoria;

    const canApplyAmbienteSuggestion = suggestedAmbiente
        && suggestedAmbiente !== formData.ambiente;

    const shouldShowSuggestion = normalizedSuggestionName
        && dismissedSuggestionName !== normalizedSuggestionName
        && (canApplyCategoriaSuggestion || canApplyAmbienteSuggestion);

    const shouldShowCategoriaSuggestion = shouldShowSuggestion && canApplyCategoriaSuggestion;
    const shouldShowAmbienteSuggestion = shouldShowSuggestion && canApplyAmbienteSuggestion;

    const applyCategoriaSuggestion = () => {
        if (!canApplyCategoriaSuggestion) return;
        handleChange('categoria', suggestedCategoria);
    };

    const applyAmbienteSuggestion = () => {
        if (!canApplyAmbienteSuggestion) return;
        handleChange('ambiente', suggestedAmbiente);
    };

    // Inicializa com produto existente (modo edição)
    useEffect(() => {
        if (produto && isOpen) {
            const cleanedProduct = { ...produto };
            for (const key of Object.keys(INITIAL_FORM_DATA)) {
                if (cleanedProduct[key] === null || cleanedProduct[key] === undefined) {
                    cleanedProduct[key] = INITIAL_FORM_DATA[key];
                }
            }

            setFormData({
                ...INITIAL_FORM_DATA,
                ...cleanedProduct,
                sku: cleanedProduct.sku || '',
                codigo_barras: cleanedProduct.codigo_barras || '',
                modelo_referencia: cleanedProduct.modelo_referencia || '',
                preco_custo: cleanedProduct.preco_custo?.toString() || '',
                preco_custo_tabela: cleanedProduct.preco_custo_tabela?.toString() || cleanedProduct.preco_custo?.toString() || '',
                impostos_percentual: cleanedProduct.impostos_percentual ? `${cleanedProduct.impostos_percentual}%` : '',
                frete_custo: cleanedProduct.frete_custo ? `${cleanedProduct.frete_custo}%` : '',
                ipi_percentual: cleanedProduct.ipi_percentual ? `${cleanedProduct.ipi_percentual}%` : '',
                preco_custo_promocional: '', // Ignora valor do banco
                promocao_inicio: '',
                promocao_fim: '',
                promocao_observacao: '',
                tem_promocao: false, // Feature desabilitada
                preco_venda: cleanedProduct.preco_venda?.toString() || '',
                markup_multiplicador: cleanedProduct.markup_multiplicador?.toString() || '',
                markup_percentual: cleanedProduct.markup_percentual?.toString() || '',
                preco_final_sugerido: cleanedProduct.preco_final_sugerido?.toString() || '',
                preco_final_manual: cleanedProduct.preco_final_manual?.toString() || '',
                usar_markup_fornecedor: Boolean(cleanedProduct.usar_markup_fornecedor),
                valor_montagem: cleanedProduct.valor_montagem?.toString() || '',
                // Estoque
                estoque_cd: cleanedProduct.estoque_cd?.toString() || '',
                ...Object.fromEntries(
                    estoqueUnits.filter(u => u.field !== 'estoque_cd').map((u) => [u.field, cleanedProduct[u.field]?.toString() || ''])
                ),
                quantidade_estoque: cleanedProduct.quantidade_estoque?.toString() || '',
                estoque_minimo: cleanedProduct.estoque_minimo?.toString() || '',
                estoque_ideal: cleanedProduct.estoque_ideal?.toString() || '',
                largura: cleanedProduct.largura?.toString() || '',
                altura: cleanedProduct.altura?.toString() || '',
                profundidade: cleanedProduct.profundidade?.toString() || '',
                cfop: cleanedProduct.cfop || '',
                unidade: cleanedProduct.unidade || 'UN',
                origem_mercadoria: cleanedProduct.origem_mercadoria || cleanedProduct.origem || '0',
                peso_bruto: cleanedProduct.peso_bruto?.toString() || '',
                peso_liquido: cleanedProduct.peso_liquido?.toString() || '',
                altura_embalagem: cleanedProduct.altura_embalagem?.toString() || '',
                largura_embalagem: cleanedProduct.largura_embalagem?.toString() || '',
                profundidade_embalagem: cleanedProduct.profundidade_embalagem?.toString() || '',
                fotos: cleanedProduct.fotos || [],
                variacoes: cleanedProduct.variacoes || [],
                cores: cleanedProduct.cor ? [cleanedProduct.cor] : [],
            });
            setErrors({});
            setDuplicatas([]);
            setActiveView('ficha');
            setDismissedSuggestionName('');
        } else if (!produto && isOpen) {
            setFormData(INITIAL_FORM_DATA);
            setErrors({});
            setDuplicatas([]);
            setActiveView('ficha');
            setDismissedSuggestionName('');
        }
    }, [produto, isOpen]);

    const focusFieldInForm = (field) => {
        const target = document.getElementById(field) || document.querySelector(`[name="${field}"]`);
        if (!target) return false;

        target.focus();
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('ring-2', 'ring-red-500', 'ring-offset-2');

        setTimeout(() => {
            target.classList.remove('ring-2', 'ring-red-500', 'ring-offset-2');
        }, 3000);

        return true;
    };

    const scrollToSection = (sectionId) => {
        const target = document.getElementById(sectionId);
        if (!target) return false;

        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('ring-2', 'ring-red-500', 'ring-offset-2', 'rounded-xl');

        setTimeout(() => {
            target.classList.remove('ring-2', 'ring-red-500', 'ring-offset-2', 'rounded-xl');
        }, 3000);

        return true;
    };

    // Smart Validation: Foca no campo com erro dentro da ficha única
    useEffect(() => {
        if (readOnly) return;
        if (isOpen && focusField) {
            setActiveView('ficha');
            setTimeout(() => {
                const focused = focusFieldInForm(focusField);
                if (!focused && FIELD_TO_SECTION[focusField]) {
                    scrollToSection(FIELD_TO_SECTION[focusField]);
                }
            }, 300);
        }
    }, [isOpen, focusField, readOnly]);

    // Verifica duplicatas com base em características EXATAS
    useEffect(() => {
        if (formData.nome && formData.nome.length >= 3 && produtosExistentes) {
            const normalizeStr = (str) => (str || '').toString().toLowerCase().trim();

            const exactDuplicates = produtosExistentes.filter(p => {
                if (p.id === produto?.id) return false;

                return normalizeStr(p.nome) === normalizeStr(formData.nome) &&
                    normalizeStr(p.modelo_referencia) === normalizeStr(formData.modelo_referencia) &&
                    normalizeStr(p.categoria) === normalizeStr(formData.categoria) &&
                    normalizeStr(p.fornecedor_id) === normalizeStr(formData.fornecedor_id) &&
                    normalizeStr(p.cor) === normalizeStr(formData.cor) &&
                    normalizeStr(p.material) === normalizeStr(formData.material) &&
                    normalizeStr(p.largura) === normalizeStr(formData.largura) &&
                    normalizeStr(p.altura) === normalizeStr(formData.altura) &&
                    normalizeStr(p.profundidade) === normalizeStr(formData.profundidade);
            });

            setDuplicatas(exactDuplicates.length > 0 ? exactDuplicates : []);
        } else {
            setDuplicatas([]);
        }
    }, [
        formData.nome, formData.modelo_referencia, formData.categoria,
        formData.fornecedor_id, formData.cor, formData.material,
        formData.largura, formData.altura, formData.profundidade,
        produtosExistentes, produto?.id
    ]);

    const fornecedorSelecionado = useMemo(
        () => fornecedores?.find((f) => String(f.id) === String(formData.fornecedor_id)),
        [fornecedores, formData.fornecedor_id]
    );

    // Regra de formação: (custo + IPI + frete + montagem) x markup
    // Precedência do markup: produto > fornecedor > regra da categoria
    const suggestedPrice = useMemo(() => {
        const custoAtivo = parseFloat(formData.preco_custo_tabela || formData.preco_custo || 0);
        if (!(custoAtivo > 0)) return 0;

        const impostosCalc = parseFlexibleCharge(formData.impostos_percentual, custoAtivo);
        const freteCalc = parseFlexibleCharge(formData.frete_custo, custoAtivo);
        const ipiCalc = parseFlexibleCharge(formData.ipi_percentual, custoAtivo);
        const valorMontagem = parseFloat(formData.valor_montagem || 0);

        const custoComAdicionais =
            custoAtivo +
            impostosCalc.amount +
            freteCalc.amount +
            ipiCalc.amount +
            valorMontagem;

        const usaMarkupFornecedor = Boolean(formData.usar_markup_fornecedor) && Boolean(fornecedorSelecionado?.usar_markup_padrao);
        const multiplicadorFornecedor = fornecedorSelecionado?.markup_padrao_multiplicador;
        const percentualFornecedor = fornecedorSelecionado?.markup_padrao_percentual;

        const multiplicadorProduto = formData.markup_multiplicador;
        const percentualProduto = formData.markup_percentual;

        const precoViaMarkup = calculateFinalPriceFromMarkup(
            custoComAdicionais,
            multiplicadorProduto || (usaMarkupFornecedor ? multiplicadorFornecedor : null),
            percentualProduto || (usaMarkupFornecedor ? percentualFornecedor : null)
        );

        if (precoViaMarkup > 0) {
            return Math.round(precoViaMarkup * 100) / 100;
        }

        const markupCategorias = settings?.markup_categorias || {};
        const markupCategoria = markupCategorias[formData.categoria] || markupCategorias.default || 45;
        const precoSugerido = custoComAdicionais * (1 + markupCategoria / 100);
        return Math.round(precoSugerido * 100) / 100;
    }, [
        formData.preco_custo_tabela,
        formData.preco_custo,
        formData.impostos_percentual,
        formData.ipi_percentual,
        formData.frete_custo,
        formData.valor_montagem,
        formData.categoria,
        formData.markup_multiplicador,
        formData.markup_percentual,
        formData.usar_markup_fornecedor,
        fornecedorSelecionado,
        settings?.markup_categorias,
    ]);

    const pricingBreakdown = useMemo(() => {
        const custoAtivo = parseFloat(formData.preco_custo_tabela || formData.preco_custo || 0);
        const impostosCalc = parseFlexibleCharge(formData.impostos_percentual, custoAtivo);
        const freteCalc = parseFlexibleCharge(formData.frete_custo, custoAtivo);
        const ipiCalc = parseFlexibleCharge(formData.ipi_percentual, custoAtivo);
        const valorMontagem = parseFloat(formData.valor_montagem || 0);

        const custoComAdicionais =
            custoAtivo + impostosCalc.amount + freteCalc.amount + ipiCalc.amount + valorMontagem;

        return {
            custoAtivo,
            impostosCalc,
            freteCalc,
            ipiCalc,
            valorMontagem,
            custoComAdicionais,
        };
    }, [
        formData.preco_custo_tabela,
        formData.preco_custo,
        formData.impostos_percentual,
        formData.frete_custo,
        formData.ipi_percentual,
        formData.valor_montagem,
    ]);

    // Atualiza campo do formulário
    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (field === 'nome') {
            setDismissedSuggestionName('');
        }
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    };

    // Normaliza nome ao sair do campo
    const handleNomeBlur = () => {
        if (formData.nome) {
            handleChange('nome', normalizeProductName(formData.nome));
        }
    };

    // Atualiza fornecedor
    const handleFornecedorChange = (value) => {
        const fornecedor = fornecedores?.find(f => f.id.toString() === value);
        const multiplicadorFornecedor = fornecedor?.markup_padrao_multiplicador;
        const percentualFornecedor = fornecedor?.markup_padrao_percentual;
        const usarMarkupFornecedor = Boolean(fornecedor?.usar_markup_padrao);

        setFormData(prev => ({
            ...prev,
            fornecedor_id: value,
            fornecedor_nome: fornecedor?.nome || fornecedor?.nome_empresa || '',
            usar_markup_fornecedor: usarMarkupFornecedor,
            markup_multiplicador: usarMarkupFornecedor && multiplicadorFornecedor ? multiplicadorFornecedor.toString() : prev.markup_multiplicador,
            markup_percentual: usarMarkupFornecedor && percentualFornecedor ? percentualFornecedor.toString() : prev.markup_percentual,
        }));
    };

    // Upload de imagens
    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setUploadingImages(true);
        try {
            const uploadPromises = files.map(file => base44.integrations.Core.UploadFile({ file }));
            const results = await Promise.all(uploadPromises);
            const urls = results.map(r => r.file_url);
            setFormData(prev => ({
                ...prev,
                fotos: [...prev.fotos, ...urls]
            }));
            toast.success(`${files.length} imagem(ns) enviada(s)`);
        } catch (error) {
            console.error('Erro no upload:', error);
            toast.error('Erro ao enviar imagens');
        } finally {
            setUploadingImages(false);
        }
    };

    // Adiciona foto por URL
    const handleAddFotoUrl = () => {
        if (!fotoUrlInput.trim()) return;
        try {
            new URL(fotoUrlInput);
            setFormData(prev => ({
                ...prev,
                fotos: [...prev.fotos, fotoUrlInput.trim()]
            }));
            setFotoUrlInput('');
        } catch {
            toast.error('URL inválida');
        }
    };

    // Remove foto
    const handleRemoveFoto = (index) => {
        setFormData(prev => ({
            ...prev,
            fotos: prev.fotos.filter((_, i) => i !== index)
        }));
    };

    // Validação geral
    const validateForm = () => {
        const newErrors = {};

        if (!formData.nome || formData.nome.trim().length < 3) {
            newErrors.nome = 'Nome deve ter pelo menos 3 caracteres';
        }
        if (!formData.categoria) {
            newErrors.categoria = 'Selecione uma categoria';
        }

        const precoVenda = parseFloat(formData.preco_venda);
        if (!precoVenda || precoVenda <= 0) {
            newErrors.preco_venda = 'Preço de venda deve ser maior que zero';
        }

        // Validação de SKU
        if (formData.sku && formData.sku.trim()) {
            const normalizedCandidate = normalizeSKU(formData.sku);
            const dupSku = (produtosExistentes || []).find(
                p => p.id !== produto?.id && p.sku && normalizeSKU(p.sku) === normalizedCandidate
            );
            if (dupSku) {
                newErrors.sku = `Este SKU já está em uso pelo produto "${dupSku.nome}"`;
            }
        } else if (produto) {
            newErrors.sku = 'SKU é obrigatório para produtos já cadastrados';
        }

        // Validação de Código de Barras (GTIN)
        if (formData.codigo_barras && formData.codigo_barras.trim()) {
            if (!isValidGTIN(formData.codigo_barras)) {
                newErrors.codigo_barras = 'Código de barras inválido. Deve ser um GTIN oficial (8, 12, 13 ou 14 dígitos com dígito verificador correto)';
            } else {
                const normGtin = normalizeGTIN(formData.codigo_barras, true);
                const dupEan = (produtosExistentes || []).find(
                    p => p.id !== produto?.id && p.codigo_barras && normalizeGTIN(p.codigo_barras, true) === normGtin
                );
                if (dupEan) {
                    newErrors.codigo_barras = `Este código de barras já está cadastrado no produto "${dupEan.nome}"`;
                }
            }
        }

        setErrors(newErrors);

        if (Object.keys(newErrors).length > 0) {
            setActiveView('ficha');
            const firstErrorField = Object.keys(newErrors)[0];
            setTimeout(() => {
                const focused = focusFieldInForm(firstErrorField);
                if (!focused && FIELD_TO_SECTION[firstErrorField]) {
                    scrollToSection(FIELD_TO_SECTION[firstErrorField]);
                }
            }, 100);
            toast.error('Verifique os campos obrigatórios');
        }

        return Object.keys(newErrors).length === 0;
    };


    // Aplica preço sugerido
    const applySuggestedMarkup = () => {
        if (suggestedPrice) {
            handleChange('preco_venda', suggestedPrice.toString());
            handleChange('preco_final_manual', suggestedPrice.toString());
        }
    };

    // Submete o formulário
    const handleSubmit = async () => {
        if (readOnly || !onSave) return;
        if (submitLockRef.current || isLoading || isSubmitting) return;
        if (!validateForm()) return;

        submitLockRef.current = true;
        setIsSubmitting(true);

        try {
            // Calcula estoque total das lojas
            const estoqueCd = parseInt(formData.estoque_cd) || 0;
            const estoquePorLoja = estoqueUnits.filter(u => u.field !== 'estoque_cd').reduce((acc, u) => {
                acc[u.field] = parseInt(formData[u.field]) || 0;
                return acc;
            }, {});
            const estoqueTotal = estoqueCd + Object.values(estoquePorLoja).reduce((sum, value) => sum + value, 0);

            let precoVenda = parseFloat(formData.preco_venda) || 0;
            let precoCusto = parseFloat(formData.preco_custo) || 0;
            let largura = formData.largura ? parseFloat(formData.largura) : null;
            let altura = formData.altura ? parseFloat(formData.altura) : null;
            let profundidade = formData.profundidade ? parseFloat(formData.profundidade) : null;
            const custoBase = parseFloat(formData.preco_custo_tabela) || precoCusto || 0;
            const impostosCalc = parseFlexibleCharge(formData.impostos_percentual, custoBase);
            const freteCalc = parseFlexibleCharge(formData.frete_custo, custoBase);
            const ipiCalc = parseFlexibleCharge(formData.ipi_percentual, custoBase);



            const skuFinal = (formData.sku && formData.sku.trim())
                ? normalizeSKU(formData.sku)
                : (produto?.sku || generateSafeSKU('PRD'));
            const gtinFinal = (formData.codigo_barras && formData.codigo_barras.trim())
                ? normalizeGTIN(formData.codigo_barras, true)
                : null;

            const dataToSave = {
                sku: skuFinal,
                codigo_barras: gtinFinal,
                nome: (isVendedor && !!produto) ? produto.nome : normalizeProductName(formData.nome),
                modelo_referencia: formData.modelo_referencia || null,
                categoria: formData.categoria,
                ambiente: formData.ambiente || null,
                fornecedor_id: formData.fornecedor_id || null,
                fornecedor_nome: formData.fornecedor_nome || null,
                descricao: formData.descricao || null,
                tipo_entrega_padrao: formData.tipo_entrega_padrao,
                largura,
                altura,
                profundidade,
                material: formData.material || null,
                ncm: formData.ncm || null,
                cest: formData.cest || null,
                cfop: formData.cfop || null,
                unidade: formData.unidade || 'UN',
                origem_mercadoria: formData.origem_mercadoria || '0',
                csosn: formData.csosn || null,
                cst_icms: formData.cst_icms || null,
                cst_pis: formData.cst_pis || null,
                cst_cofins: formData.cst_cofins || null,
                aliquota_icms: formData.aliquota_icms ? parseFloat(formData.aliquota_icms) : null,
                percentual_tributos: formData.percentual_tributos ? parseFloat(formData.percentual_tributos) : null,
                peso_bruto: formData.peso_bruto ? parseFloat(formData.peso_bruto) : null,
                peso_liquido: formData.peso_liquido ? parseFloat(formData.peso_liquido) : null,
                altura_embalagem: formData.altura_embalagem ? parseFloat(formData.altura_embalagem) : null,
                largura_embalagem: formData.largura_embalagem ? parseFloat(formData.largura_embalagem) : null,
                profundidade_embalagem: formData.profundidade_embalagem ? parseFloat(formData.profundidade_embalagem) : null,
                // Preços de custo
                preco_custo_tabela: parseFloat(formData.preco_custo_tabela) || null,
                impostos_percentual: formData.impostos_percentual ? impostosCalc.percent : null,
                frete_custo: formData.frete_custo ? freteCalc.percent : null,
                ipi_percentual: formData.ipi_percentual ? ipiCalc.percent : null,
                // Promoção removida da interface - limpando dados antigos
                preco_custo_promocional: null,
                promocao_inicio: null,
                promocao_fim: null,
                promocao_observacao: null,
                // preco_custo agora é sempre igual ao preço de tabela
                preco_custo: parseFloat(formData.preco_custo_tabela) || precoCusto || null,
                markup_multiplicador: formData.markup_multiplicador ? parseFloat(formData.markup_multiplicador) : null,
                markup_percentual: formData.markup_percentual ? parseFloat(formData.markup_percentual) : null,
                preco_final_sugerido: suggestedPrice > 0 ? suggestedPrice : null,
                preco_final_manual: formData.preco_final_manual ? parseFloat(formData.preco_final_manual) : null,
                usar_markup_fornecedor: Boolean(formData.usar_markup_fornecedor),
                preco_venda: precoVenda,
                valor_montagem: formData.valor_montagem ? parseFloat(formData.valor_montagem) : null,
                quantidade_estoque: estoqueTotal,
                estoque_cd: estoqueCd,
                ...estoquePorLoja,
                estoque_minimo: formData.estoque_minimo ? parseInt(formData.estoque_minimo) : 0,
                estoque_ideal: formData.estoque_ideal ? parseInt(formData.estoque_ideal) : 0,
                cor: formData.cor || null,
                cor_hex: formData.cor_hex || null,
                variacoes: formData.variacoes || [],
                fotos: formData.fotos,
                ativo: formData.ativo,
            };

            await Promise.resolve(onSave(dataToSave));

            // Se for um novo cadastro e tiver múltiplas cores selecionadas, cria as réplicas
            if (!produto && formData.cores && formData.cores.length > 1) {
                const remainingColors = formData.cores.slice(1);
                for (const otherColor of remainingColors) {
                    const varToken = otherColor.toUpperCase().replace(/[^A-Z0-9]/g, '-');
                    const replicaSku = generateSafeSKU(`${skuFinal}-${varToken}`.substring(0, 40));
                    const replicaData = {
                        ...dataToSave,
                        sku: replicaSku,
                        cor: otherColor,
                        cor_hex: getColorHex(otherColor),
                        codigo_barras: null, // Clear barcode to prevent unique constraint violation
                    };

                    const createdReplica = await base44.entities.Produto.create(replicaData);

                    // Cria o histórico de preços inicial para a réplica
                    try {
                        const precoNovo = parseFloat(replicaData.preco_venda) || 0;
                        if (createdReplica && createdReplica.id && precoNovo > 0) {
                            await base44.entities.HistoricoPrecos?.create?.({
                                organization_id: organization?.id || '00000000-0000-0000-0000-000000000001',
                                produto_id: createdReplica.id,
                                preco_antigo: 0,
                                preco_novo: precoNovo,
                                tipo: 'venda',
                                motivo: 'Cadastro Inicial (Réplica de Cor)',
                                usuario_nome: user?.nome || 'Sistema'
                            });
                        }
                    } catch (histErr) {
                        console.warn('Não foi possível registrar histórico de preços para réplica:', histErr);
                    }
                }
                toast.success(`${remainingColors.length} réplica(s) de cores criada(s) com sucesso`);
            }
        } finally {
            submitLockRef.current = false;
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose?.(); }}>
                <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
                        <DialogTitle className="text-xl font-bold">
                            {readOnly ? 'Ficha do Produto' : (produto ? 'Editar Produto' : 'Cadastrar Novo Produto')}
                        </DialogTitle>

                        {/* Navegação principal */}
                        <div className="flex items-center gap-1 mt-4 overflow-x-auto no-scrollbar pb-1">
                            {VIEW_OPTIONS.map((view) => {
                                const Icon = view.icon;
                                const isActive = activeView === view.id;

                                return (
                                    <button
                                        key={view.id}
                                        onClick={() => setActiveView(view.id)}
                                        className={cn(
                                            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                                            isActive
                                                ? "bg-green-600 text-white shadow-md shadow-green-200"
                                                : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                                        )}
                                    >
                                        <Icon className="w-4 h-4" />
                                        {view.name}
                                    </button>
                                );
                            })}
                        </div>
                    </DialogHeader>

                    {/* Conteúdo scrollável */}
                    <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50/30">
                        {activeView === 'ficha' && (
                            <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6">
                                {readOnly && formData.fotos?.length > 0 && (
                                    <div className="w-full rounded-2xl overflow-hidden bg-white shadow-md border border-gray-100">
                                        <div className="w-full h-[400px] bg-gray-50/50 flex items-center justify-center relative">
                                            <img
                                                src={formData.fotos[0]}
                                                alt="Foto principal"
                                                className="max-w-full max-h-full object-contain p-4 drop-shadow-md"
                                            />
                                            <div className="absolute top-4 left-4">
                                                <Badge className="bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-1 text-xs shadow-sm">
                                                    Foto Principal
                                                </Badge>
                                            </div>
                                        </div>
                                        {formData.fotos.length > 1 && (
                                            <div className="flex gap-3 p-4 overflow-x-auto bg-white border-t border-gray-100 no-scrollbar">
                                                {formData.fotos.map((foto, idx) => (
                                                    <div key={idx} className="flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-transparent hover:border-green-500 transition-all cursor-pointer bg-gray-50">
                                                        <img src={foto} className="w-full h-full object-cover" alt={`Foto ${idx + 1}`} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {readOnly && (!formData.fotos || formData.fotos.length === 0) && (
                                    <div className="w-full h-40 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-400 shadow-sm">
                                        <ImageIcon className="w-12 h-12 mb-3 text-gray-300" />
                                        <p className="font-medium text-gray-500">Nenhuma foto cadastrada para este produto</p>
                                    </div>
                                )}
                                <fieldset disabled={readOnly} className="space-y-6">
                                    <Card id="secao-identificacao" className="scroll-mt-4">
                                        <CardHeader>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Package className="w-4 h-4 text-green-600" />
                                                Identificação Básica
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="grid md:grid-cols-2 gap-4">
                                                <div className="md:col-span-2">
                                                    <Label htmlFor="nome">Nome do Produto *</Label>
                                                    <Input
                                                        id="nome"
                                                        value={formData.nome}
                                                        onChange={(e) => handleChange('nome', e.target.value)}
                                                        onBlur={handleNomeBlur}
                                                        placeholder="Ex: Sofá Retrátil 3 Lugares"
                                                        className={cn("text-lg", errors.nome && 'border-red-500')}
                                                        disabled={isVendedor && !!produto}
                                                    />
                                                    {isVendedor && !!produto && (
                                                        <p className="text-xs text-amber-700 mt-1">Perfil Vendedor não tem permissão para alterar o nome de um produto cadastrado.</p>
                                                    )}
                                                    {errors.nome && <p className="text-xs text-red-500 mt-1">{errors.nome}</p>}

                                                    {duplicatas.length > 0 && (
                                                        <Alert className="mt-2 border-amber-200 bg-amber-50">
                                                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                                                            <AlertDescription className="text-amber-800 text-sm">
                                                                <strong>Possíveis duplicatas encontradas</strong>
                                                            </AlertDescription>
                                                        </Alert>
                                                    )}
                                                </div>

                                                <div>
                                                    <Label htmlFor="sku">SKU / Código Interno *</Label>
                                                    <Input
                                                        id="sku"
                                                        value={formData.sku}
                                                        onChange={(e) => handleChange('sku', e.target.value)}
                                                        placeholder={produto ? "Ex: SOF-RET-3L" : "Gerado automaticamente se vazio"}
                                                        className={cn("font-mono", errors.sku && 'border-red-500')}
                                                    />
                                                    {errors.sku && <p className="text-xs text-red-500 mt-1">{errors.sku}</p>}
                                                    {!produto && !formData.sku && (
                                                        <p className="text-[11px] text-gray-400 mt-1">Deixe em branco para gerar SKU seguro automaticamente.</p>
                                                    )}
                                                </div>

                                                <div>
                                                    <Label htmlFor="codigo_barras">Código de Barras (EAN / GTIN)</Label>
                                                    <Input
                                                        id="codigo_barras"
                                                        value={formData.codigo_barras}
                                                        onChange={(e) => handleChange('codigo_barras', e.target.value)}
                                                        placeholder="7891234567890 (opcional)"
                                                        className={cn("font-mono", errors.codigo_barras && 'border-red-500')}
                                                    />
                                                    {errors.codigo_barras && <p className="text-xs text-red-500 mt-1">{errors.codigo_barras}</p>}
                                                    <p className="text-[11px] text-gray-400 mt-1">Opcional. Deve ser GTIN-8, 12, 13 ou 14 dígitos oficial.</p>
                                                </div>

                                                <div>
                                                    <Label htmlFor="modelo_referencia">Modelo / Referência</Label>
                                                    <Input
                                                        id="modelo_referencia"
                                                        value={formData.modelo_referencia}
                                                        onChange={(e) => handleChange('modelo_referencia', e.target.value)}
                                                        placeholder="REF-1234"
                                                    />
                                                </div>

                                                <div>
                                                    <Label>Fornecedor</Label>
                                                    <div className="flex gap-2">
                                                        <div className="flex-1">
                                                            <FornecedorCombobox
                                                                fornecedores={fornecedores || []}
                                                                value={formData.fornecedor_id?.toString() || ''}
                                                                onChange={handleFornecedorChange}
                                                            />
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="icon"
                                                            title="Cadastrar novo fornecedor"
                                                            onClick={() => setShowFornecedorModal(true)}
                                                        >
                                                            <Plus className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div>
                                                    <Label>Categoria *</Label>
                                                    {shouldShowCategoriaSuggestion && (
                                                        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 flex items-center justify-between gap-2">
                                                            <span>Categoria sugerida: <strong>{suggestedCategoria}</strong></span>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={applyCategoriaSuggestion}
                                                                    className="h-7 rounded border border-emerald-300 bg-white px-2 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                                                                >
                                                                    Aplicar
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setDismissedSuggestionName(normalizedSuggestionName)}
                                                                    className="text-[11px] text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
                                                                >
                                                                    Ignorar
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <Select
                                                        value={formData.categoria}
                                                        onValueChange={(value) => handleChange('categoria', value)}
                                                    >
                                                        <SelectTrigger id="categoria" className={errors.categoria ? 'border-red-500' : ''}>
                                                            <SelectValue placeholder="Selecione a categoria" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {CATEGORIAS.map(cat => (
                                                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div>
                                                    <div className="flex items-center justify-between">
                                                        <Label>Ambiente</Label>
                                                        {!!formData.ambiente && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleChange('ambiente', '')}
                                                                className="text-[11px] text-gray-500 underline underline-offset-2 hover:text-gray-700"
                                                            >
                                                                Limpar
                                                            </button>
                                                        )}
                                                    </div>
                                                    {shouldShowAmbienteSuggestion && (
                                                        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 flex items-center justify-between gap-2">
                                                            <span>Ambiente sugerido: <strong>{suggestedAmbiente}</strong></span>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={applyAmbienteSuggestion}
                                                                    className="h-7 rounded border border-emerald-300 bg-white px-2 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                                                                >
                                                                    Aplicar
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setDismissedSuggestionName(normalizedSuggestionName)}
                                                                    className="text-[11px] text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
                                                                >
                                                                    Ignorar
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <Select
                                                        value={formData.ambiente || '_empty'}
                                                        onValueChange={(value) => handleChange('ambiente', value === '_empty' ? '' : value)}
                                                    >
                                                        <SelectTrigger id="ambiente">
                                                            <SelectValue placeholder="Selecione o ambiente" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="_empty">Deixar em branco</SelectItem>
                                                            {AMBIENTES.map(amb => (
                                                                <SelectItem key={amb} value={amb}>{amb}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="md:col-span-2">
                                                    <Label>Descrição</Label>
                                                    <Textarea
                                                        value={formData.descricao}
                                                        onChange={(e) => handleChange('descricao', e.target.value)}
                                                        rows={3}
                                                        placeholder="Descrição detalhada para o e-commerce e etiquetas..."
                                                    />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card id="secao-caracteristicas" className="scroll-mt-4">
                                        <CardHeader>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Palette className="w-4 h-4 text-purple-600" />
                                                Cores e Materiais
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="grid md:grid-cols-2 gap-4">
                                                <div className="md:col-span-2">
                                                    <Label>{!produto ? 'Cores do Produto (Selecione uma ou mais) *' : 'Cor e Acabamento'}</Label>
                                                    {!produto ? (
                                                        <FurnitureColorPicker
                                                            multiple={true}
                                                            value={formData.cores || []}
                                                            hexValue={formData.cor_hex}
                                                            onChange={(selectedCores) => {
                                                                handleChange('cores', selectedCores);
                                                                if (selectedCores && selectedCores.length > 0) {
                                                                    handleChange('cor', selectedCores[0]);
                                                                    handleChange('cor_hex', getColorHex(selectedCores[0]));
                                                                } else {
                                                                    handleChange('cor', '');
                                                                    handleChange('cor_hex', '');
                                                                }
                                                            }}
                                                            onHexChange={(hex) => handleChange('cor_hex', hex)}
                                                            customOptions={coresCatalogo}
                                                            placeholder="Selecione as cores por nomenclatura"
                                                        />
                                                    ) : (
                                                        <FurnitureColorPicker
                                                            multiple={false}
                                                            value={formData.cor}
                                                            hexValue={formData.cor_hex}
                                                            onChange={(val) => handleChange('cor', val)}
                                                            onHexChange={(hex) => handleChange('cor_hex', hex)}
                                                            customOptions={coresCatalogo}
                                                            placeholder="Selecione a cor por nomenclatura"
                                                        />
                                                    )}
                                                </div>
                                                <div>
                                                    <Label>Material Principal</Label>
                                                    <Select
                                                        value={formData.material}
                                                        onValueChange={(value) => handleChange('material', value)}
                                                    >
                                                        <SelectTrigger id="material">
                                                            <SelectValue placeholder="Selecione" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {MATERIAIS.map(mat => (
                                                                <SelectItem key={mat} value={mat}>{mat}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div>
                                                    <Label>Tipo de Entrega Padrão</Label>
                                                    <Select
                                                        value={formData.tipo_entrega_padrao}
                                                        onValueChange={(value) => handleChange('tipo_entrega_padrao', value)}
                                                    >
                                                        <SelectTrigger id="tipo_entrega_padrao">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {TIPOS_ENTREGA.map(tipo => (
                                                                <SelectItem key={tipo.valor} value={tipo.valor}>
                                                                    {tipo.label}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Ruler className="w-4 h-4 text-blue-600" />
                                                Dimensões do Produto
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="grid grid-cols-3 gap-4">
                                                <div>
                                                    <Label className="text-xs">Largura (cm)</Label>
                                                    <Input
                                                        id="largura"
                                                        type="number"
                                                        value={formData.largura}
                                                        onChange={(e) => handleChange('largura', e.target.value)}
                                                        placeholder="180"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="text-xs">Altura (cm)</Label>
                                                    <Input
                                                        id="altura"
                                                        type="number"
                                                        value={formData.altura}
                                                        onChange={(e) => handleChange('altura', e.target.value)}
                                                        placeholder="90"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="text-xs">Profundidade (cm)</Label>
                                                    <Input
                                                        id="profundidade"
                                                        type="number"
                                                        value={formData.profundidade}
                                                        onChange={(e) => handleChange('profundidade', e.target.value)}
                                                        placeholder="85"
                                                    />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card id="secao-financeiro-estoque" className="border-green-200 scroll-mt-4">
                                        <CardHeader>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <DollarSign className="w-4 h-4 text-green-600" />
                                                Valores
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="grid md:grid-cols-2 gap-4">
                                                {showFinancials && (
                                                    <div>
                                                        <Label>Custo (Tabela)</Label>
                                                        <Input
                                                            id="preco_custo_tabela"
                                                            type="number"
                                                            step="0.01"
                                                            value={formData.preco_custo_tabela}
                                                            onChange={(e) => handleChange('preco_custo_tabela', e.target.value)}
                                                            placeholder="R$ 0,00"
                                                        />
                                                    </div>
                                                )}
                                                {showFinancials && (
                                                    <div>
                                                        <Label>Impostos (valor ou %)</Label>
                                                        <Input
                                                            id="impostos_percentual"
                                                            type="text"
                                                            value={formData.impostos_percentual}
                                                            onChange={(e) => handleChange('impostos_percentual', e.target.value)}
                                                            placeholder="Ex: 150 ou 12%"
                                                        />
                                                        <p className="text-xs text-muted-foreground mt-1">Sem % = valor fixo em R$. Com % = cálculo automático sobre o custo.</p>
                                                    </div>
                                                )}
                                                <div>
                                                    <Label>Preço de Venda *</Label>
                                                    <Input
                                                        id="preco_venda"
                                                        type="number"
                                                        step="0.01"
                                                        value={formData.preco_venda}
                                                        onChange={(e) => handleChange('preco_venda', e.target.value)}
                                                        placeholder="R$ 0,00"
                                                        className={cn(errors.preco_venda && 'border-red-500')}
                                                    />
                                                    {errors.preco_venda && <p className="text-xs text-red-500 mt-1">{errors.preco_venda}</p>}
                                                    {suggestedPrice > 0 && showFinancials && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={applySuggestedMarkup}
                                                            className="mt-1 h-auto py-1 text-green-600 hover:text-green-700 text-xs"
                                                        >
                                                            Aplicar sugestão: R$ {suggestedPrice.toFixed(2)}
                                                        </Button>
                                                    )}
                                                </div>

                                                {showFinancials && (
                                                    <div>
                                                        <Label>Frete (valor ou %)</Label>
                                                        <Input
                                                            id="frete_custo"
                                                            type="text"
                                                            value={formData.frete_custo}
                                                            onChange={(e) => handleChange('frete_custo', e.target.value)}
                                                            placeholder="Ex: 90 ou 5%"
                                                        />
                                                    </div>
                                                )}

                                                {showFinancials && (
                                                    <div>
                                                        <Label>IPI (valor ou %)</Label>
                                                        <Input
                                                            id="ipi_percentual"
                                                            type="text"
                                                            value={formData.ipi_percentual}
                                                            onChange={(e) => handleChange('ipi_percentual', e.target.value)}
                                                            placeholder="Ex: 50 ou 4%"
                                                        />
                                                    </div>
                                                )}

                                                {showFinancials && (
                                                    <div className="md:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-1">
                                                        <p className="text-xs font-semibold text-emerald-800">Resumo do cálculo</p>
                                                        <p className="text-xs text-emerald-900">Custo base: {formatCurrencyBRL(pricingBreakdown.custoAtivo)}</p>
                                                        <p className="text-xs text-emerald-900">
                                                            Impostos: +{formatCurrencyBRL(pricingBreakdown.impostosCalc.amount)} ({formatPercent(pricingBreakdown.impostosCalc.percent)})
                                                        </p>
                                                        <p className="text-xs text-emerald-900">
                                                            Frete: +{formatCurrencyBRL(pricingBreakdown.freteCalc.amount)} ({formatPercent(pricingBreakdown.freteCalc.percent)})
                                                        </p>
                                                        <p className="text-xs text-emerald-900">
                                                            IPI: +{formatCurrencyBRL(pricingBreakdown.ipiCalc.amount)} ({formatPercent(pricingBreakdown.ipiCalc.percent)})
                                                        </p>
                                                        <p className="text-xs text-emerald-900">Montagem: +{formatCurrencyBRL(pricingBreakdown.valorMontagem)}</p>
                                                        <p className="text-xs font-semibold text-emerald-900">
                                                            Custo com adicionais: {formatCurrencyBRL(pricingBreakdown.custoComAdicionais)}
                                                        </p>
                                                        <p className="text-xs font-semibold text-emerald-900">
                                                            Preço final sugerido: {suggestedPrice > 0 ? formatCurrencyBRL(suggestedPrice) : formatCurrencyBRL(0)}
                                                        </p>
                                                    </div>
                                                )}

                                                {showFinancials && (
                                                    <>
                                                        <div>
                                                            <Label>Markup (Multiplicador)</Label>
                                                            <Input
                                                                id="markup_multiplicador"
                                                                type="number"
                                                                step="0.0001"
                                                                min="1"
                                                                value={formData.markup_multiplicador}
                                                                onChange={(e) => {
                                                                    const multiplierText = e.target.value;
                                                                    const multiplier = parseFloat(multiplierText || 0);
                                                                    handleChange('markup_multiplicador', multiplierText);
                                                                    handleChange('markup_percentual', multiplier > 0 ? toPercentFromMultiplier(multiplier).toString() : '');
                                                                }}
                                                                placeholder="Ex: 1.45"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label>Markup (%)</Label>
                                                            <Input
                                                                id="markup_percentual"
                                                                type="number"
                                                                step="0.01"
                                                                min="0"
                                                                value={formData.markup_percentual}
                                                                onChange={(e) => {
                                                                    const percentText = e.target.value;
                                                                    const percent = parseFloat(percentText || 0);
                                                                    handleChange('markup_percentual', percentText);
                                                                    handleChange('markup_multiplicador', percentText === '' ? '' : toMultiplierFromPercent(percent).toString());
                                                                }}
                                                                placeholder="Ex: 45"
                                                            />
                                                        </div>

                                                        <div>
                                                            <Label>Preço Final Sugerido</Label>
                                                            <Input
                                                                id="preco_final_sugerido"
                                                                type="number"
                                                                step="0.01"
                                                                value={suggestedPrice > 0 ? suggestedPrice : ''}
                                                                disabled
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label>Preço Final Manual</Label>
                                                            <Input
                                                                id="preco_final_manual"
                                                                type="number"
                                                                step="0.01"
                                                                min="0"
                                                                value={formData.preco_final_manual}
                                                                onChange={(e) => {
                                                                    handleChange('preco_final_manual', e.target.value);
                                                                    handleChange('preco_venda', e.target.value);
                                                                }}
                                                                placeholder="Opcional"
                                                            />
                                                        </div>

                                                        <div className="md:col-span-2 flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                id="usar_markup_fornecedor"
                                                                checked={Boolean(formData.usar_markup_fornecedor)}
                                                                onChange={(e) => handleChange('usar_markup_fornecedor', e.target.checked)}
                                                                className="rounded"
                                                            />
                                                            <Label htmlFor="usar_markup_fornecedor" className="cursor-pointer">
                                                                Usar markup padrão do fornecedor (com opção de sobrescrever)
                                                            </Label>
                                                        </div>
                                                    </>
                                                )}

                                                <div>
                                                    <Label>Valor de Montagem</Label>
                                                    <Input
                                                        id="valor_montagem"
                                                        type="number"
                                                        step="0.01"
                                                        value={formData.valor_montagem}
                                                        onChange={(e) => handleChange('valor_montagem', e.target.value)}
                                                        placeholder="R$ 0,00"
                                                    />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader className="pb-2">
                                            <div className="flex items-center justify-between">
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    <Warehouse className="w-4 h-4 text-orange-600" />
                                                    Estoque
                                                </CardTitle>
                                                <Badge variant="outline" className="bg-green-50">
                                                    Total: {
                                                        (parseInt(formData.estoque_cd) || 0) +
                                                        estoqueUnits.filter(u => u.field !== 'estoque_cd').reduce((sum, u) => sum + (parseInt(formData[u.field]) || 0), 0)
                                                    }
                                                </Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <Alert className="bg-blue-50 border-blue-200">
                                                <AlertTriangle className="h-4 w-4 text-blue-600" />
                                                <AlertDescription className="text-sm text-blue-800 ml-2">
                                                    Movimentações de estoque ocorrem via Transferência, Inventário, Recebimento de Compras ou Venda.
                                                    Veja o histórico de movimentações na aba Histórico.
                                                </AlertDescription>
                                            </Alert>
                                            <div className="grid grid-cols-2 gap-3">
                                                {estoqueUnits.map(unit => {
                                                    const field = unit.field;
                                                    const label = unit.label;
                                                    // CD is already mapped as 'Depósito / CD'
                                                    return (
                                                        <div key={field} className="bg-gray-50 p-2 rounded-lg border">
                                                            <Label className="text-xs text-gray-500">{label}</Label>
                                                            <Input
                                                                type="number"
                                                                value={formData[field] || ''}
                                                                disabled={true}
                                                                className="h-8 text-sm bg-gray-100 cursor-not-allowed"
                                                                id={field}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                                                <div>
                                                    <Label className="text-xs">Estoque Mínimo</Label>
                                                    <Input
                                                        id="estoque_minimo"
                                                        type="number"
                                                        value={formData.estoque_minimo}
                                                        onChange={(e) => handleChange('estoque_minimo', e.target.value)}
                                                        className="h-8"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="text-xs">Estoque Ideal</Label>
                                                    <Input
                                                        id="estoque_ideal"
                                                        type="number"
                                                        value={formData.estoque_ideal}
                                                        onChange={(e) => handleChange('estoque_ideal', e.target.value)}
                                                        className="h-8"
                                                    />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card id="secao-fiscal-logistico" className="scroll-mt-4">
                                        <CardHeader>
                                            <CardTitle className="text-base">Dados Fiscais (NFe)</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="grid md:grid-cols-2 gap-4">
                                                <div>
                                                    <Label>NCM</Label>
                                                    <Input
                                                        id="ncm"
                                                        value={formData.ncm}
                                                        onChange={(e) => handleChange('ncm', e.target.value)}
                                                        placeholder="9401.61.00"
                                                    />
                                                </div>
                                                <div>
                                                    <Label>CEST</Label>
                                                    <Input
                                                        id="cest"
                                                        value={formData.cest}
                                                        onChange={(e) => handleChange('cest', e.target.value)}
                                                        placeholder="2001500"
                                                    />
                                                </div>
                                                <div>
                                                    <Label>CFOP</Label>
                                                    <Input
                                                        id="cfop"
                                                        value={formData.cfop}
                                                        onChange={(e) => handleChange('cfop', e.target.value)}
                                                        placeholder="5102"
                                                    />
                                                </div>
                                                <div>
                                                    <Label>Unidade Comercial</Label>
                                                    <Select
                                                        value={formData.unidade}
                                                        onValueChange={(value) => handleChange('unidade', value)}
                                                    >
                                                        <SelectTrigger id="unidade">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="UN">UN - Unidade</SelectItem>
                                                            <SelectItem value="PC">PC - Peça</SelectItem>
                                                            <SelectItem value="CX">CX - Caixa</SelectItem>
                                                            <SelectItem value="KG">KG - Quilograma</SelectItem>
                                                            <SelectItem value="MT">MT - Metro</SelectItem>
                                                            <SelectItem value="JG">JG - Jogo</SelectItem>
                                                            <SelectItem value="CON">CON - Conjunto</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="md:col-span-2">
                                                    <Label>Origem da Mercadoria</Label>
                                                    <Select
                                                        value={formData.origem_mercadoria}
                                                        onValueChange={(value) => handleChange('origem_mercadoria', value)}
                                                    >
                                                        <SelectTrigger id="origem_mercadoria">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="0">0 - Nacional</SelectItem>
                                                            <SelectItem value="1">1 - Estrangeira (Importação Direta)</SelectItem>
                                                            <SelectItem value="2">2 - Estrangeira (Mercado Interno)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            {/* Override fiscal por produto */}
                                            <div className="border-t pt-4 mt-4">
                                                <p className="text-sm text-gray-500 mb-3">Tributação específica do produto (vazio = usa padrão da organização)</p>
                                                <div className="grid md:grid-cols-3 gap-4">
                                                    <div>
                                                        <Label>CSOSN (Simples Nacional)</Label>
                                                        <Select
                                                            value={formData.csosn || '_empty'}
                                                            onValueChange={(v) => handleChange('csosn', v === '_empty' ? '' : v)}
                                                        >
                                                            <SelectTrigger><SelectValue placeholder="Padrão da org" /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="_empty">Padrão da org</SelectItem>
                                                                <SelectItem value="102">102 - Tributada sem crédito</SelectItem>
                                                                <SelectItem value="103">103 - Isenção (faixa SN)</SelectItem>
                                                                <SelectItem value="300">300 - Imune</SelectItem>
                                                                <SelectItem value="400">400 - Não tributada</SelectItem>
                                                                <SelectItem value="500">500 - ICMS cobrado por ST</SelectItem>
                                                                <SelectItem value="900">900 - Outros</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div>
                                                        <Label>CST ICMS</Label>
                                                        <Select
                                                            value={formData.cst_icms || '_empty'}
                                                            onValueChange={(v) => handleChange('cst_icms', v === '_empty' ? '' : v)}
                                                        >
                                                            <SelectTrigger><SelectValue placeholder="Padrão da org" /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="_empty">Padrão da org</SelectItem>
                                                                <SelectItem value="00">00 - Tributada integralmente</SelectItem>
                                                                <SelectItem value="10">10 - Tributada e com ST</SelectItem>
                                                                <SelectItem value="20">20 - Redução de base</SelectItem>
                                                                <SelectItem value="40">40 - Isenta</SelectItem>
                                                                <SelectItem value="41">41 - Não tributada</SelectItem>
                                                                <SelectItem value="60">60 - ICMS cobrado anteriormente por ST</SelectItem>
                                                                <SelectItem value="90">90 - Outras</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div>
                                                        <Label>CST PIS</Label>
                                                        <Select
                                                            value={formData.cst_pis || '_empty'}
                                                            onValueChange={(v) => handleChange('cst_pis', v === '_empty' ? '' : v)}
                                                        >
                                                            <SelectTrigger><SelectValue placeholder="Padrão da org" /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="_empty">Padrão da org</SelectItem>
                                                                <SelectItem value="01">01 - Tributável</SelectItem>
                                                                <SelectItem value="04">04 - Monofásica</SelectItem>
                                                                <SelectItem value="06">06 - Alíquota zero</SelectItem>
                                                                <SelectItem value="49">49 - Outras saídas</SelectItem>
                                                                <SelectItem value="99">99 - Outras operações</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div>
                                                        <Label>CST COFINS</Label>
                                                        <Select
                                                            value={formData.cst_cofins || '_empty'}
                                                            onValueChange={(v) => handleChange('cst_cofins', v === '_empty' ? '' : v)}
                                                        >
                                                            <SelectTrigger><SelectValue placeholder="Padrão da org" /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="_empty">Padrão da org</SelectItem>
                                                                <SelectItem value="01">01 - Tributável</SelectItem>
                                                                <SelectItem value="04">04 - Monofásica</SelectItem>
                                                                <SelectItem value="06">06 - Alíquota zero</SelectItem>
                                                                <SelectItem value="49">49 - Outras saídas</SelectItem>
                                                                <SelectItem value="99">99 - Outras operações</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div>
                                                        <Label>Alíquota ICMS (%)</Label>
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            value={formData.aliquota_icms}
                                                            onChange={(e) => handleChange('aliquota_icms', e.target.value)}
                                                            placeholder="Padrão da org"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label>% Tributos Aprox.</Label>
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            value={formData.percentual_tributos}
                                                            onChange={(e) => handleChange('percentual_tributos', e.target.value)}
                                                            placeholder="Padrão da org"
                                                        />
                                                        <p className="text-xs text-gray-400 mt-1">Lei 12.741/2012</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label className="text-xs">Peso Bruto (kg)</Label>
                                                    <Input
                                                        id="peso_bruto"
                                                        type="number"
                                                        step="0.01"
                                                        value={formData.peso_bruto}
                                                        onChange={(e) => handleChange('peso_bruto', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            <div className="pt-2 border-t">
                                                <Label className="text-xs mb-2 block">Dimensões da Embalagem (para Cubagem)</Label>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <Input id="altura_embalagem" placeholder="Alt" type="number" value={formData.altura_embalagem} onChange={(e) => handleChange('altura_embalagem', e.target.value)} />
                                                    <Input id="largura_embalagem" placeholder="Larg" type="number" value={formData.largura_embalagem} onChange={(e) => handleChange('largura_embalagem', e.target.value)} />
                                                    <Input id="profundidade_embalagem" placeholder="Prof" type="number" value={formData.profundidade_embalagem} onChange={(e) => handleChange('profundidade_embalagem', e.target.value)} />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {!readOnly && (
                                        <Card id="secao-fotos" className="scroll-mt-4">
                                            <CardHeader>
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    <ImageIcon className="w-4 h-4 text-amber-600" />
                                                    Fotos do Produto
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-6">
                                                <div className="border-2 border-dashed rounded-xl p-8 text-center bg-white">
                                                    <label className="cursor-pointer group">
                                                        <input
                                                            type="file"
                                                            multiple
                                                            accept="image/*"
                                                            onChange={handleImageUpload}
                                                            className="hidden"
                                                            disabled={uploadingImages}
                                                        />
                                                        <div className="space-y-2">
                                                            {uploadingImages ? (
                                                                <Loader2 className="w-10 h-10 mx-auto animate-spin text-green-600" />
                                                            ) : (
                                                                <>
                                                                    <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto group-hover:bg-green-100 transition-colors">
                                                                        <Upload className="w-6 h-6 text-green-600" />
                                                                    </div>
                                                                    <div>
                                                                        <p className="font-semibold text-gray-900">Clique para enviar fotos</p>
                                                                        <p className="text-sm text-gray-500">ou arraste e solte arquivos aqui</p>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </label>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label>Ou adicione por URL</Label>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            value={fotoUrlInput}
                                                            onChange={(e) => setFotoUrlInput(e.target.value)}
                                                            placeholder="https://..."
                                                        />
                                                        <Button type="button" onClick={handleAddFotoUrl} variant="outline" size="icon">
                                                            <Plus className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                {formData.fotos.length > 0 && (
                                                    <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                                                        {formData.fotos.map((foto, index) => (
                                                            <div key={index} className="relative group aspect-square rounded-xl overflow-hidden border bg-white shadow-sm">
                                                                <img src={foto} className="w-full h-full object-cover" alt="" />
                                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                                    <Button
                                                                        type="button"
                                                                        variant="destructive"
                                                                        size="icon"
                                                                        className="h-8 w-8"
                                                                        onClick={() => handleRemoveFoto(index)}
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </Button>
                                                                    {index > 0 && (
                                                                        <Button
                                                                            type="button"
                                                                            variant="secondary"
                                                                            size="sm"
                                                                            className="h-8 text-xs font-bold"
                                                                            onClick={() => {
                                                                                setFormData(prev => {
                                                                                    const newFotos = [...prev.fotos];
                                                                                    const [moved] = newFotos.splice(index, 1);
                                                                                    newFotos.unshift(moved);
                                                                                    return { ...prev, fotos: newFotos };
                                                                                });
                                                                            }}
                                                                        >
                                                                            Tornar Principal
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                                {index === 0 && (
                                                                    <div className="absolute top-2 left-2 px-2 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded shadow-sm">
                                                                        PRINCIPAL
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    )}
                                </fieldset>
                            </div>
                        )}

                        {/* SEÇÃO: HISTÓRICO */}
                        {activeView === 'historico' && produto?.id && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <ClipboardCheck className="w-4 h-4 text-blue-600" />
                                            Histórico de Movimentações
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <ProdutoHistoricoTab produtoId={produto.id} />
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* SEÇÃO: HISTÓRICO - Sem produto */}
                        {activeView === 'historico' && !produto?.id && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <ClipboardCheck className="w-4 h-4 text-blue-600" />
                                            Histórico de Movimentações
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="text-center text-gray-500 py-12">
                                        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                                        <p>Salve o produto para visualizar o histórico de movimentações.</p>
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                    </div>

                    {/* Footer fixo */}
                    <div className="px-6 py-4 border-t bg-white shrink-0">
                        <div className={cn('flex items-center', readOnly ? 'justify-end' : 'justify-between')}>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onClose}
                                disabled={isLoading || isSubmitting}
                            >
                                {readOnly ? 'Fechar' : 'Cancelar'}
                            </Button>

                            {!readOnly && (
                                <Button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={isLoading || isSubmitting}
                                    className="bg-green-600 hover:bg-green-700 min-w-[140px] shadow-lg shadow-green-100 transition-all hover:scale-105"
                                >
                                    {(isLoading || isSubmitting) ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Salvando...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-4 h-4 mr-2" />
                                            {produto ? 'Salvar Alterações' : 'Cadastrar Produto'}
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            <FornecedorModal
                open={showFornecedorModal}
                onOpenChange={setShowFornecedorModal}
                onSuccess={(novoFornecedor) => {
                    setShowFornecedorModal(false);
                    if (novoFornecedor?.id) {
                        handleFornecedorChange(String(novoFornecedor.id));
                    }
                }}
            />
        </>
    );
}
