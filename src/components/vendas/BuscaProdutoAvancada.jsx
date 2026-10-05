import React, { useState, useEffect, useRef, useMemo, useDeferredValue } from "react";
import { normSearch } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, Tag, Warehouse, Filter, Palette, ImageIcon, Edit2, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import ProdutoCadastroCompleto from "@/components/produtos/ProdutoCadastroCompleto";
import { getProductStockFields } from "@/utils/stockUtils";
import { resolveProductByIdentifier, IDENTIFIER_TYPES } from "@/domain/catalog/productResolver";

export default function BuscaProdutoAvancada(props) {
  const { produtos, onSelectProduto, onEditProduto, fornecedores = [] } = props;
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSavingProduto, setIsSavingProduto] = useState(false);
  const searchRef = useRef(null);

  // --- Estado do seletor de variantes ---
  const [variantesProduto, setVariantesProduto] = useState(null); // { produto, variantes: [...] }
  const [loadingVariantes, setLoadingVariantes] = useState(false);
  const [tecidoSelecionado, setTecidoSelecionado] = useState(null);
  const [corSelecionada, setCorSelecionada] = useState(null);

  const hasMeaningfulValue = (value) => {
    if (value === null || value === undefined) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized !== '' && !['n/a', 'na', '-', 'null', 'undefined', '?'].includes(normalized);
  };

  const getEstoqueDisponivel = (produto) => {
    if (!produto) return 0;

    const estoqueCampos = Object.entries(produto)
      .filter(([key, value]) => 
        key.startsWith('estoque_') && 
        key !== 'estoque_minimo' && 
        key !== 'estoque_ideal' && 
        typeof value !== 'object'
      )
      .map(([, value]) => Number(value || 0))
      .filter((value) => Number.isFinite(value));

    const sumLocations = estoqueCampos.reduce((acc, val) => acc + val, 0);
    const estoqueBase = estoqueCampos.length > 0
      ? sumLocations
      : Number(produto.quantidade_estoque || 0);
    const reservado = Number(produto.quantidade_reservada || 0);

    return Math.max(0, estoqueBase - reservado);
  };

  const renderEstoqueBages = (produto) => {
    const stockFields = getProductStockFields(produto);
    const nonZeroFields = stockFields.filter(f => (produto[f] || 0) > 0);
    
    if (nonZeroFields.length === 0) return null;

    return (
      <div className="flex flex-wrap justify-end gap-1 max-w-[180px] mt-0.5">
        {nonZeroFields.map(field => {
          const val = produto[field];
          let name = field === 'estoque_cd' ? 'CD' :
                     field === 'estoque_mostruario_mega_store' ? 'Mega' :
                     field === 'estoque_mostruario_centro' ? 'Centro' :
                     field === 'estoque_mostruario_ponte_branca' ? 'P.Branca' :
                     field === 'estoque_mostruario_futura' ? 'Futura' :
                     field.replace('estoque_mostruario_', '').replace('estoque_', '').substring(0,8);
                     
          return (
            <Badge key={field} variant="outline" className="font-mono text-[9px] border-gray-200 text-gray-600 px-1 py-0 h-4 flex items-center" title={field}>
              {name}: <strong className="ml-1 text-gray-800">{val}</strong>
            </Badge>
          );
        })}
      </div>
    );
  };

  // Fechar resultados ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
        resetVarianteSelector();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resetVarianteSelector = () => {
    setVariantesProduto(null);
    setTecidoSelecionado(null);
    setCorSelecionada(null);
    setLoadingVariantes(false);
  };

  // NavegaÃ§Ã£o por teclado
  const handleKeyDown = (e) => {
    if (variantesProduto) return; // Desabilitar nav teclado quando seletor de variante estÃ¡ aberto
    if (!showResults || produtosFiltrados.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, produtosFiltrados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (produtosFiltrados[selectedIndex]) {
        handleSelectProduto(produtosFiltrados[selectedIndex]);
      }
    }
  };

  // Buscar variantes de um produto na tabela produto_variantes
  const fetchVariantes = async (produtoId) => {
    setLoadingVariantes(true);
    try {
      const { data, error } = await supabase
        .from('produto_variantes')
        .select(`
          id,
          sku,
          preco_venda,
          ativo,
          cor_id,
          tecido_id,
          cores ( id, nome, hex ),
          tecidos ( id, nome )
        `)
        .eq('produto_id', produtoId)
        .eq('ativo', true);

      if (error) {
        console.error('[BuscaProduto] Erro ao buscar variantes:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('[BuscaProduto] Erro ao buscar variantes:', err);
      return [];
    } finally {
      setLoadingVariantes(false);
    }
  };

  const handleSelectProduto = async (produto) => {
    // Buscar variantes desse produto
    const variantes = await fetchVariantes(produto.id);

    if (variantes.length === 0) {
      // Produto sem variantes â†’ adiciona direto (comportamento original)
      onSelectProduto({ ...produto, is_encomenda: false });
      setSearchTerm("");
      setShowResults(false);
      setSelectedIndex(0);
      return;
    }

    // Produto com variantes â†’ abrir seletor
    setVariantesProduto({ produto, variantes });
    setTecidoSelecionado(null);
    setCorSelecionada(null);
  };

  // Extrair tecidos Ãºnicos das variantes
  const tecidosDisponiveis = variantesProduto
    ? [...new Map(
        variantesProduto.variantes
          .filter(v => v.tecidos?.nome)
          .map(v => [v.tecidos.id, v.tecidos])
      ).values()]
    : [];

  // Extrair cores Ãºnicas (filtradas pelo tecido selecionado, se houver)
  const coresDisponiveis = variantesProduto
    ? [...new Map(
        variantesProduto.variantes
          .filter(v => {
            if (tecidoSelecionado) return v.tecido_id === tecidoSelecionado;
            if (tecidosDisponiveis.length === 0) return true; // Sem tecidos: mostra todas as cores
            return true;
          })
          .filter(v => v.cores?.nome)
          .map(v => [v.cores.id, v.cores])
      ).values()]
    : [];

  // Resolver a variante exata baseado em tecido + cor selecionados
  const resolverVarianteExata = () => {
    if (!variantesProduto) return null;
    return variantesProduto.variantes.find(v => {
      const matchTecido = tecidoSelecionado ? v.tecido_id === tecidoSelecionado : !v.tecido_id;
      const matchCor = corSelecionada ? v.cor_id === corSelecionada : !v.cor_id;
      return matchTecido && matchCor;
    });
  };

  const confirmarVariante = (varianteExata) => {
    if (!varianteExata || !variantesProduto) return;

    const { produto } = variantesProduto;
    const nomeCompleto = [
      produto.nome,
      varianteExata.tecidos?.nome,
      varianteExata.cores?.nome
    ].filter(Boolean).join(' - ');

    onSelectProduto({
      ...produto,
      nome: nomeCompleto,
      preco_venda: varianteExata.preco_venda || produto.preco_venda,
      variante_id: varianteExata.id,
      variante_sku: varianteExata.sku,
      cor: varianteExata.cores?.nome || '',
      cor_hex: varianteExata.cores?.hex || null,
      tecido: varianteExata.tecidos?.nome || '',
      is_encomenda: false
    });

    setSearchTerm("");
    setShowResults(false);
    setSelectedIndex(0);
    resetVarianteSelector();
  };

  // Auto-confirmar quando a variante Ã© resolvida sem ambiguidade
  const handleSelecionarTecido = (tecidoId) => {
    setTecidoSelecionado(tecidoId);
    setCorSelecionada(null);

    // Se nÃ£o hÃ¡ cores para esse tecido, resolver direto
    const variantesComTecido = variantesProduto.variantes.filter(v => v.tecido_id === tecidoId);
    const coresDoTecido = variantesComTecido.filter(v => v.cores?.nome);

    if (coresDoTecido.length === 0) {
      // Sem cores â€” resolver a variante imediata
      const varianteExata = variantesComTecido[0];
      if (varianteExata) {
        confirmarVariante(varianteExata);
      }
    } else if (coresDoTecido.length === 1) {
      // Apenas uma cor â€” resolver automaticamente
      confirmarVariante(coresDoTecido[0]);
    }
  };

  const handleSelecionarCor = (corId) => {
    setCorSelecionada(corId);

    // Resolver a variante exata
    const varianteExata = variantesProduto.variantes.find(v => {
      const matchTecido = tecidoSelecionado ? v.tecido_id === tecidoSelecionado : !v.tecido_id;
      return matchTecido && v.cor_id === corId;
    });

    if (varianteExata) {
      confirmarVariante(varianteExata);
    }
  };

  // Se nÃ£o hÃ¡ tecidos e sim apenas cores, pular direto para seleÃ§Ã£o de cor
  const mostrarApenasCores = variantesProduto && tecidosDisponiveis.length === 0 && coresDisponiveis.length > 0;
  const mostrarTecidos = variantesProduto && tecidosDisponiveis.length > 0 && !tecidoSelecionado;
  const mostrarCores = variantesProduto && tecidoSelecionado && coresDisponiveis.length > 0;

  // Filtrar e pontuar produtos com índice de busca memoizado para evitar reprocessar tudo a cada tecla
  const searchableProdutos = useMemo(() => {
    if (!Array.isArray(produtos)) return [];

    return produtos
      .filter((p) => p?.ativo !== false)
      .map((p) => {
        const camposBusca = [
          p.id,
          p.nome,
          p.modelo_referencia,
          p.codigo_barras,
          p.sku,
          p.gtin,
          p.ean,
          p.ncm,
          p.categoria,
          p.ambiente,
          p.material,
          p.cor,
          p.marca,
          p.fornecedor_nome,
          p.descricao,
          p.descricao_completa,
          p.observacoes,
          p.largura,
          p.altura,
          p.profundidade,
        ]
          .filter((value) => value !== null && value !== undefined && value !== '')
          .map(normSearch)
          .join(' ');

        return { produto: p, searchText: camposBusca };
      });
  }, [produtos]);

  const searchTokens = useMemo(() => {
    const normalized = normSearch(deferredSearchTerm);
    return normalized.split(/\s+/).filter((token) => token.length > 0);
  }, [deferredSearchTerm]);

  const { produtosFiltrados, isFuzzy } = useMemo(() => {
    if (searchTokens.length === 0 || !deferredSearchTerm.trim()) {
      return { produtosFiltrados: [], isFuzzy: false };
    }

    const scoredProdutos = searchableProdutos
      .map(({ produto, searchText }) => {
        const matches = searchTokens.reduce((total, token) => total + (searchText.includes(token) ? 1 : 0), 0);
        return matches > 0 ? { produto, score: matches } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const exactMatches = scoredProdutos.filter(({ score }) => score === searchTokens.length);
    const fuzzy = exactMatches.length === 0 && scoredProdutos.length > 0;
    const resultados = (fuzzy ? scoredProdutos : exactMatches).map((item) => item.produto);

    return { produtosFiltrados: resultados, isFuzzy: fuzzy };
  }, [deferredSearchTerm, searchableProdutos, searchTokens]);

  return (
    <div ref={searchRef} className="relative">
      {/* Barra de busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Buscar produto por nome, cÃ³digo ou categoria..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setShowResults(true);
            setSelectedIndex(0);
            resetVarianteSelector();
          }}
          onFocus={() => setShowResults(true)}
          onKeyDown={handleKeyDown}
          className="pl-10 h-11 border-2 border-green-600 focus:border-green-700 rounded-lg"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm("");
              setShowResults(false);
              resetVarianteSelector();
            }}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            âœ•
          </button>
        )}
      </div>

      {/* Dropdown de resultados */}
      {showResults && searchTerm && !variantesProduto && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-neutral-900 border-2 border-green-600 rounded-lg shadow-2xl overflow-hidden">
          {produtosFiltrados.length === 0 ? (
            <div className="p-6 text-center space-y-3">
              <Package className="w-8 h-8 mx-auto text-gray-300" />
              <div>
                <p className="text-sm font-medium text-gray-600">Nenhum produto encontrado</p>
                <p className="text-xs text-gray-400 mt-1">
                  O produto pode ser criado automaticamente como pendente.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                disabled={isSavingProduto}
                onClick={async () => {
                  const value = searchTerm.trim();
                  if (!value) return;

                  setIsSavingProduto(true);
                  try {
                    const result = await resolveProductByIdentifier({
                      supabase,
                      identifierType: IDENTIFIER_TYPES.SKU,
                      identifierValue: value,
                    });

                    await queryClient.invalidateQueries({ queryKey: ['produtos'] });

                    if (result?.product_id) {
                      const { data: produtoCriado, error } = await supabase
                        .from('produtos')
                        .select('*')
                        .eq('id', result.product_id)
                        .single();

                      if (error) throw error;

                      onSelectProduto({
                        ...produtoCriado,
                        is_encomenda: false,
                      });

                      setSearchTerm("");
                      setShowResults(false);
                      toast.success(
                        result.created
                          ? "Produto criado como cadastro pendente e adicionado ao carrinho."
                          : "Produto localizado e adicionado ao carrinho."
                      );
                    }
                  } catch (error) {
                    console.error("[V2] Erro ao resolver produto:", error);
                    toast.error(
                      "Não foi possível criar/localizar o produto. A estrutura V2 precisa estar aplicada no banco."
                    );
                  } finally {
                    setIsSavingProduto(false);
                  }
                }}
                className="w-full border-green-200 text-green-700 hover:bg-green-50"
              >
                <Plus className="w-4 h-4 mr-2" />
                Usar "{searchTerm.trim()}" como código
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsModalOpen(true)}
                className="w-full text-xs text-gray-500 hover:text-green-700"
              >
                Cadastrar item manualmente
              </Button>
            </div>
          ) : (
            <>
              <div className="bg-gray-50 dark:bg-neutral-800 px-4 py-2 border-b border-gray-200 dark:border-neutral-700 flex items-center gap-2">
                <p className="text-xs text-gray-500">{produtosFiltrados.length} produto(s) encontrado(s)</p>
                {isFuzzy && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">resultado mais prÃ³ximo</span>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto">
                {produtosFiltrados.slice(0, 10).map((produto, index) => {
                  const qtd = getEstoqueDisponivel(produto);
                  const isSelected = index === selectedIndex;
                  const tipoEstoque = produto.tipo_estoque || 'herdado';
                  const semEstoque = qtd <= 0;
                  const bloqueado = tipoEstoque === 'pronta_entrega' && semEstoque;
                  const dimensoes = (hasMeaningfulValue(produto.largura) || hasMeaningfulValue(produto.altura) || hasMeaningfulValue(produto.profundidade))
                    ? [
                        hasMeaningfulValue(produto.largura) ? `L:${produto.largura}` : null,
                        hasMeaningfulValue(produto.altura) ? `A:${produto.altura}` : null,
                        hasMeaningfulValue(produto.profundidade) ? `P:${produto.profundidade}` : null,
                      ].filter(Boolean).join(' ') + ' cm'
                    : null;
                  const detalhesTecnicos = [
                    hasMeaningfulValue(produto.cor) ? produto.cor : null,
                    hasMeaningfulValue(produto.material) ? produto.material : null,
                    hasMeaningfulValue(produto.fornecedor_nome) ? produto.fornecedor_nome : null,
                    produto.categoria || 'Outros',
                  ].filter(Boolean).join(' Â· ');

                  return (
                    <div
                      key={produto.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectProduto(produto)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectProduto(produto);
                        }
                      }}
                      className={`w-full text-left px-4 py-2.5 flex flex-col gap-1 border-b border-gray-100 dark:border-neutral-800 transition-colors ${isSelected ? 'bg-green-50 dark:bg-green-900/30' : 'hover:bg-gray-50 dark:hover:bg-neutral-800'
                        }`}
                    >
                      {/* Linha principal: Imagem + Nome + Modelo + PreÃ§o */}
                      <div className="flex items-center justify-between w-full gap-3">
                        {/* Imagem do Produto Produto (Cascata) */}
                        <div className="w-10 h-10 shrink-0 border rounded overflow-hidden bg-gray-50 flex items-center justify-center">
                          {produto.fotos?.[0] ? (
                            <img src={produto.fotos[0]} alt={produto.nome} className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="w-5 h-5 text-gray-300" />
                          )}
                        </div>

                        <span
                          className="flex-1 text-sm font-medium text-gray-800 dark:text-white truncate"
                          title={`${produto.nome}${produto.modelo_referencia ? ` - ${produto.modelo_referencia}` : ''}`}
                        >
                          <span className="text-xs text-gray-400 mr-2">#{produto.id}</span>
                          {produto.nome}{produto.modelo_referencia ? ` - ${produto.modelo_referencia}` : ''}
                        </span>
                        <span className="text-sm font-bold text-green-700 dark:text-green-400 ml-2">
                          R$ {produto.preco_venda?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      {/* Linha de detalhes */}
                      <div className="flex items-start justify-between w-full gap-2">
                        <div className="min-w-0 flex-1">
                          {dimensoes && (
                            <p className="text-[12px] font-semibold text-emerald-800 dark:text-emerald-300 leading-tight truncate">
                              <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-[10px] font-bold uppercase tracking-wide">
                                Medidas
                              </span>
                              <span className="tracking-wide">{dimensoes}</span>
                            </p>
                          )}
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-none truncate mt-0.5">
                            {detalhesTecnicos}
                          </p>
                        </div>
                        <div className="flex flex-col items-end shrink-0">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-semibold">
                              {bloqueado ? (
                                <span className="text-red-500">Sem estoque</span>
                              ) : semEstoque ? (
                                <span className="text-amber-500">Sob encomenda</span>
                              ) : (
                                <span className={qtd <= 5 ? 'text-orange-500' : 'text-green-600'}>Total: {qtd}un</span>
                              )}
                            </span>
                            {onEditProduto && (
                              <div onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 rounded-full hover:bg-blue-100 text-blue-600"
                                  title="Editar Produto"
                                  onClick={() => onEditProduto(produto)}
                                >
                                  <Edit2 className="w-3 h-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                          {renderEstoqueBages(produto)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Footer with Request Button */}
              <div className="p-2 border-t border-gray-100 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-900">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsModalOpen(true);
                  }}
                  className="w-full text-xs text-gray-500 hover:text-green-700 h-8 font-normal"
                >
                  <Plus className="w-3 h-3 mr-2" /> NÃ£o encontrou? Cadastrar item
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* === SELETOR DE VARIANTES (Tecido â†’ Cor) === */}
      {variantesProduto && showResults && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-neutral-900 border-2 border-green-600 rounded-lg shadow-2xl overflow-hidden">
          {/* Header do seletor */}
          <div className="bg-green-50 dark:bg-green-900/20 px-4 py-3 border-b border-green-200 dark:border-green-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-green-700 dark:text-green-400" />
                <span className="text-sm font-semibold text-green-800 dark:text-green-300">
                  {variantesProduto.produto.nome}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-gray-500 hover:text-gray-700"
                onClick={resetVarianteSelector}
              >
                âœ• Cancelar
              </Button>
            </div>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              {variantesProduto.variantes.length} variante(s) disponÃ­vel(is) â€” selecione a combinaÃ§Ã£o desejada
            </p>
          </div>

          {loadingVariantes && (
            <div className="p-6 text-center">
              <Loader2 className="w-6 h-6 mx-auto animate-spin text-green-600 mb-2" />
              <p className="text-sm text-gray-500">Carregando variantes...</p>
            </div>
          )}

          {/* Seletor de Tecido */}
          {(mostrarTecidos) && (
            <div className="p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Selecione o Tecido</p>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {tecidosDisponiveis.map(tecido => (
                  <button
                    key={tecido.id}
                    type="button"
                    onClick={() => handleSelecionarTecido(tecido.id)}
                    className="text-left px-3 py-2 rounded-md border border-gray-200 dark:border-neutral-700 hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{tecido.nome}</span>
                    <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Seletor de Cor (apÃ³s selecionar tecido OU se nÃ£o hÃ¡ tecidos) */}
          {(mostrarCores || mostrarApenasCores) && (
            <div className="p-3">
              {tecidoSelecionado && (
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="text-xs">
                    Tecido: {tecidosDisponiveis.find(t => t.id === tecidoSelecionado)?.nome}
                  </Badge>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => { setTecidoSelecionado(null); setCorSelecionada(null); }}
                  >
                    alterar
                  </button>
                </div>
              )}
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Selecione a Cor</p>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {coresDisponiveis.map(cor => (
                  <button
                    key={cor.id}
                    type="button"
                    onClick={() => handleSelecionarCor(cor.id)}
                    className="text-left px-3 py-2 rounded-md border border-gray-200 dark:border-neutral-700 hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors flex items-center gap-2"
                  >
                    {cor.hex && (
                      <div
                        className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                        style={{ backgroundColor: cor.hex }}
                      />
                    )}
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{cor.nome}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ProdutoCadastroCompleto
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        produto={null}
        isLoading={isSavingProduto}
        onSave={async (data) => {
          if (isSavingProduto) return;

          setIsSavingProduto(true);
          try {
            const novoProduto = await base44.entities.Produto.create({
              ...data,
              requer_atencao: true,
              motivo_atencao: data?.motivo_atencao || "Cadastro iniciado no PDV por vendedor",
            });
            await queryClient.invalidateQueries({ queryKey: ['produtos'] });
            setIsModalOpen(false);

            if (novoProduto?.id) {
              handleSelectProduto(novoProduto);
              toast.success("Produto cadastrado e adicionado ao carrinho.");
              return;
            }

            toast.success("Produto cadastrado! Voce ja pode busca-lo na lista.");
          } catch (error) {
            toast.error(`Erro ao cadastrar produto: ${error.message}`);
          } finally {
            setIsSavingProduto(false);
          }
        }}
      />
    </div>
  );
}
