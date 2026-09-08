import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { CATEGORIAS, AMBIENTES, MATERIAIS } from "@/constants/productConstants";
import FurnitureColorPicker from "@/components/produtos/FurnitureColorPicker";
import { detectProductKeywordSuggestion } from "@/lib/productKeywordDetector";
import { generateSafeSKU } from "@/utils/gtinValidator";

export default function SolicitacaoCadastroModal({ isOpen, onClose, onProdutoSolicitado, user, initialParentProduct = null }) {
    const [loading, setLoading] = useState(false);
    const [dismissedSuggestionName, setDismissedSuggestionName] = useState('');

    // Effect to update internal state if prop changes
    React.useEffect(() => {
        setFormData(prev => ({
            ...prev,
            nome_produto: '',
            categoria: '',
            ambiente: '',
            fornecedor_id: '',
            material: '',
            preco_sugerido: ''
        }));
        setDismissedSuggestionName('');
    }, [isOpen]);

    const [formData, setFormData] = useState({
        nome_produto: '',
        categoria: '',
        ambiente: '',
        fornecedor_id: '',
        cor: '',
        cor_hex: '',
        tecido: '',
        material: '',
        altura: '',
        largura: '',
        profundidade: '',
        preco_sugerido: '',
        observacoes: ''
    });

    // Busca fornecedores
    const { data: fornecedores = [] } = useQuery({
        queryKey: ['fornecedores'],
        queryFn: () => base44.entities.Fornecedor.list(),
        enabled: isOpen
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });

        if (name === 'nome_produto') {
            setDismissedSuggestionName('');
        }
    };

    const handleSelectChange = (name, value) => {
        setFormData({ ...formData, [name]: value });
    }

    const keywordSuggestion = React.useMemo(
        () => detectProductKeywordSuggestion(formData.nome_produto, {
            returnDefault: true,
            defaultCategoria: 'Outros',
        }),
        [formData.nome_produto]
    );

    const normalizedSuggestionName = React.useMemo(
        () => (formData.nome_produto || '').trim().toLowerCase(),
        [formData.nome_produto]
    );

    const suggestedCategoria = keywordSuggestion.categoriaSuggestion;
    const suggestedAmbiente = AMBIENTES.includes(keywordSuggestion.ambienteSuggestion)
        ? keywordSuggestion.ambienteSuggestion
        : null;

    const canApplyCategoriaSuggestion = suggestedCategoria &&
        CATEGORIAS.includes(suggestedCategoria) &&
        suggestedCategoria !== formData.categoria;

    const canApplyAmbienteSuggestion = suggestedAmbiente &&
        suggestedAmbiente !== formData.ambiente;

    const shouldShowSuggestion = normalizedSuggestionName &&
        dismissedSuggestionName !== normalizedSuggestionName &&
        (canApplyCategoriaSuggestion || canApplyAmbienteSuggestion);

    const shouldShowCategoriaSuggestion = shouldShowSuggestion && canApplyCategoriaSuggestion;
    const shouldShowAmbienteSuggestion = shouldShowSuggestion && canApplyAmbienteSuggestion;

    const applyCategoriaSuggestion = () => {
        if (!canApplyCategoriaSuggestion) return;
        setFormData(prev => ({ ...prev, categoria: suggestedCategoria }));
    };

    const applyAmbienteSuggestion = () => {
        if (!canApplyAmbienteSuggestion) return;
        setFormData(prev => ({ ...prev, ambiente: suggestedAmbiente }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.nome_produto || !formData.preco_sugerido || !formData.categoria) {
            toast.warning("Nome, Categoria e Preço são obrigatórios");
            return;
        }

        setLoading(true);
        try {
            // 1. Formatar preco e dimensoes
            const preco = parseFloat(String(formData.preco_sugerido).replace(',', '.'));
            const medidasFormatted = [
                formData.altura ? `A:${formData.altura}cm` : '',
                formData.largura ? `L:${formData.largura}cm` : '',
                formData.profundidade ? `P:${formData.profundidade}cm` : ''
            ].filter(Boolean).join(' x ');

            // 2. Criar produto real na base (pendente revisao pelo gerente)
            const novoProduto = await base44.entities.Produto.create({
                sku: generateSafeSKU('SOL'),
                codigo_barras: null,
                nome: formData.nome_produto,
                categoria: formData.categoria,
                ambiente: formData.ambiente || null,
                material: formData.material || null,
                cor: formData.cor || null,
                cor_hex: formData.cor_hex || null,
                altura: formData.altura ? parseFloat(formData.altura) : null,
                largura: formData.largura ? parseFloat(formData.largura) : null,
                profundidade: formData.profundidade ? parseFloat(formData.profundidade) : null,
                preco_venda: preco,
                preco_custo: 0,
                fornecedor_id: formData.fornecedor_id ? parseInt(formData.fornecedor_id) : null,
                quantidade_estoque: 1,
                ativo: true,
                requer_atencao: true,
                tipo_entrega_padrao: 'desmontado',
                variacoes: [],
                fotos: [],
                is_parent: false,
                parent_id: null,
            });

            // 3. Criar solicitacao para revisao dos gerentes (informacoes fiscais e cadastro completo)
            await base44.entities.SolicitacaoCadastro.create({
                vendedor_id: user?.id,
                produto_gerado_id: novoProduto.id,
                nome_produto: formData.nome_produto,
                cor: formData.cor || null,
                tecido: formData.tecido || null,
                medidas: medidasFormatted,
                preco_sugerido: preco,
                observacoes: formData.observacoes || null,
                status: 'pendente',
                categoria: formData.categoria,
                ambiente: formData.ambiente || null,
                material: formData.material || null,
                fornecedor_id: formData.fornecedor_id ? parseInt(formData.fornecedor_id) : null,
                altura: formData.altura ? parseFloat(formData.altura) : null,
                largura: formData.largura ? parseFloat(formData.largura) : null,
                profundidade: formData.profundidade ? parseFloat(formData.profundidade) : null,
            });

            // 4. Enviar produto real ao carrinho (marcado para revisao)
            const produtoParaCarrinho = {
                ...novoProduto,
                preco_venda: preco,
                is_solicitacao: true,
                detalhes_solicitacao: {
                    cor: formData.cor,
                    tecido: formData.tecido,
                    altura: formData.altura,
                    largura: formData.largura,
                    profundidade: formData.profundidade,
                    medidas: medidasFormatted,
                    categoria: formData.categoria,
                    ambiente: formData.ambiente,
                    material: formData.material,
                    fornecedor_id: formData.fornecedor_id,
                    nome_original: formData.nome_produto,
                },
            };

            toast.success("Produto cadastrado e enviado para revisao dos gerentes.");
            onProdutoSolicitado(produtoParaCarrinho);
            onClose();
            setFormData({
                nome_produto: '', categoria: '', ambiente: '', fornecedor_id: '',
                cor: '', cor_hex: '', tecido: '', material: '',
                altura: '', largura: '', profundidade: '',
                preco_sugerido: '', observacoes: ''
            });

        } catch (err) {
            console.error(err);
            toast.error("Erro ao solicitar cadastro: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        Solicitar Cadastro de Produto
                    </DialogTitle>
                    <DialogDescription>
                        Preencha todos os dados técnicos para agilizar o cadastro.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Linha 1: Nome e Categoria */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Nome do Produto *</Label>
                            <Input
                                name="nome_produto"
                                value={formData.nome_produto}
                                onChange={handleChange}
                                placeholder="Ex: Mesa Jantar 4 lugares"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Categoria *</Label>
                            {shouldShowCategoriaSuggestion && (
                                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 flex items-center justify-between gap-2">
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
                                onValueChange={(v) => handleSelectChange('categoria', v)}
                                value={formData.categoria}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    {CATEGORIAS.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Linha 2: Ambiente e Fornecedor */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Ambiente</Label>
                            {shouldShowAmbienteSuggestion && (
                                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex items-center justify-between gap-2">
                                    <span>Ambiente sugerido: <strong>{suggestedAmbiente}</strong></span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={applyAmbienteSuggestion}
                                            className="h-7 rounded border border-sky-300 bg-white px-2 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
                                        >
                                            Aplicar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDismissedSuggestionName(normalizedSuggestionName)}
                                            className="text-[11px] text-sky-700 underline underline-offset-2 hover:text-sky-600"
                                        >
                                            Ignorar
                                        </button>
                                    </div>
                                </div>
                            )}
                            <Select onValueChange={(v) => handleSelectChange('ambiente', v)} value={formData.ambiente}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    {AMBIENTES.map(a => (
                                        <SelectItem key={a} value={a}>{a}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Fornecedor (Opcional)</Label>
                            <Select onValueChange={(v) => handleSelectChange('fornecedor_id', v)} value={formData.fornecedor_id}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    {fornecedores.map(f => (
                                        <SelectItem key={f.id} value={String(f.id)}>{f.nome_empresa || f.nome_contato}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Linha 3: Dimensões (Split) */}
                    <div className="space-y-2">
                        <Label>Dimensões (cm)</Label>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">Alt.</span>
                                <Input
                                    name="altura"
                                    type="number"
                                    value={formData.altura}
                                    onChange={handleChange}
                                    placeholder="0"
                                    className="pl-8"
                                />
                            </div>
                            <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">Larg.</span>
                                <Input
                                    name="largura"
                                    type="number"
                                    value={formData.largura}
                                    onChange={handleChange}
                                    placeholder="0"
                                    className="pl-9"
                                />
                            </div>
                            <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">Prof.</span>
                                <Input
                                    name="profundidade"
                                    type="number"
                                    value={formData.profundidade}
                                    onChange={handleChange}
                                    placeholder="0"
                                    className="pl-9"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Linha 4: Acabamento (Cor, Tecido, Material) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-2">
                            <Label>Cor</Label>
                            <FurnitureColorPicker
                                value={formData.cor}
                                hexValue={formData.cor_hex}
                                onChange={(val) => setFormData(prev => ({ ...prev, cor: val }))}
                                onHexChange={(hex) => setFormData(prev => ({ ...prev, cor_hex: hex }))}
                                placeholder="Selecione a cor por nomenclatura"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Tecido</Label>
                            <Input
                                name="tecido"
                                value={formData.tecido}
                                onChange={handleChange}
                                placeholder="Ex: Linho"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Material</Label>
                            <Select onValueChange={(v) => handleSelectChange('material', v)} value={formData.material}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    {MATERIAIS.map(m => (
                                        <SelectItem key={m} value={m}>{m}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Preço de Venda (R$)*</Label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">R$</span>
                            <Input
                                name="preco_sugerido"
                                type="number"
                                step="0.01"
                                value={formData.preco_sugerido}
                                onChange={handleChange}
                                placeholder="0.00"
                                className="pl-9 text-lg font-bold text-green-700"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Observações Adicionais</Label>
                        <Textarea
                            name="observacoes"
                            value={formData.observacoes}
                            onChange={handleChange}
                            placeholder="Detalhes adicionais..."
                        />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white w-full md:w-auto" disabled={loading}>
                            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Solicitar Cadastro"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
