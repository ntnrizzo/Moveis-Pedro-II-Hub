import React, { useState, useMemo, useEffect, useRef } from "react";
import { normSearch } from "@/lib/utils";
import { useSearchParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/contexts/TenantContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  Package,
  Filter,
  Grid3X3,
  List,
  Eye,
  Palette,
  Tag,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Copy,
  Image as ImageIcon,
  Loader2,
  Upload,
  ChevronDown,
  ChevronUp,
  Ruler,
  ChevronLeft,
  ChevronRight,
  Layers
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import ProdutoCadastroCompleto from "@/components/produtos/ProdutoCadastroCompleto";
import ImportProdutosModal from "@/components/produtos/ImportProdutosModal";
import { formatDimensions, formatPrice } from "@/utils/productFormatters";
import { getColorHex } from "@/components/produtos/FurnitureColorPicker";
import { CATEGORIAS } from "@/constants/productConstants";
import ProductIncompleteIndicator from "@/components/produtos/ProductIncompleteIndicator";
import { getProductStockFields } from "@/utils/stockUtils";
import GeradorEtiquetasModal from "@/components/legacy_estoque/GeradorEtiquetasModal";
import { Printer } from "lucide-react";
import { useProdutoFilters } from "@/hooks/useProdutoFilters";

export default function Produtos() {
  const {
    searchTerm,
    setSearchTerm,
    debouncedSearch,
    selectedCategoria,
    setSelectedCategoria,
    selectedFabricante,
    setSelectedFabricante,
    selectedOrdenacao,
    setSelectedOrdenacao,
    selectedDirecao,
    setSelectedDirecao,
    filtroAtencao,
    setFiltroAtencao,
    categorias,
    produtosComAtencao,
    aplicarOrdenacao
  } = useProdutoFilters();
  // fabricantes é derivado localmente dos produtos resolvidos (ver useMemo abaixo)
  const [viewMode, setViewMode] = useState("grid"); // grid ou list
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingProduto, setEditingProduto] = useState(null);
  const [modalMode, setModalMode] = useState('edit');
  const [savingProduto, setSavingProduto] = useState(false);
  const [pendingReturnUrl, setPendingReturnUrl] = useState(null);
  const [focusField, setFocusField] = useState(null);
  const [isGeradorEtiquetasOpen, setIsGeradorEtiquetasOpen] = useState(false);
  const [produtosParaEtiqueta, setProdutosParaEtiqueta] = useState([]);
  const handledHighlightRef = useRef('');
  const saveInFlightRef = useRef(false);
  const { user, loading, can } = useAuth();
  const { organization } = useTenant();

  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const hasMeaningfulValue = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized && !['n/a', 'na', '-', 'null', 'undefined', '?'].includes(normalized);
  };

  const getDisplayDimensions = (produto) => {
    const dimensions = formatDimensions(produto.largura, produto.altura, produto.profundidade);
    return dimensions === '-' ? null : dimensions;
  };

  const shouldShowSize = (produto) => {
    if (!hasMeaningfulValue(produto.tamanho)) return false;
    const dimensoesCompactas = [produto.largura, produto.altura, produto.profundidade].filter(Boolean).join('x').toLowerCase();
    const tamanhoCompacto = String(produto.tamanho).replace(/\s+/g, '').toLowerCase();
    return !dimensoesCompactas || tamanhoCompacto !== dimensoesCompactas;
  };

  // Query 1: todos os produtos (sem filtro de fabricante — feito via useMemo abaixo)
  const { data: rawProdutos = [], isLoading } = useQuery({
    queryKey: ['produtos'],
    queryFn: async () => {
      const allProdutos = await base44.entities.Produto.list('nome');
      return allProdutos || [];
    },
  });

  // Query 2: fornecedores — mesma chave usada pelo OcModal, beneficia do cache compartilhado
  const { data: fornecedoresList = [] } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: () => base44.entities.Fornecedor.list('nome_empresa'),
    staleTime: 1000 * 60 * 5,
  });

  // Mapa UUID → nome_empresa (fonte única de verdade)
  const fornecedoresById = useMemo(() => {
    return (fornecedoresList || []).reduce((acc, f) => {
      const id = String(f.id || '');
      const nome = String(f.nome_empresa || '').trim();
      if (id && nome) acc[id] = nome;
      return acc;
    }, {});
  }, [fornecedoresList]);

  // Produtos com nome do fornecedor resolvido (ID-first) e filtros de busca/categoria/atenção
  const { produtos, isFuzzy } = useMemo(() => {
    const mapped = (rawProdutos || []).map((p) => ({
      ...p,
      fornecedor_nome: String(fornecedoresById[String(p.fornecedor_id)] || p.fornecedor_nome || '').trim(),
    })).filter((p) => {
      if (selectedCategoria !== 'todas' && p.categoria !== selectedCategoria) return false;
      if (filtroAtencao && !p.requer_atencao) return false;
      return true;
    });

    if (!debouncedSearch) return { produtos: mapped, isFuzzy: false };

    const termos = normSearch(debouncedSearch).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return { produtos: mapped, isFuzzy: false };

    const scored = mapped
      .map(p => {
        const texto = [
          p.id,
          p.nome,
          p.modelo_referencia,
          p.categoria,
          p.ambiente,
          p.codigo_barras,
          p.sku,
          p.fornecedor_nome,
          p.cor,
          p.material,
          p.tamanho,
          p.descricao,
          p.descricao_completa,
          p.observacoes,
          p.ncm,
          p.gtin,
          p.ean,
          p.marca,
          p.largura,
          p.altura,
          p.profundidade,
        ]
          .filter(Boolean).map(normSearch).join(' ');
        const matches = termos.filter(t => texto.includes(t)).length;
        return { p, score: matches };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    const exact = scored.filter(({ score }) => score === termos.length);
    const fuzzy = exact.length === 0 && scored.length > 0;
    return {
      produtos: (fuzzy ? scored : exact).map(({ p }) => p),
      isFuzzy: fuzzy,
    };
  }, [rawProdutos, fornecedoresById, debouncedSearch, selectedCategoria, filtroAtencao]);

  // Lista de fabricantes para o dropdown — derivada dos mesmos produtos resolvidos
  const fabricantes = useMemo(() => {
    return [...new Set((produtos || []).map(p => p.fornecedor_nome).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [produtos]);

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Check for highlight param to auto-open edit modal
  useEffect(() => {
    const highlightId = searchParams.get('highlight');
    const returnUrl = searchParams.get('returnUrl');
    const focus = searchParams.get('focus');

    if (!highlightId) {
      handledHighlightRef.current = '';
      return;
    }

    const highlightKey = `${highlightId}|${focus || ''}|${returnUrl || ''}`;
    if (handledHighlightRef.current === highlightKey) {
      return;
    }

    if (highlightId && produtos?.length > 0 && !isLoading) {
      const productToEdit = produtos.find(p => String(p.id) === String(highlightId));
      if (productToEdit) {
        handledHighlightRef.current = highlightKey;
        setPendingReturnUrl(returnUrl ? decodeURIComponent(returnUrl) : null);
        openEditModal(productToEdit, focus);

        // Remove params to avoid reopening on refresh
        setSearchParams(params => {
          const newParams = new URLSearchParams(params);
          newParams.delete('highlight');
          newParams.delete('returnUrl');
          newParams.delete('focus');
          return newParams;
        }, { replace: true });
      }
    }
  }, [produtos, isLoading, searchParams, setSearchParams]);

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Produto.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      toast.success("Produto excluído com sucesso");
    },
    onError: (error) => {
      toast.error("Erro ao excluir: " + error.message);
    }
  });

  // Verificações de permissão
  const isAdmin = user?.cargo === 'Administrador';
  const canEdit = can('manage_produtos');
  const canDelete = isAdmin || can('manage_produtos');

  // Helper para calcular estoque total consolidado
  const getEstoqueTotal = (p) => {
    return p?.quantidade_estoque || p?.estoque_cd || 0;
  };

  const renderEstoqueBages = (produto, isListView = false) => {
    const stockFields = getProductStockFields(produto);
    const nonZeroFields = stockFields.filter(f => (produto[f] || 0) > 0);
    
    if (nonZeroFields.length === 0) {
      return (
        <Badge variant="secondary" className={`font-mono ${isListView ? 'text-xs' : 'text-[10px]'} bg-gray-50 text-gray-400 px-1.5 ${isListView ? '' : 'h-5'}`} title="Sem estoque">
          Est: 0
        </Badge>
      );
    }

    return (
      <div className={`flex flex-wrap justify-end gap-1 ${isListView ? 'max-w-[200px]' : 'max-w-[150px]'}`}>
        {nonZeroFields.map(field => {
          const val = produto[field];
          let name = field === 'estoque_cd' ? 'CD' :
                     field === 'estoque_mostruario_mega_store' ? 'Mega' :
                     field === 'estoque_mostruario_centro' ? 'Centro' :
                     field === 'estoque_mostruario_ponte_branca' ? 'P.Branca' :
                     field === 'estoque_mostruario_futura' ? 'Futura' :
                     field.replace('estoque_mostruario_', '').replace('estoque_', '').substring(0,8);
                     
          return (
            <Badge key={field} variant="outline" className={`font-mono ${isListView ? 'text-xs' : 'text-[9px]'} border-gray-200 text-gray-600 px-1.5 ${isListView ? 'py-0.5' : 'h-4'} flex items-center`} title={field}>
              {name}: <strong className="ml-1 text-gray-800">{val}</strong>
            </Badge>
          );
        })}
      </div>
    );
  };

  // Apply ordering to products
  const produtosOrdenados = useMemo(() => {
    // Aplica filtro de fabricante client-side (mesma resolu\u00e7\u00e3o que o dropdown)
    const filtrados = selectedFabricante === 'todos'
      ? (produtos || [])
      : (produtos || []).filter(p => p.fornecedor_nome === selectedFabricante);
    return aplicarOrdenacao(filtrados);
  }, [produtos, selectedFabricante, selectedOrdenacao, selectedDirecao, aplicarOrdenacao]);

  // Estatísticas
  const stats = useMemo(() => {
    const items = produtos || [];
    return {
      total: items.length,
      ativos: items.filter(p => p.ativo !== false).length,
      inativos: items.filter(p => p.ativo === false).length,
      semFoto: items.filter(p => !p.fotos?.length).length,
      semPreco: items.filter(p => !p.preco_venda).length,
      comAtencao: produtosComAtencao?.length || 0
    };
  }, [produtos, produtosComAtencao]);

  // Resetar página quando filtros mudarem
  React.useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedCategoria, selectedFabricante, filtroAtencao, selectedOrdenacao, selectedDirecao]);

  // Paginação
  const paginatedProdutos = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return produtosOrdenados.slice(startIndex, startIndex + itemsPerPage);
  }, [produtosOrdenados, currentPage]);

  const totalPages = Math.ceil(produtosOrdenados.length / itemsPerPage);

  const openEditModal = (produto, nextFocusField = null) => {
    setModalMode('edit');
    setFocusField(nextFocusField);
    setEditingProduto({ ...produto, nomeDisplay: produto.nome });
    setIsModalOpen(true);
  };

  const openViewModal = (produto) => {
    setModalMode('view');
    setFocusField(null);
    setEditingProduto({ ...produto, nomeDisplay: produto.nome });
    setIsModalOpen(true);
  };

  const handleEdit = (produto) => {
    openEditModal(produto, null);
  };

  const handleNew = () => {
    setModalMode('edit');
    setEditingProduto(null);
    setFocusField(null);
    setIsModalOpen(true);
  };

  const handleDuplicate = (produto) => {
    // Cria uma cópia do produto para edição
    const copy = {
      ...produto,
      id: undefined,
      nome: `${produto.nome} (Cópia)`,
      sku: '',
      codigo_barras: null,
    };
    setModalMode('edit');
    setEditingProduto(copy);
    setFocusField(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (produto) => {
    const confirmed = await confirm({
      title: "Excluir Produto",
      message: `Tem certeza que deseja excluir "${produto.nome}"? Esta ação não pode ser desfeita.`,
      confirmText: "Excluir",
      variant: "destructive"
    });
    if (confirmed) {
      deleteMutation.mutate(produto.id);
    }
  };

  const handleSave = async (data) => {
    if (saveInFlightRef.current) {
      return;
    }

    saveInFlightRef.current = true;
    setSavingProduto(true);
    try {
      let savedProduct;
      const precoNovo = parseFloat(data.preco_venda) || 0;
      const precoAntigo = editingProduto?.preco_venda || 0;

      if (editingProduto?.id) {
        savedProduct = await base44.entities.Produto.update(editingProduto.id, data);
        toast.success("Produto atualizado com sucesso");
      } else {
        savedProduct = await base44.entities.Produto.create(data);
        toast.success("Produto cadastrado com sucesso");
      }

      // --- REGISTRAR HISTÓRICO DE PREÇOS ---
      try {
        if (savedProduct && savedProduct.id && precoNovo !== precoAntigo) {
          await base44.entities.HistoricoPrecos?.create?.({
            organization_id: organization?.id || '00000000-0000-0000-0000-000000000001',
            produto_id: savedProduct.id,
            preco_antigo: precoAntigo,
            preco_novo: precoNovo,
            tipo: 'venda',
            motivo: editingProduto?.id ? 'Atualização Manual' : 'Cadastro Inicial',
            usuario_nome: user?.nome || 'Sistema'
          });
        }
      } catch (histErr) {
        console.warn('Não foi possível registrar histórico de preços:', histErr);
      }

      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      setIsModalOpen(false);
      setEditingProduto(null);
      setModalMode('edit');

      // Smart return flow
      if (pendingReturnUrl) {
        navigate(pendingReturnUrl);
        setPendingReturnUrl(null);
      }
    } catch (error) {
      console.error("Erro ao salvar:", error);
      toast.error("Erro ao salvar produto: " + error.message);
    } finally {
      saveInFlightRef.current = false;
      setSavingProduto(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: '#07593f' }} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" style={{ color: '#07593f' }}>
              Catálogo de Produtos
            </h1>
            <p className="text-gray-500">
              Gerencie seu catálogo de produtos, categorias e variações
            </p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button
                onClick={() => setIsImportModalOpen(true)}
                variant="outline"
                size="lg"
                className="gap-2"
              >
                <Upload className="w-5 h-5" />
                Importar CSV
              </Button>
              <Button
                onClick={() => { setProdutosParaEtiqueta([]); setIsGeradorEtiquetasOpen(true); }}
                variant="outline"
                size="lg"
                className="gap-2 border-green-200 text-green-700 hover:bg-green-50"
              >
                <Printer className="w-5 h-5" />
                Gerar Etiquetas
              </Button>
              <Button
                onClick={handleNew}
                size="lg"
                className="gap-2"
                style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
              >
                <Plus className="w-5 h-5" />
                Novo Produto
              </Button>
            </div>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <Card className="hover:shadow-md transition-all">
            <CardContent className="p-4 text-center">
              <Package className="w-6 h-6 mx-auto mb-1 text-gray-500" />
              <p className="text-2xl font-bold" style={{ color: '#07593f' }}>
                {stats.total}
              </p>
              <p className="text-xs text-gray-500">Total</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all">
            <CardContent className="p-4 text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-1 text-green-500" />
              <p className="text-2xl font-bold text-green-600">{stats.ativos}</p>
              <p className="text-xs text-gray-500">Ativos</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all">
            <CardContent className="p-4 text-center">
              <XCircle className="w-6 h-6 mx-auto mb-1 text-red-400" />
              <p className="text-2xl font-bold text-red-500">{stats.inativos}</p>
              <p className="text-xs text-gray-500">Inativos</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all">
            <CardContent className="p-4 text-center">
              <ImageIcon className="w-6 h-6 mx-auto mb-1 text-yellow-500" />
              <p className="text-2xl font-bold text-yellow-600">{stats.semFoto}</p>
              <p className="text-xs text-gray-500">Sem Foto</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all">
            <CardContent className="p-4 text-center">
              <AlertTriangle className="w-6 h-6 mx-auto mb-1 text-orange-500" />
              <p className="text-2xl font-bold text-orange-600">{stats.semPreco}</p>
              <p className="text-xs text-gray-500">Sem Preço</p>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-all ${filtroAtencao ? 'ring-2 ring-green-500' : 'hover:shadow-md'}`}
            onClick={() => setFiltroAtencao(!filtroAtencao)}
          >
            <CardContent className="p-4 text-center">
              <AlertTriangle className="w-6 h-6 mx-auto mb-1 text-red-500" />
              <p className="text-2xl font-bold text-red-600">{stats.comAtencao}</p>
              <p className="text-xs text-gray-500">Requer Atenção</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="space-y-4">
              {/* Search Row */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Buscar por nome, código, SKU ou fornecedor..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Filters Row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {/* Category Filter */}
                <Select value={selectedCategoria} onValueChange={setSelectedCategoria}>
                  <SelectTrigger>
                    <SelectValue placeholder="Categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas Categorias</SelectItem>
                    {categorias?.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Manufacturer Filter */}
                <Select value={selectedFabricante} onValueChange={setSelectedFabricante}>
                  <SelectTrigger>
                    <SelectValue placeholder="Fabricante" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos Fabricantes</SelectItem>
                    {fabricantes?.map(fab => (
                      <SelectItem key={fab} value={fab}>{fab}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Ordenacao */}
                <Select value={selectedOrdenacao} onValueChange={setSelectedOrdenacao}>
                  <SelectTrigger>
                    <SelectValue placeholder="Ordenar por" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alfabetica">Alfabética</SelectItem>
                    <SelectItem value="preco">Preço</SelectItem>
                    <SelectItem value="estoque">Estoque</SelectItem>
                  </SelectContent>
                </Select>

                {/* Direction */}
                <Select value={selectedDirecao} onValueChange={setSelectedDirecao}>
                  <SelectTrigger>
                    <SelectValue placeholder="Direção" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Crescente</SelectItem>
                    <SelectItem value="desc">Decrescente</SelectItem>
                  </SelectContent>
                </Select>

                {/* Attention Filter Button */}
                <Button
                  variant={filtroAtencao ? "default" : "outline"}
                  className="w-full"
                  onClick={() => setFiltroAtencao(!filtroAtencao)}
                >
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  {filtroAtencao ? "Com Atenção" : "Todas"}
                </Button>
              </div>

              {/* View Mode Toggle */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="px-3"
                >
                  <Grid3X3 className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="px-3"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-green-600" />
          </div>
        )}

        {/* Empty State */}
        {!isLoading && produtosOrdenados.length === 0 && (
          <Card className="py-16 text-center">
            <CardContent>
              <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                {debouncedSearch || selectedCategoria !== 'todas' || selectedFabricante !== 'todos' || filtroAtencao
                  ? 'Nenhum produto encontrado'
                  : 'Nenhum produto cadastrado'}
              </h3>
              <p className="text-gray-500 mb-6">
                {debouncedSearch || selectedCategoria !== 'todas' || selectedFabricante !== 'todos' || filtroAtencao
                  ? 'Tente ajustar os filtros de busca'
                  : 'Comece cadastrando seu primeiro produto'}
              </p>
              {canEdit && !debouncedSearch && selectedCategoria === 'todas' && selectedFabricante === 'todos' && !filtroAtencao && (
                <Button onClick={handleNew} className="gap-2" style={{ backgroundColor: '#07593f' }}>
                  <Plus className="w-4 h-4" />
                  Cadastrar Primeiro Produto
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Grid View */}
        {!isLoading && produtosOrdenados.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {paginatedProdutos.map(produto => (
              <Card
                key={produto.id}
                className={`group flex relative overflow-hidden cursor-pointer bg-white transition-all hover:shadow-lg hover:ring-1 hover:ring-green-500/20 ${produto.ativo === false ? 'opacity-75' : ''}`}
                onClick={() => {
                  openViewModal(produto);
                }}
              >
                {/* Image Section (Left) */}
                <div className="w-1/3 min-w-[120px] bg-gray-50 relative overflow-hidden border-r border-gray-100">
                  {produto.fotos?.[0] ? (
                    <img
                      src={produto.fotos[0]}
                      alt={produto.nome}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
                      <Package className="w-8 h-8 mb-1" />
                      <span className="text-[10px]">Sem foto</span>
                    </div>
                  )}

                  {/* ID Badge (Top Left) */}
                  <div className="absolute top-1.5 left-1.5 z-10">
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-white/90 backdrop-blur shadow-sm border-gray-200 text-gray-500">
                      #{produto.id}
                    </Badge>
                  </div>

                  {/* Badges Overlay */}
                  {produto.ativo === false && (
                    <Badge variant="destructive" className="absolute bottom-1.5 left-1.5 h-5 px-1.5 text-[10px] shadow-sm z-10">Inativo</Badge>
                  )}
                  {(produto.requer_atencao || !produto.preco_venda) && (
                    <Badge className="absolute bottom-1.5 right-1.5 bg-orange-500 text-[10px] h-5 px-1.5 shadow-sm z-10">
                      {!produto.preco_venda ? 'S/ Preço' : 'Atenção'}
                    </Badge>
                  )}
                </div>

                {/* Quick Edit Button (Overlay) */}
                {canEdit && (
                  <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20 flex gap-1">
                    <Button size="icon" variant="secondary" className="h-7 w-7 shadow-sm bg-white/90 backdrop-blur" onClick={(e) => { e.stopPropagation(); setProdutosParaEtiqueta([produto]); setIsGeradorEtiquetasOpen(true); }} title="Imprimir Etiqueta">
                      <Printer className="w-3.5 h-3.5 text-green-700" />
                    </Button>
                    <Button size="icon" variant="secondary" className="h-7 w-7 shadow-sm bg-white/90 backdrop-blur" onClick={(e) => { e.stopPropagation(); openEditModal(produto); }} title="Editar">
                      <Edit className="w-3.5 h-3.5 text-gray-700" />
                    </Button>
                  </div>
                )}

                {/* Content Section (Right) */}
                <div className="flex-1 p-3 flex flex-col justify-between min-w-0">

                  <div className="space-y-1">
                    <div className="flex justify-between items-start gap-2">
                      <p className="text-[10px] font-bold text-green-700 uppercase tracking-wider">{produto.categoria}</p>
                    </div>

                    <div className="flex items-start gap-2">
                      <h3 className="text-sm font-bold text-gray-900 leading-snug line-clamp-2" title={`${produto.nome} ${produto.modelo_referencia || ''}`}>
                        {produto.nome} <span className="text-gray-500 font-normal">{produto.modelo_referencia}</span>
                      </h3>
                      <ProductIncompleteIndicator
                        produto={produto}
                        canEdit={canEdit}
                        onSelectMissing={(missingItem) => openEditModal(produto, missingItem.focusField)}
                      />
                    </div>

                    {produto.fornecedor_nome && (
                      <p className="text-[11px] text-gray-400 truncate clamp-1">{produto.fornecedor_nome}</p>
                    )}

                    {/* Dimensoes e Material */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {getDisplayDimensions(produto) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 flex items-center" title="Dimensões (LxAxP)">
                          <Ruler className="w-3 h-3 mr-1 opacity-50" />
                          {getDisplayDimensions(produto)}
                        </span>
                      )}
                      {hasMeaningfulValue(produto.material) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 flex items-center" title="Material">
                          <Layers className="w-3 h-3 mr-1 opacity-50" /> {produto.material}
                        </span>
                      )}
                    </div>

                    {/* Atributos da Variação (Cor/Tamanho) */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {hasMeaningfulValue(produto.cor) && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 h-5 flex items-center gap-1 bg-gray-50 border border-gray-100" title="Cor">
                          <>
                            <div
                              className="w-2 h-2 rounded-full border border-gray-300"
                              style={{ background: getColorHex(produto.cor) }}
                            />
                            {produto.cor}
                          </>
                        </Badge>
                      )}
                      {shouldShowSize(produto) && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 h-5 bg-gray-50 border border-gray-100" title="Tamanho">
                          <Ruler className="w-3 h-3 mr-1 text-gray-400" />
                          {produto.tamanho}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Footer: Price & Stock */}
                  <div className="pt-2 mt-1 border-t border-gray-50 flex items-end justify-between gap-1">
                    <div className="flex flex-col">
                      {produto.preco_venda ? (
                        <span className="text-base font-bold text-green-800 leading-none">{formatPrice(produto.preco_venda)}</span>
                      ) : (
                        <span className="text-xs italic text-gray-400">Sob consulta</span>
                      )}
                    </div>

                    <div className="text-right">
                      {renderEstoqueBages(produto, false)}
                    </div>
                  </div>

                </div>
              </Card>
            ))}
          </div>
        )}

        {/* List View */}
        {
          !isLoading && produtosOrdenados.length > 0 && viewMode === 'list' && (
            <Card>
              <div className="divide-y">
                {paginatedProdutos.map((produto) => (
                  <div
                    key={produto.id}
                    className={`p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors ${produto.ativo === false ? 'opacity-75' : ''}`}
                  >
                    {/* Thumb */}
                    <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 relative">
                      {produto.fotos?.[0] ? (
                        <img
                          src={produto.fotos[0]}
                          alt={produto.nome}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-6 h-6 text-gray-300" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900">
                          {produto.nome}{produto.modelo_referencia ? ` ${produto.modelo_referencia}` : ''}
                        </h3>
                        {produto.ativo === false && (
                          <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Inativo</Badge>
                        )}
                        <ProductIncompleteIndicator
                          produto={produto}
                          canEdit={canEdit}
                          onSelectMissing={(missingItem) => openEditModal(produto, missingItem.focusField)}
                        />
                      </div>
                      <p className="text-sm text-gray-500 mb-2">
                        {produto.categoria}
                        {produto.fornecedor_nome && ` • ${produto.fornecedor_nome}`}
                        {produto.largura && produto.altura && ` • ${produto.largura}×${produto.altura}${produto.profundidade ? `×${produto.profundidade}` : ''} cm`}
                      </p>

                      {/* Atributos */}
                      {(produto.cor || produto.tamanho) && (
                        <div className="flex gap-2">
                          {produto.cor && (
                            <span className="text-xs text-gray-600 flex items-center gap-1">
                              <div className="w-2 h-2 rounded-full border" style={{ background: getColorHex(produto.cor) }} />
                              {produto.cor}
                            </span>
                          )}
                          {produto.tamanho && (
                            <span className="text-xs text-gray-600 flex items-center gap-1">
                              <Ruler className="w-3 h-3" />
                              {produto.tamanho}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Price and Stock */}
                    <div className="text-right flex flex-col items-end gap-1">
                      <div>
                        {produto.preco_venda ? (
                          <span className="text-base font-bold text-green-800">{formatPrice(produto.preco_venda)}</span>
                        ) : (
                          <span className="text-xs italic text-gray-400">Consulte</span>
                        )}
                      </div>
                      {renderEstoqueBages(produto, true)}
                    </div>

                    {/* Actions */}
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(produto)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setProdutosParaEtiqueta([produto]); setIsGeradorEtiquetasOpen(true); }}>
                            <Printer className="w-4 h-4 mr-2" />
                            Imprimir Etiqueta
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(produto)}>
                            <Copy className="w-4 h-4 mr-2" />
                            Duplicar
                          </DropdownMenuItem>
                          {canDelete && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(produto)}
                                className="text-red-600"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )
        }

        {/* Pagination Controls */}
        {!isLoading && produtosOrdenados.length > 0 && (
          <div className="flex flex-col md:flex-row justify-between items-center mt-6 gap-4">
            <p className="text-sm text-gray-500 flex items-center gap-2">
              Exibindo {Math.min((currentPage - 1) * itemsPerPage + 1, produtosOrdenados.length)} - {Math.min(currentPage * itemsPerPage, produtosOrdenados.length)} de {produtosOrdenados.length >= 100000 ? '+100k' : produtosOrdenados.length} produtos
              {isFuzzy && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">resultado mais próximo</span>}
            </p>

            <div className="flex gap-2 items-center">
              <span className="text-sm text-gray-400 mr-2">Página {currentPage} de {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-2" /> Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Próximo <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Cadastro */}
      <ProdutoCadastroCompleto
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingProduto(null);
          setFocusField(null);
          setModalMode('edit');
        }}
        onSave={modalMode === 'edit' ? handleSave : undefined}
        produto={editingProduto}
        focusField={focusField}
        isLoading={savingProduto}
        readOnly={modalMode === 'view'}
      />

      <GeradorEtiquetasModal
        isOpen={isGeradorEtiquetasOpen}
        onClose={() => setIsGeradorEtiquetasOpen(false)}
        produtosPreSelecionados={produtosParaEtiqueta}
        user={user}
      />

      {/* Modal de Importação */}
      <ImportProdutosModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['produtos'] })}
      />
    </div>
  );
}