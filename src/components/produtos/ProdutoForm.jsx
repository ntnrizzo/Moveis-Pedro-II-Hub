import React, { useState, useEffect } from "react";
import { useAuth } from '@/hooks/useAuth';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Upload, X, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { isValidGTIN, normalizeGTIN, normalizeSKU, generateSafeSKU } from "@/utils/gtinValidator";

const categorias = ["Sofá", "Cama", "Mesa", "Cadeira", "Armário", "Estante", "Rack", "Poltrona", "Escrivaninha", "Criado-mudo", "Buffet", "Aparador", "Banco", "Travesseiro", "Almofada", "Decorações", "Utensílios", "Outros"];
const ambientes = ["Quarto", "Sala", "Cozinha", "Escritório", "Banheiro", "Área Externa", "Hall", "Varanda"];

export default function ProdutoForm({ produto = null, onSave, isLoading }) {
  const { user } = useAuth();
  const showFinancials = user?.cargo === 'Administrador';
  const [formData, setFormData] = useState({
    sku: "",
    codigo_barras: "",
    nome: "",
    modelo_referencia: "",
    fornecedor_id: "",
    categoria: "Outros",
    ambiente: "Sala",
    descricao: "",
    largura: 0,
    altura: 0,
    profundidade: 0,
    material: "",
    cor: "",
    tags: [],
    variacoes: [],
    fotos: [],
    preco_venda: 0,
    preco_custo: 0,
    quantidade_estoque: 0,
    estoque_minimo: "",
    ativo: true
  });

  const [buscandoBarcode, setBuscandoBarcode] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [uploadingImages, setUploadingImages] = useState(false);

  const { data: fornecedores } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: () => base44.entities.Fornecedor.list()
  });

  useEffect(() => {
    if (produto) {
      setFormData(produto);
    }
  }, [produto]);

  const buscarPorCodigoBarras = async () => {
    if (!formData.codigo_barras) {
      alert("Digite um código de barras");
      return;
    }

    setBuscandoBarcode(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Encontre informações sobre o produto móvel com código de barras: ${formData.codigo_barras}. 
        Retorne APENAS dados de móveis e produtos relacionados.
        Se não encontrar informações ou se for um produto irrelevante (como alimentos, eletrônicos, etc), retorne null.
        Caso encontre, retorne as informações básicas: nome, categoria (escolha entre: Sofá, Cama, Mesa, Cadeira, Armário, Estante, Rack, Poltrona, Escrivaninha, Criado-mudo, Buffet, Aparador, Banco, Travesseiro, Almofada, Decorações, Utensílios, Outros), descrição breve, material, cor.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            nome: { type: "string" },
            categoria: { type: "string" },
            descricao: { type: "string" },
            material: { type: "string" },
            cor: { type: "string" }
          }
        }
      });

      if (response && response.nome) {
        setFormData(prev => ({
          ...prev,
          nome: response.nome || prev.nome,
          categoria: categorias.includes(response.categoria) ? response.categoria : prev.categoria,
          descricao: response.descricao || prev.descricao,
          material: response.material || prev.material,
          cor: response.cor || prev.cor
        }));
      } else {
        toast.warning("Nenhuma informação encontrada para este código de barras.");
      }
    } catch (error) {
      console.error("Erro ao buscar informações:", error);
      toast.error("Erro ao buscar informações do produto");
    } finally {
      setBuscandoBarcode(false);
    }
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploadingImages(true);
    try {
      const uploadPromises = files.map(file =>
        base44.integrations.Core.UploadFile({ file })
      );

      const results = await Promise.all(uploadPromises);
      const newUrls = results.map(r => r.file_url);

      setFormData(prev => ({
        ...prev,
        fotos: [...prev.fotos, ...newUrls]
      }));
    } catch (error) {
      console.error("Erro ao fazer upload:", error);
      toast.error("Erro ao fazer upload das imagens");
    } finally {
      setUploadingImages(false);
    }
  };

  const removerFoto = (index) => {
    setFormData(prev => ({
      ...prev,
      fotos: prev.fotos.filter((_, i) => i !== index)
    }));
  };

  const adicionarTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()]
      }));
      setTagInput("");
    }
  };

  const removerTag = (tag) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome || !formData.categoria) {
      toast.warning("Preencha nome e categoria do produto");
      return;
    }

    if (formData.preco_venda <= 0) {
      toast.warning("Informe um preço de venda válido");
      return;
    }

    if (formData.codigo_barras && formData.codigo_barras.trim()) {
      if (!isValidGTIN(formData.codigo_barras)) {
        toast.error("Código de barras inválido. Deve ser um GTIN oficial (8, 12, 13 ou 14 dígitos com checksum).");
        return;
      }
    }

    const skuFinal = (formData.sku && formData.sku.trim())
      ? normalizeSKU(formData.sku)
      : (produto?.sku || generateSafeSKU('PRD'));
    const gtinFinal = (formData.codigo_barras && formData.codigo_barras.trim())
      ? normalizeGTIN(formData.codigo_barras, true)
      : null;

    // Limpa os dados antes de enviar
    const dadosParaSalvar = {
      ...formData,
      sku: skuFinal,
      codigo_barras: gtinFinal,
      modelo_referencia: formData.modelo_referencia || null,
      fornecedor_id: formData.fornecedor_id === "" ? null : formData.fornecedor_id,
      preco_venda: Number(formData.preco_venda),
      preco_custo: Number(formData.preco_custo),
      largura: Number(formData.largura),
      altura: Number(formData.altura),
      profundidade: Number(formData.profundidade),
      quantidade_estoque: Number(formData.quantidade_estoque),
      estoque_minimo: formData.estoque_minimo ? Number(formData.estoque_minimo) : 0,
    };

    onSave(dadosParaSalvar);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Código de Barras */}
      <div className="p-4 rounded-lg border-2" style={{ borderColor: '#3b82f6', backgroundColor: '#eff6ff' }}>
        <Label htmlFor="codigo_barras">Código de Barras (EAN / GTIN)</Label>
        <div className="flex gap-2 mt-2">
          <Input
            id="codigo_barras"
            value={formData.codigo_barras}
            onChange={(e) => setFormData({ ...formData, codigo_barras: e.target.value })}
            placeholder="Digite ou escaneie o código (GTIN oficial)"
          />
          <Button
            type="button"
            onClick={buscarPorCodigoBarras}
            disabled={buscandoBarcode}
            style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)' }}
          >
            {buscandoBarcode ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-xs mt-2" style={{ color: '#1e40af' }}>
          Preencha o código e clique em buscar para autocompletar
        </p>
      </div>

      {/* Informações Básicas */}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="nome">Nome do Produto *</Label>
          <Input
            id="nome"
            value={formData.nome}
            onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
            placeholder="Nome do produto"
          />
        </div>

        <div>
          <Label htmlFor="sku">SKU / Código Interno *</Label>
          <Input
            id="sku"
            value={formData.sku}
            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
            placeholder={produto ? "Ex: SOF-RET-3L" : "Gerado automaticamente se vazio"}
            className="font-mono"
          />
        </div>
        <div>
          <Label htmlFor="modelo_referencia">Modelo / Referência</Label>
          <Input
            id="modelo_referencia"
            value={formData.modelo_referencia}
            onChange={(e) => setFormData({ ...formData, modelo_referencia: e.target.value })}
            placeholder="Ex: REF-1234, Premium, etc"
          />
        </div>
        <div>
          <Label htmlFor="fornecedor">Fornecedor</Label>
          <Select
            value={formData.fornecedor_id}
            onValueChange={(value) => {
              const fornecedor = (fornecedores || []).find(f => f.id === value);
              setFormData({
                ...formData,
                fornecedor_id: value,
                fornecedor_nome: fornecedor?.nome || ""
              });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {(fornecedores || []).map(f => (
                <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="categoria">Categoria *</Label>
          <Select
            value={formData.categoria}
            onValueChange={(value) => setFormData({ ...formData, categoria: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categorias.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="ambiente">Ambiente</Label>
          <Select
            value={formData.ambiente}
            onValueChange={(value) => setFormData({ ...formData, ambiente: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ambientes.map(amb => (
                <SelectItem key={amb} value={amb}>{amb}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="descricao">Descrição</Label>
        <Textarea
          id="descricao"
          value={formData.descricao}
          onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
          rows={3}
        />
      </div>

      {/* Dimensões */}
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="largura">Largura (cm)</Label>
          <Input
            id="largura"
            type="number"
            step="0.01"
            value={formData.largura}
            onChange={(e) => setFormData({ ...formData, largura: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="altura">Altura (cm)</Label>
          <Input
            id="altura"
            type="number"
            step="0.01"
            value={formData.altura}
            onChange={(e) => setFormData({ ...formData, altura: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="profundidade">Profundidade (cm)</Label>
          <Input
            id="profundidade"
            type="number"
            step="0.01"
            value={formData.profundidade}
            onChange={(e) => setFormData({ ...formData, profundidade: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>

      {/* Material e Cor */}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="material">Material</Label>
          <Input
            id="material"
            value={formData.material}
            onChange={(e) => setFormData({ ...formData, material: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="cor">Cor</Label>
          <Input
            id="cor"
            value={formData.cor}
            onChange={(e) => setFormData({ ...formData, cor: e.target.value })}
          />
        </div>
      </div>

      {/* Tags */}
      <div>
        <Label>Tags</Label>
        <div className="flex gap-2 mt-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), adicionarTag())}
            placeholder="Digite uma tag e pressione Enter"
          />
          <Button type="button" onClick={adicionarTag}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {formData.tags.map((tag, i) => (
            <Badge key={i} className="flex items-center gap-1">
              {tag}
              <button type="button" onClick={() => removerTag(tag)} className="ml-1">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      </div>

      {/* Fotos */}
      <div>
        <Label>Fotos do Produto</Label>
        <div className="mt-2">
          <label className="cursor-pointer">
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
              disabled={uploadingImages}
            />
            <div className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-gray-50">
              {uploadingImages ? (
                <Loader2 className="w-8 h-8 mx-auto animate-spin" style={{ color: '#07593f' }} />
              ) : (
                <>
                  <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: '#8B8B8B' }} />
                  <p className="text-sm" style={{ color: '#8B8B8B' }}>
                    Clique para fazer upload de imagens
                  </p>
                </>
              )}
            </div>
          </label>
        </div>
        {formData.fotos.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {formData.fotos.map((foto, index) => (
              <div key={index} className="relative group aspect-square rounded-lg overflow-hidden border bg-white shadow-sm">
                <img
                  src={foto}
                  alt={`Foto ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removerFoto(index)}
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
      </div>

      {/* Preços e Estoque */}
      <div className="grid md:grid-cols-2 gap-4">
        {showFinancials && (
          <div>
            <Label htmlFor="preco_custo">Preço de Custo (R$)</Label>
            <Input
              id="preco_custo"
              type="number"
              step="0.01"
              value={formData.preco_custo}
              onChange={(e) => setFormData({ ...formData, preco_custo: parseFloat(e.target.value) || 0 })}
            />
          </div>
        )}
        <div>
          <Label htmlFor="preco_venda">Preço de Venda (R$) *</Label>
          <Input
            id="preco_venda"
            type="number"
            step="0.01"
            value={formData.preco_venda}
            onChange={(e) => setFormData({ ...formData, preco_venda: parseFloat(e.target.value) || 0 })}
            required
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="quantidade_estoque">Quantidade em Estoque</Label>
          <Input
            id="quantidade_estoque"
            type="number"
            value={formData.quantidade_estoque}
            onChange={(e) => setFormData({ ...formData, quantidade_estoque: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="estoque_minimo">Estoque Mínimo</Label>
          <Input
            id="estoque_minimo"
            type="number"
            value={formData.estoque_minimo}
            onChange={(e) => setFormData({ ...formData, estoque_minimo: e.target.value })}
          />
        </div>
      </div>

      {/* Botão Salvar */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button
          type="submit"
          disabled={isLoading}
          size="lg"
          style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Salvando...
            </>
          ) : (
            produto ? "Atualizar Produto" : "Cadastrar Produto"
          )}
        </Button>
      </div>
    </form>
  );
}