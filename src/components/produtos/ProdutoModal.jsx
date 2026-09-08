import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Sparkles, Info, ChevronRight, FileText } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { calculateSuggestedMarkup, calculateMarkupDetails, calculateFinalPriceFromMarkup, toMultiplierFromPercent, toPercentFromMultiplier } from "@/utils/markupCalculator";
import { useAuth } from '@/hooks/useAuth';
import { isValidGTIN, normalizeGTIN, normalizeSKU, generateSafeSKU } from "@/utils/gtinValidator";
const categorias = [
  "Sofa",
  "Cama",
  "Mesa",
  "Cadeira",
  "Armario",
  "Estante",
  "Rack",
  "Poltrona",
  "Escrivaninha",
  "Criado-mudo",
  "Buffet",
  "Aparador",
  "Banco",
  "Colchao",
  "Guarda-roupa",
  "Comoda",
  "Painel",
  "Travesseiro",
  "Almofada",
  "Decoracao",
  "Utensilios",
  "Outros"
];

export default function ProdutoModal({ isOpen, onClose, onSave, produto, isLoading }) {
  const { user } = useAuth();
  const isVendedor = String(user?.cargo || '').toLowerCase().includes('vendedor');
  const showFinancials = user?.cargo === 'Administrador';
  const [formData, setFormData] = useState({
    sku: "",
    codigo_barras: "",
    nome: "",
    categoria: "",
    descricao: "",
    foto_url: "",
    preco_venda: "",
    preco_custo: "",
    markup_multiplicador: "",
    markup_percentual: "",
    preco_final_sugerido: "",
    preco_final_manual: "",
    usar_markup_fornecedor: false,
    quantidade_estoque: "",
    estoque_minimo: "",
    tipo_entrega_padrao: "desmontado",
    ativo: true,
  });

  const [errors, setErrors] = useState({});

  // State for suggested markup
  const [suggestedPrice, setSuggestedPrice] = useState(0);
  const [markupDetails, setMarkupDetails] = useState(null);

  // Recalculate suggestion whenever relevant fields change
  useEffect(() => {
    const hasCost = parseFloat(formData.preco_custo) > 0;
    if (hasCost && formData.categoria) {
      const suggestionByMarkup = calculateFinalPriceFromMarkup(
        formData.preco_custo,
        formData.markup_multiplicador,
        formData.markup_percentual
      );
      const suggestion = suggestionByMarkup > 0 ? suggestionByMarkup : calculateSuggestedMarkup(formData);
      setSuggestedPrice(suggestion);
      const details = calculateMarkupDetails({
        ...formData,
        markup_multiplicador: formData.markup_multiplicador,
        markup_percentual: formData.markup_percentual,
      });
      setMarkupDetails(details);
      setFormData((prev) => ({
        ...prev,
        preco_final_sugerido: suggestion > 0 ? suggestion.toString() : "",
      }));
    } else {
      setSuggestedPrice(0);
      setMarkupDetails(null);
    }
  }, [formData.preco_custo, formData.markup_multiplicador, formData.markup_percentual, formData.categoria, formData.quantidade_estoque, formData.estoque_minimo, formData.fornecedor_id]);

  const applySuggestedMarkup = () => {
    if (suggestedPrice) {
      handleChange('preco_venda', suggestedPrice.toString());
      handleChange('preco_final_manual', suggestedPrice.toString());
    }
  };

  useEffect(() => {
    if (produto) {
      setFormData({
        sku: produto.sku || "",
        codigo_barras: produto.codigo_barras || "",
        nome: produto.nome || "",
        categoria: produto.categoria || "",
        descricao: produto.descricao || "",
        foto_url: produto.fotos?.[0] || produto.foto_url || "",
        preco_venda: produto.preco_venda || "",
        preco_custo: produto.preco_custo || "",
        markup_multiplicador: produto.markup_multiplicador || "",
        markup_percentual: produto.markup_percentual || "",
        preco_final_sugerido: produto.preco_final_sugerido || "",
        preco_final_manual: produto.preco_final_manual || "",
        usar_markup_fornecedor: Boolean(produto.usar_markup_fornecedor),
        quantidade_estoque: produto.quantidade_estoque || "",
        estoque_minimo: produto.estoque_minimo?.toString() || "",
        tipo_entrega_padrao: produto.tipo_entrega_padrao || "desmontado",
        ativo: produto.ativo !== false,
      });
    } else {
      setFormData({
        sku: "",
        codigo_barras: "",
        nome: "",
        categoria: "",
        descricao: "",
        foto_url: "",
        preco_venda: "",
        preco_custo: "",
        markup_multiplicador: "",
        markup_percentual: "",
        preco_final_sugerido: "",
        preco_final_manual: "",
        usar_markup_fornecedor: false,
        quantidade_estoque: "",
        estoque_minimo: "",
        tipo_entrega_padrao: "desmontado",
        ativo: true,
      });
    }
    setErrors({});
  }, [produto, isOpen]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.nome || formData.nome.trim().length < 3) {
      newErrors.nome = "Nome deve ter pelo menos 3 caracteres";
    }

    if (!formData.categoria) {
      newErrors.categoria = "Selecione uma categoria";
    }

    const precoVenda = parseFloat(formData.preco_venda);
    if (!precoVenda || precoVenda <= 0) {
      newErrors.preco_venda = "Preco de venda deve ser maior que zero";
    }

    const precoCusto = parseFloat(formData.preco_custo);
    if (formData.preco_custo && precoCusto && precoCusto > precoVenda) {
      newErrors.preco_custo = "Preco de custo nao pode ser maior que o de venda";
    }

    const estoque = parseInt(formData.quantidade_estoque);
    if (isNaN(estoque)) {
      newErrors.quantidade_estoque = "Quantidade de estoque e obrigatoria";
    }
    if (estoque < 0) {
      newErrors.quantidade_estoque = "Quantidade nao pode ser negativa";
    }

    if (!formData.tipo_entrega_padrao) {
      newErrors.tipo_entrega_padrao = "Selecione o tipo de entrega padrão";
    }

    if (!formData.ncm || formData.ncm.length < 8) {
      newErrors.ncm = "NCM inválido (mínimo 8 dígitos)";
    }

    if (!formData.cfop || formData.cfop.length < 4) {
      newErrors.cfop = "CFOP inválido (mínimo 4 dígitos)";
    }

    if (produto && !formData.sku?.trim()) {
      newErrors.sku = "SKU é obrigatório para produtos cadastrados";
    }

    if (formData.codigo_barras && formData.codigo_barras.trim()) {
      if (!isValidGTIN(formData.codigo_barras)) {
        newErrors.codigo_barras = "Código de barras inválido. Deve ser um GTIN válido (8, 12, 13 ou 14 dígitos com checksum)";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const skuFinal = (formData.sku && formData.sku.trim())
      ? normalizeSKU(formData.sku)
      : (produto?.sku || generateSafeSKU('PRD'));
    const gtinFinal = (formData.codigo_barras && formData.codigo_barras.trim())
      ? normalizeGTIN(formData.codigo_barras, true)
      : null;

    const dataToSave = {
      ...formData,
      sku: skuFinal,
      codigo_barras: gtinFinal,
      nome: (isVendedor && !!produto) ? produto.nome : formData.nome,
      preco_venda: parseFloat(formData.preco_final_manual || formData.preco_venda),
      preco_custo: formData.preco_custo ? parseFloat(formData.preco_custo) : undefined,
      markup_multiplicador: formData.markup_multiplicador ? parseFloat(formData.markup_multiplicador) : null,
      markup_percentual: formData.markup_percentual ? parseFloat(formData.markup_percentual) : null,
      preco_final_sugerido: formData.preco_final_sugerido ? parseFloat(formData.preco_final_sugerido) : null,
      preco_final_manual: formData.preco_final_manual ? parseFloat(formData.preco_final_manual) : null,
      usar_markup_fornecedor: Boolean(formData.usar_markup_fornecedor),
      quantidade_estoque: parseInt(formData.quantidade_estoque),
      estoque_minimo: formData.estoque_minimo ? parseInt(formData.estoque_minimo) : 0,
      fotos: formData.foto_url ? [formData.foto_url] : [],
    };

    // Remove foto_url pois usamos fotos[] para compatibilidade
    delete dataToSave.foto_url;

    onSave(dataToSave);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {produto ? "Editar Produto" : "Novo Produto"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* SKU */}
          <div>
            <Label htmlFor="sku">SKU / Código Interno *</Label>
            <Input
              id="sku"
              value={formData.sku}
              onChange={(e) => handleChange("sku", e.target.value)}
              placeholder={produto ? "Ex: SOF-RET-3L" : "Gerado automaticamente se vazio"}
              className={errors.sku ? "border-red-500 font-mono" : "font-mono"}
            />
            {errors.sku && <p className="text-xs text-red-500 mt-1">{errors.sku}</p>}
          </div>

          {/* Codigo de Barras */}
          <div>
            <Label htmlFor="codigo_barras">Código de Barras (EAN / GTIN)</Label>
            <Input
              id="codigo_barras"
              value={formData.codigo_barras}
              onChange={(e) => handleChange("codigo_barras", e.target.value.replace(/\D/g, ''))}
              placeholder="Opcional (GTIN-8, 12, 13 ou 14 dígitos)"
              maxLength={14}
              className={errors.codigo_barras ? "border-red-500 font-mono" : "font-mono"}
            />
            {errors.codigo_barras && <p className="text-xs text-red-500 mt-1">{errors.codigo_barras}</p>}
          </div>

          {/* Nome */}
          <div>
            <Label htmlFor="nome">Nome do Produto *</Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => handleChange("nome", e.target.value)}
              className={errors.nome ? "border-red-500" : ""}
              disabled={isVendedor && !!produto}
            />
            {isVendedor && !!produto && (
              <p className="text-xs text-amber-700 mt-1">Perfil Vendedor não tem permissão para alterar o nome de um produto cadastrado.</p>
            )}
            {errors.nome && (
              <p className="text-xs text-red-500 mt-1">{errors.nome}</p>
            )}
          </div>

          {/* Categoria e Montagem Padrão */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="categoria">Categoria *</Label>
              <Select
                value={formData.categoria}
                onValueChange={(value) => handleChange("categoria", value)}
              >
                <SelectTrigger className={errors.categoria ? "border-red-500" : ""}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.categoria && (
                <p className="text-xs text-red-500 mt-1">{errors.categoria}</p>
              )}
            </div>

            <div>
              <Label htmlFor="tipo_entrega_padrao">Entrega Padrão *</Label>
              <Select
                value={formData.tipo_entrega_padrao}
                onValueChange={(value) => handleChange("tipo_entrega_padrao", value)}
              >
                <SelectTrigger
                  className={`
                    ${errors.tipo_entrega_padrao ? "border-red-500" : ""}
                    ${formData.tipo_entrega_padrao === 'montado' ? 'bg-green-100 text-green-800 border-green-200 font-medium' : ''}
                    ${formData.tipo_entrega_padrao === 'desmontado' ? 'bg-orange-100 text-orange-800 border-orange-200 font-medium' : ''}
                  `}
                >
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desmontado" className="text-orange-700 focus:bg-orange-50 focus:text-orange-900">
                    Montagem no Local (envia na caixa)
                  </SelectItem>
                  <SelectItem value="montado" className="text-green-700 focus:bg-green-50 focus:text-green-900">
                    Entrega Montado (montagem interna)
                  </SelectItem>
                </SelectContent>
              </Select>
              {errors.tipo_entrega_padrao && (
                <p className="text-xs text-red-500 mt-1">{errors.tipo_entrega_padrao}</p>
              )}
            </div>
          </div>

          {/* Precos */}
          <div className="grid grid-cols-2 gap-4">
            {showFinancials && (
              <div>
                <Label htmlFor="preco_custo">Preco de Custo (R$)</Label>
                <Input
                  id="preco_custo"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.preco_custo}
                  onChange={(e) => handleChange("preco_custo", e.target.value)}
                  placeholder="0,00"
                  className={errors.preco_custo ? "border-red-500" : ""}
                />
                {errors.preco_custo && (
                  <p className="text-xs text-red-500 mt-1">{errors.preco_custo}</p>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="preco_venda">Preco de Venda (R$) *</Label>
              <Input
                id="preco_venda"
                type="number"
                step="0.01"
                min="0.01"
                value={formData.preco_venda}
                onChange={(e) => handleChange("preco_venda", e.target.value)}
                placeholder="0,00"
                className={errors.preco_venda ? "border-red-500" : ""}
              />
              {/* Suggested markup */}
              {suggestedPrice > 0 && showFinancials && (
                <div className="flex items-center gap-2 mt-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 border border-green-300 cursor-pointer hover:bg-green-200 transition-colors font-medium"
                      >
                        <Sparkles className="w-3 h-3" />
                        Sugerido: R$ {suggestedPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        <Info className="w-3 h-3 ml-1" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <div className="p-3 border-b bg-gray-50">
                        <h4 className="font-semibold text-sm text-gray-800">Detalhes do Cálculo</h4>
                        <p className="text-xs text-gray-500">Custo base: R$ {markupDetails?.custo?.toFixed(2) || '0.00'}</p>
                      </div>
                      <div className="p-3 space-y-2">
                        {markupDetails?.steps?.map((step, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <ChevronRight className="w-3 h-3 text-gray-400" />
                              <div>
                                <span className="font-medium text-gray-700">{step.label}</span>
                                <p className="text-xs text-gray-500">{step.description}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${step.factor.startsWith('+') ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                {step.factor}
                              </span>
                              <p className="font-mono text-xs text-gray-600 mt-0.5">R$ {step.value.toFixed(2)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="p-3 border-t bg-green-50">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-green-800">Preço Final</span>
                          <span className="font-bold text-lg text-green-700">
                            R$ {markupDetails?.precoFinal?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || suggestedPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button type="button" variant="secondary" size="sm" onClick={applySuggestedMarkup}>
                    Aplicar
                  </Button>
                </div>
              )}

              {errors.preco_venda && (
                <p className="text-xs text-red-500 mt-1">{errors.preco_venda}</p>
              )}
            </div>
          </div>

          {showFinancials && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="markup_multiplicador">Markup Multiplicador</Label>
                <Input
                  id="markup_multiplicador"
                  type="number"
                  step="0.0001"
                  min="1"
                  value={formData.markup_multiplicador}
                  onChange={(e) => {
                    const multiplierText = e.target.value;
                    const multiplier = parseFloat(multiplierText || 0);
                    handleChange("markup_multiplicador", multiplierText);
                    handleChange("markup_percentual", multiplier > 0 ? toPercentFromMultiplier(multiplier).toString() : "");
                  }}
                  placeholder="Ex: 1.45"
                />
              </div>
              <div>
                <Label htmlFor="markup_percentual">Markup Percentual (%)</Label>
                <Input
                  id="markup_percentual"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.markup_percentual}
                  onChange={(e) => {
                    const percentText = e.target.value;
                    const percent = parseFloat(percentText || 0);
                    handleChange("markup_percentual", percentText);
                    handleChange("markup_multiplicador", percentText === "" ? "" : toMultiplierFromPercent(percent).toString());
                  }}
                  placeholder="Ex: 45"
                />
              </div>
              <div>
                <Label htmlFor="preco_final_sugerido">Preco Final Sugerido (R$)</Label>
                <Input
                  id="preco_final_sugerido"
                  type="number"
                  step="0.01"
                  value={formData.preco_final_sugerido || ""}
                  disabled
                />
              </div>
              <div>
                <Label htmlFor="preco_final_manual">Preco Final Manual (R$)</Label>
                <Input
                  id="preco_final_manual"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.preco_final_manual || ""}
                  onChange={(e) => {
                    handleChange("preco_final_manual", e.target.value);
                    handleChange("preco_venda", e.target.value);
                  }}
                  placeholder="Opcional"
                />
              </div>
            </div>
          )}

          {/* Estoque */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="quantidade_estoque">Quantidade em Estoque *</Label>
              <Input
                id="quantidade_estoque"
                type="number"
                min="0"
                value={formData.quantidade_estoque}
                onChange={(e) => handleChange("quantidade_estoque", e.target.value)}
                className={errors.quantidade_estoque ? "border-red-500" : ""}
              />
              {errors.quantidade_estoque && (
                <p className="text-xs text-red-500 mt-1">{errors.quantidade_estoque}</p>
              )}
            </div>
            <div>
              <Label htmlFor="estoque_minimo">Estoque Minimo</Label>
              <Input
                id="estoque_minimo"
                type="number"
                min="0"
                value={formData.estoque_minimo}
                onChange={(e) => handleChange("estoque_minimo", e.target.value)}
              />
            </div>
          </div>

          {/* Descricao */}
          <div>
            <Label htmlFor="descricao">Descricao</Label>
            <Textarea
              id="descricao"
              value={formData.descricao}
              onChange={(e) => handleChange("descricao", e.target.value)}
              rows={2}
              placeholder="Descricao opcional do produto"
            />
          </div>

          {/* URL da Foto */}
          <div>
            <Label htmlFor="foto_url">URL da Foto</Label>
            <Input
              id="foto_url"
              value={formData.foto_url}
              onChange={(e) => handleChange("foto_url", e.target.value)}
              placeholder="https://exemplo.com/foto.jpg"
            />
            {formData.foto_url && (
              <div className="mt-2">
                <img
                  src={formData.foto_url}
                  alt="Preview"
                  className="h-20 w-20 object-cover rounded border"
                  onError={(e) => e.target.style.display = 'none'}
                />
              </div>
            )}
          </div>

          {/* Ativo */}
          <div className="flex items-center justify-between py-2">
            <Label htmlFor="ativo">Produto ativo</Label>
            <Switch
              id="ativo"
              checked={formData.ativo}
              onCheckedChange={(checked) => handleChange("ativo", checked)}
            />
          </div>

          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1 bg-green-100 rounded text-green-700">
                <FileText className="w-4 h-4" />
              </div>
              <h4 className="font-semibold text-gray-800">Dados Fiscais (NFe)</h4>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="ncm">NCM *</Label>
                <Input
                  id="ncm"
                  value={formData.ncm || ""}
                  onChange={(e) => handleChange("ncm", e.target.value.replace(/\D/g, ''))}
                  placeholder="Ex: 94036000"
                  maxLength={8}
                  className={`font-mono text-sm ${errors.ncm ? "border-red-500" : ""}`}
                />
                {errors.ncm && (
                  <p className="text-xs text-red-500 mt-1">{errors.ncm}</p>
                )}
                <p className="text-[10px] text-gray-500 mt-1">Nomenclatura Comum do Mercosul</p>
              </div>
              <div>
                <Label htmlFor="cest">CEST</Label>
                <Input
                  id="cest"
                  value={formData.cest || ""}
                  onChange={(e) => handleChange("cest", e.target.value.replace(/\D/g, ''))}
                  placeholder="Ex: 2806100"
                  maxLength={7}
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="origem">Origem</Label>
                <Select
                  value={formData.origem !== undefined ? String(formData.origem) : "0"}
                  onValueChange={(v) => handleChange("origem", v)}
                >
                  <SelectTrigger className="font-mono text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0 - Nacional</SelectItem>
                    <SelectItem value="1">1 - Estrangeira (Importação direta)</SelectItem>
                    <SelectItem value="2">2 - Estrangeira (Adq. no mercado int.)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cfop">CFOP Padrão *</Label>
                <Input
                  id="cfop"
                  value={formData.cfop || "5102"}
                  onChange={(e) => handleChange("cfop", e.target.value.replace(/\D/g, ''))}
                  placeholder="Ex: 5102"
                  maxLength={4}
                  className={`font-mono text-sm ${errors.cfop ? "border-red-500" : ""}`}
                />
                {errors.cfop && (
                  <p className="text-xs text-red-500 mt-1">{errors.cfop}</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                produto ? "Salvar Alteracoes" : "Criar Produto"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}