import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus,
  Search,
  Filter,
  Download,
  Copy,
  TrendingUp,
  Package,
  AlertTriangle,
  HelpCircle,
  ShoppingCart,
  Truck,
  CheckCircle,
  DollarSign,
  Wrench,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useConfirm } from '@/hooks/useConfirm';
import { useTenant } from '@/contexts/TenantContext';
import { comprasService } from '@/services/comprasService';
import OcTable from '@/components/compras/OcTable';
import CriarLancamentoFromOcModal from '@/components/compras/CriarLancamentoFromOcModal';
import OcModal from '@/components/compras/OcModal';
import SolicitacoesReposicaoTab from '@/components/compras/SolicitacoesReposicaoTab';
import RecebimentoModal from '@/components/compras/RecebimentoModal';
import EnviarOcModal from '@/components/compras/EnviarOcModal';
import PaymentApprovalModal from '@/components/compras/PaymentApprovalModal';
import AjustePrecoModal from '@/components/configuracoes/AjustePrecoModal';
import { VendaDetalhesModal } from '@/components/vendas/VendaDetalhesModal';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/lib/supabase';
import { useAlertasEstoque } from '@/hooks/useAlertasEstoque';

function getEncomendaVendor(encomenda, vendaRelacionada) {
  return (
    encomenda.vendedor_nome ||
    vendaRelacionada?.responsavel_nome ||
    vendaRelacionada?.vendedor_nome ||
    encomenda.usuario_criacao ||
    'Vendedor Desconhecido'
  );
}

function isItemEncomenda(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.is_encomenda === true) return true;
  if (item.is_encomenda === 'true') return true;
  const origem = (item.origem || '').toString().toLowerCase();
  return origem === 'encomenda';
}

function normalizeProductName(nome) {
  return (nome || '').toString().toLowerCase().trim();
}

/**
 * Página principal de Compras - VERSÃO 2
 * Hub centralizado com Dashboard + Tabela de OCs + Encomendas + Análise por Fornecedor
 */
export default function Compras() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user, can, filterData } = useAuth();
  const { settings } = useTenant();

  // Categorias financeiras para o modal de lançamento
  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias-financeiras'],
    queryFn: async () => await base44.entities.CategoriaFinanceira.list('nome') || [],
  });

  // Estado do modal de lançamento financeiro
  const [modalLancamentoOpen, setModalLancamentoOpen] = useState(false);
  const [ocParaLancamento, setOcParaLancamento] = useState(null);

  // Handler para abrir modal de lançamento financeiro
  const handleCriarLancamentoFinanceiro = (oc) => {
    setOcParaLancamento(oc);
    setModalLancamentoOpen(true);
  };

  // Verificar permissões
  const temPermissaoVisualizacao = can('view_compras') || can('manage_compras');
  const temPermissaoCriacao = can('create_oc') || can('manage_compras');
  const temPermissaoEnvio = can('send_oc') || can('manage_compras');
  const temPermissaoRecebimento = can('receive_oc') || can('manage_compras');
  const temPermissaoAprovacaoPagamento = can('approve_payment_oc');
  const temPermissaoReajusteGlobal = can('manage_bulk_price_adjustment');
  const formasAutoAprovadas = Array.isArray(settings?.compras_aprovacao_automatica)
    ? settings.compras_aprovacao_automatica
    : ['a_vista'];

  // Hook: Monitoramento de alertas de estoque (background job a cada 5 min)
  const { alertasAtivos, totalAlertas } = useAlertasEstoque(
    user?.loja_id || null,
    temPermissaoVisualizacao || can('view_produtos')
  );

  // Estado
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [vendedorFilter, setVendedorFilter] = useState('all');
  const [fornecedorFilter, setFornecedorFilter] = useState('all');
  const [ocModalOpen, setOcModalOpen] = useState(false);
  const [ocParaEditar, setOcParaEditar] = useState(null);
  const [envioModalOpen, setEnvioModalOpen] = useState(false);
  const [ocParaEnvio, setOcParaEnvio] = useState(null);
  const [recebimentoModalOpen, setRecebimentoModalOpen] = useState(false);
  const [ocParaReceber, setOcParaReceber] = useState(null);
  const [ocModalModo, setOcModalModo] = useState('novo');
  const [alertasModalOpen, setAlertasModalOpen] = useState(false);
  const [mostrarTutorial, setMostrarTutorial] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState('ordens');
  const [isVendaDetalhesOpen, setIsVendaDetalhesOpen] = useState(false);
  const [vendaSelecionada, setVendaSelecionada] = useState(null);
  const [paymentApprovalOpen, setPaymentApprovalOpen] = useState(false);
  const [ocParaAprovacaoPagamento, setOcParaAprovacaoPagamento] = useState(null);
  const [filtroAprovacaoPagamento, setFiltroAprovacaoPagamento] = useState('pendente_aprovacao');
  const [aprovacaoUltimaContagem, setAprovacaoUltimaContagem] = useState(0);
  const [ajustePrecoModalOpen, setAjustePrecoModalOpen] = useState(false);

  // Estados para Análise de Preços
  const [searchProduto, setSearchProduto] = useState('');
  const [searchFornecedorAnalise, setSearchFornecedorAnalise] = useState('');
  const [ordenacaoAnalise, setOrdenacaoAnalise] = useState('data_desc');
  const [paginaAnalisePrecos, setPaginaAnalisePrecos] = useState(1);
  const [dataInicioAnalise] = useState(
    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const itensPorPaginaAnalise = 10;

  // Query: OCs (Ordens de Compra)
  const { data: ocsRaw = [], isLoading: ocIsLoading } = useQuery({
    queryKey: ['compras'],
    queryFn: () => comprasService.listOcs('-created_at'),
    enabled: temPermissaoVisualizacao,
  });

  useEffect(() => {
    if (!temPermissaoVisualizacao) return undefined;

    const invalidateCompras = () => {
      queryClient.invalidateQueries({ queryKey: ['compras'] });
    };

    const channel = supabase
      .channel(`compras-live-${user?.id || 'anon'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'compras_ordens' },
        invalidateCompras
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'compras_oc_itens' },
        invalidateCompras
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, temPermissaoVisualizacao, user?.id]);

  // Query: Fornecedores
  const { data: fornecedores = [], isLoading: fornecedoresIsLoading } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: () => base44.entities.Fornecedor.list('nome_empresa'),
  });

  // Query: Produtos (estoque atual para previsão de ruptura)
  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-estoque-compras'],
    queryFn: () => base44.entities.Produto.list(),
    enabled: temPermissaoVisualizacao,
    staleTime: 60000,
  });

  // Query: Centros de Custo (Vendedores)
  const { data: centrosCusto = [] } = useQuery({
    queryKey: ['compras_centro_custos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('compras_centro_custos')
        .select('*')
        .eq('ativo', true);
      if (error) console.error('Erro ao buscar centros de custo:', error);
      return data || [];
    },
  });

  // Query: Encomendas (Solicitações Pendentes)
  const { data: encomendas = [] } = useQuery({
    queryKey: ['solicitacoes_encomenda'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('solicitacoes_encomenda')
        .select('*')
        .or('status.is.null,status.eq.pendente,status.eq.Pendente,status.eq.aguardando_compra,status.eq.Aguardando Compra')
        .order('created_at', { ascending: false });
      if (error) console.error('Erro ao buscar encomendas:', error);
      return data || [];
    },
  });

  // Query: Encomendas em Compra (bloqueia recomendação para reposição)
  const { data: encomendasEmCompra = [] } = useQuery({
    queryKey: ['solicitacoes_encomenda_em_compra'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('solicitacoes_encomenda')
        .select('id, produto_id, loja_id, status')
        .eq('status', 'em_compra');
      if (error) console.error('Erro ao buscar encomendas em compra:', error);
      return data || [];
    },
  });

  // Query: Vendas (para modal de detalhes)
  const { data: vendas = [] } = useQuery({
    queryKey: ['vendas'],
    queryFn: () => base44.entities.Venda.list('-data_venda'),
  });

  // Query: Solicitações de Reposição (contagem pendente para badge no tab)
  const { data: solicitacoesReposicao = [] } = useQuery({
    queryKey: ['solicitacoes-reposicao'],
    queryFn: () => base44.entities.SolicitacaoReposicao.list('-created_at'),
    enabled: temPermissaoVisualizacao,
    staleTime: 30000,
  });
  const totalReposicoesPendentes = solicitacoesReposicao.filter(s => s.status === 'Pendente').length;

  // Query: Histórico de Preços
  const { data: historicoPrecos = [] } = useQuery({
    queryKey: ['historico_precos', dataInicioAnalise],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('historico_precos')
        .select('*')
        .not('produto_id', 'is', null)
        .gte('created_at', dataInicioAnalise)
        .order('created_at', { ascending: false });
      if (error) console.error('Erro ao buscar histórico:', error);
      return data || [];
    },
  });

  // Query: Alertas de Recompra (para recomendações)
  const { data: alertasRecompra = [] } = useQuery({
    queryKey: ['alertas_recompra'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alertas_recompra')
        .select('*')
        .eq('habilitado', true)
        .order('created_at', { ascending: false });
      if (error) console.error('Erro ao buscar alertas recompra:', error);
      return data || [];
    },
  });

  // Query: Estoque por Loja (para recomendações)
  const { data: estoqueLojas = [] } = useQuery({
    queryKey: ['estoque_loja'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estoque_loja')
        .select('*');
      if (error) console.error('Erro ao buscar estoque lojas:', error);
      return data || [];
    },
  });

  // Filtrar OCs por permissões multi-loja
  const ocs = useMemo(() => {
    if (!ocsRaw) return [];
    return filterData(ocsRaw, user?.scope).map((oc) => {
      const centro = centrosCusto.find(cc => String(cc.id) === String(oc.centro_custo_id));
      return {
        ...oc,
        centro_custo_nome: centro?.nome || null,
        vendedor_nome_oc: oc.metadata?.vendedor_nome || centro?.nome || null,
      };
    });
  }, [ocsRaw, user, filterData, centrosCusto]);

  // Filtros de OCs
  const ocsFiltradas = useMemo(() => {
    let resultado = ocs;

    if (statusFilter !== 'all') {
      resultado = resultado.filter(oc => oc.status === statusFilter);
    }

    if (vendedorFilter !== 'all') {
      resultado = resultado.filter(oc => oc.centro_custo_id === vendedorFilter);
    }

    if (fornecedorFilter !== 'all') {
      resultado = resultado.filter(oc => {
        const fornecedorStr = fornecedorFilter;
        return String(oc.fornecedor_id) === fornecedorStr;
      });
    }

    if (searchTerm) {
      const termoLower = searchTerm.toLowerCase();
      resultado = resultado.filter(oc =>
        oc.numero_pedido?.toLowerCase().includes(termoLower) ||
        oc.fornecedor_nome?.toLowerCase().includes(termoLower)
      );
    }

    return resultado;
  }, [ocs, statusFilter, vendedorFilter, fornecedorFilter, searchTerm]);

  // Agregar encomendas por fornecedor
  const encomendasPorFornecedor = useMemo(() => {
    const agrupado = {};
    encomendas.forEach(enc => {
      if (!enc.fornecedor_id) {
        return;
      }

      const vendaRelacionada = vendas.find(v => String(v.id) === String(enc.venda_id));
      const vendedorNome = getEncomendaVendor(enc, vendaRelacionada);
      const centroCusto = centrosCusto.find(cc => cc.nome?.toLowerCase() === vendedorNome.toLowerCase());

      const fornecedorCadastro = fornecedores.find(f => String(f.id) === String(enc.fornecedor_id));
      const fornecedor = enc.fornecedor_nome || fornecedorCadastro?.nome_empresa;

      if (!fornecedor) {
        return;
      }

      const chave = `${enc.fornecedor_id}_${fornecedor}`;
      
      if (!agrupado[chave]) {
        agrupado[chave] = {
          fornecedor_id: enc.fornecedor_id,
          fornecedor_nome: fornecedor,
          vendedores: [],
          centro_custo_ids: [],
          itens: []
        };
      }

      if (vendedorNome && !agrupado[chave].vendedores.includes(vendedorNome)) {
        agrupado[chave].vendedores.push(vendedorNome);
      }

      if (centroCusto?.id && !agrupado[chave].centro_custo_ids.includes(centroCusto.id)) {
        agrupado[chave].centro_custo_ids.push(centroCusto.id);
      }

      agrupado[chave].itens.push({
        ...enc,
        vendedor_nome: vendedorNome,
        venda_relacionada: vendaRelacionada || null,
      });
    });
    return Object.values(agrupado).sort((a, b) => {
      return a.fornecedor_nome.localeCompare(b.fornecedor_nome);
    });
  }, [encomendas, vendas, centrosCusto, fornecedores]);

  const encomendasSemFornecedor = useMemo(() => {
    return (encomendas || []).filter(enc => !enc.fornecedor_id);
  }, [encomendas]);

  // Função para gerar OC a partir de encomendas pendentes de um fornecedor
  const handleGerarOcPorFornecedor = async (grupo) => {
    try {
      const fornecedor = fornecedores.find(f => String(f.id) === String(grupo.fornecedor_id))
        || fornecedores.find(f => f.nome_empresa === grupo.fornecedor_nome);
      if (!fornecedor) {
        toast.error(`Fornecedor não encontrado: ${grupo.fornecedor_nome}`);
        return;
      }

      const vendedoresTexto = (grupo.vendedores || []).join(', ');
      const centroCustoId = grupo.centro_custo_ids?.length === 1 ? grupo.centro_custo_ids[0] : null;

      const itens = grupo.itens.map(enc => ({
        produto_id: enc.produto_id || null,
        produto_nome: enc.produto_nome,
        quantidade_pedida: enc.quantidade || 1,
        preco_unitario: enc.preco_unitario || enc.preco || 0,
        preco_tabela: enc.preco_tabela || 0,
        descricao_personalizada: [
          `Cliente: ${enc.cliente_nome || 'Não informado'}`,
          `Pedido Venda: ${enc.numero_pedido || 'Sem número'}`,
          `Vendedor: ${enc.vendedor_nome || 'Não informado'}`,
        ].join(' | '),
      }));

      const solicitacoes_encomenda_ids = grupo.itens.map(enc => enc.id);

      await comprasService.createOc({
        fornecedor_id: fornecedor.id,
        fornecedor_nome: grupo.fornecedor_nome,
        itens,
        solicitacoes_encomenda_ids,
        centro_custo_id: centroCustoId,
        loja_id: user?.loja_id || null,
        observacoes: `OC gerada a partir de ${grupo.itens.length} encomendas pendentes${vendedoresTexto ? ` | Vendedores: ${vendedoresTexto}` : ''}`,
        metadata: {
          origem: 'encomenda_pdv',
          vendedor_nome: grupo.vendedores?.length === 1 ? grupo.vendedores[0] : null,
          vendedores_nomes: grupo.vendedores || [],
        },
      });

      toast.success(`OC gerada para ${grupo.fornecedor_nome}`);
      queryClient.invalidateQueries({ queryKey: ['compras'] });
      queryClient.invalidateQueries({ queryKey: ['solicitacoes_encomenda'] });
    } catch (error) {
      console.error('Erro ao gerar OC por fornecedor:', error);
      toast.error(`Erro ao gerar OC: ${error.message}`);
    }
  };

  // Resumo por fornecedor
  // Métricas do Dashboard
  const metricas = useMemo(() => {
    const total = ocs.length;
    const emAberto = ocs.filter(o => ['Rascunho', 'Aguardando Envio', 'Pedido Enviado', 'Parcialmente Recebido'].includes(o.status)).length;
    const recebidas = ocs.filter(o => o.status === 'Recebido').length;
    const atrasadas = ocs.filter(o => {
      if (!o.data_previsao_entrega || ['Recebido', 'Cancelada'].includes(o.status)) return false;
      const dias = Math.floor((new Date() - new Date(o.data_previsao_entrega)) / (1000 * 60 * 60 * 24));
      return dias > 7;
    }).length;
    const valorEmAberto = ocs
      .filter(o => ['Aguardando Envio', 'Pedido Enviado', 'Parcialmente Recebido'].includes(o.status))
      .reduce((sum, o) => sum + (o.valor_total || 0), 0);

    return {
      total,
      emAberto,
      recebidas,
      atrasadas,
      valorEmAberto,
      taxaCumprimento: total > 0 ? Math.round((recebidas / total) * 100) : 0,
    };
  }, [ocs]);

  // Processamento: Análise de Preços
  const produtosPedidosRecentes = useMemo(() => {
    const chavesProdutos = new Set();
    const ocsOrdenadas = [...ocs]
      .filter(oc => !oc.deleted_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    ocsOrdenadas.forEach(oc => {
      (oc.itens || []).forEach(item => {
        if (item?.produto_id) {
          chavesProdutos.add(`id:${item.produto_id}`);
          return;
        }

        const nomeNormalizado = normalizeProductName(item?.produto_nome);
        if (nomeNormalizado) {
          chavesProdutos.add(`nome:${nomeNormalizado}`);
        }
      });
    });

    return chavesProdutos;
  }, [ocs]);

  const analisePrecos = useMemo(() => {
    const historicoProdutosPedidos = historicoPrecos.filter((h) => {
      const chaveProdutoId = h?.produto_id ? `id:${h.produto_id}` : null;
      const chaveNome = `nome:${normalizeProductName(h?.produto_nome)}`;
      return (chaveProdutoId && produtosPedidosRecentes.has(chaveProdutoId)) || produtosPedidosRecentes.has(chaveNome);
    });

    const ultimosRegistrosPorProduto = new Map();
    [...historicoProdutosPedidos]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .forEach((registro) => {
        const chave = registro?.produto_id
          ? `id:${registro.produto_id}`
          : `nome:${normalizeProductName(registro?.produto_nome)}`;

        if (!chave.endsWith(':') && !ultimosRegistrosPorProduto.has(chave)) {
          ultimosRegistrosPorProduto.set(chave, registro);
        }
      });

    let resultado = Array.from(ultimosRegistrosPorProduto.values());

    if (searchProduto) {
      resultado = resultado.filter(h =>
        h.produto_nome?.toLowerCase().includes(searchProduto.toLowerCase())
      );
    }
    if (searchFornecedorAnalise) {
      resultado = resultado.filter(h =>
        h.fornecedor_nome?.toLowerCase().includes(searchFornecedorAnalise.toLowerCase())
      );
    }
    switch (ordenacaoAnalise) {
      case 'data_desc':
        resultado.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        break;
      case 'delta_asc':
        resultado.sort((a, b) => ((a.delta_percentual || 0) - (b.delta_percentual || 0)));
        break;
      case 'delta_desc':
        resultado.sort((a, b) => ((b.delta_percentual || 0) - (a.delta_percentual || 0)));
        break;
      default:
        break;
    }
    return resultado;
  }, [historicoPrecos, produtosPedidosRecentes, searchProduto, searchFornecedorAnalise, ordenacaoAnalise]);

  const totalPaginasAnalisePrecos = Math.max(1, Math.ceil(analisePrecos.length / itensPorPaginaAnalise));

  const analisePrecosPaginada = useMemo(() => {
    const inicio = (paginaAnalisePrecos - 1) * itensPorPaginaAnalise;
    return analisePrecos.slice(inicio, inicio + itensPorPaginaAnalise);
  }, [analisePrecos, paginaAnalisePrecos]);

  useEffect(() => {
    setPaginaAnalisePrecos(1);
  }, [searchProduto, searchFornecedorAnalise, ordenacaoAnalise]);

  useEffect(() => {
    if (paginaAnalisePrecos > totalPaginasAnalisePrecos) {
      setPaginaAnalisePrecos(totalPaginasAnalisePrecos);
    }
  }, [paginaAnalisePrecos, totalPaginasAnalisePrecos]);

  // Processamento: Performance de Fornecedores (mais detalhada)
  const performanceFornecedores = useMemo(() => {
    const ocsRecebidas = ocsRaw.filter(oc => oc.status === 'Recebido');
    const metricas = {};
    ocsRecebidas.forEach(oc => {
      if (!metricas[oc.fornecedor_id]) {
        metricas[oc.fornecedor_id] = {
          fornecedor_id: oc.fornecedor_id,
          fornecedor_nome: oc.fornecedor_nome,
          total_gasto: 0,
          total_ocs: 0,
          total_itens: 0,
          total_itens_pedidos: 0,
          ocsAtraso: 0,
          dias_atrasados: [],
        };
      }

      // OCs sem previsão definida não devem impactar métricas de atraso.
      const possuiPrevisaoValida = oc.data_previsao_entrega && !Number.isNaN(new Date(oc.data_previsao_entrega).getTime());
      const data_previsao = possuiPrevisaoValida ? new Date(oc.data_previsao_entrega) : null;
      const data_recebimento = oc.data_recebimento && !Number.isNaN(new Date(oc.data_recebimento).getTime())
        ? new Date(oc.data_recebimento)
        : new Date();
      const diasAtraso = data_previsao
        ? Math.floor((data_recebimento - data_previsao) / (1000 * 60 * 60 * 24))
        : 0;
      const quantidadeItensOc = (oc.itens || []).reduce((soma, item) => {
        const quantidade = Number(item?.quantidade_pedida ?? item?.quantidade ?? item?.qtd ?? 0);
        return soma + (Number.isFinite(quantidade) ? quantidade : 0);
      }, 0);

      metricas[oc.fornecedor_id].total_gasto += oc.valor_total || 0;
      metricas[oc.fornecedor_id].total_ocs += 1;
      metricas[oc.fornecedor_id].total_itens += (oc.itens?.length || 0);
      metricas[oc.fornecedor_id].total_itens_pedidos += quantidadeItensOc;
      if (diasAtraso > 0) {
        metricas[oc.fornecedor_id].ocsAtraso += 1;
        metricas[oc.fornecedor_id].dias_atrasados.push(diasAtraso);
      }
    });
    return Object.values(metricas)
      .map(m => ({
        ...m,
        taxa_atraso: m.total_ocs > 0 ? Math.round((m.ocsAtraso / m.total_ocs) * 100) : 0,
        prazo_medio_dias: m.dias_atrasados.length > 0
          ? Math.round(m.dias_atrasados.reduce((a, b) => a + b, 0) / m.dias_atrasados.length)
          : 0,
      }))
      .sort((a, b) => b.total_gasto - a.total_gasto);
  }, [ocsRaw]);

  const topFornecedoresPorVolume = useMemo(() => {
    return [...performanceFornecedores]
      .sort((a, b) => {
        if (b.total_itens_pedidos !== a.total_itens_pedidos) {
          return b.total_itens_pedidos - a.total_itens_pedidos;
        }
        return b.total_ocs - a.total_ocs;
      });
  }, [performanceFornecedores]);

  // Recomendações de Compra
  const recomendacoes = useMemo(() => {
    const lojaAtual = user?.loja_id ? String(user.loja_id) : null;

    const alertasFiltrados = (alertasRecompra || []).filter((alerta) => {
      if (!lojaAtual || !alerta?.loja_id) return true;
      return String(alerta.loja_id) === lojaAtual;
    });

    const alertasPorProduto = new Map();
    for (const alerta of alertasFiltrados) {
      const produtoId = alerta?.produto_id ? String(alerta.produto_id) : null;
      if (!produtoId) continue;

      if (!alertasPorProduto.has(produtoId)) {
        alertasPorProduto.set(produtoId, alerta);
        continue;
      }

      const alertaAtual = alertasPorProduto.get(produtoId);
      const minimoAtual = Number(alertaAtual?.estoque_minimo || 0);
      const minimoNovo = Number(alerta?.estoque_minimo || 0);
      if (minimoNovo > minimoAtual) {
        alertasPorProduto.set(produtoId, alerta);
      }
    }

    const produtosEmCompra = new Set(
      (encomendasEmCompra || [])
        .filter((enc) => {
          if (!enc?.produto_id) return false;
          if (!lojaAtual) return true;
          return !enc.loja_id || String(enc.loja_id) === lojaAtual;
        })
        .map((enc) => String(enc.produto_id))
    );

    return Array.from(alertasPorProduto.values())
      .filter((alerta) => !produtosEmCompra.has(String(alerta.produto_id)))
      .map(alerta => {
      const estoqueAtual = estoqueLojas.find(e =>
        e.produto_id === alerta.produto_id && e.loja_id === user?.loja_id
      ) || {};
      const fornecedorTop = historicoPrecos
        .filter(h => h.produto_id === alerta.produto_id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      const quantidadeAtual = estoqueAtual.quantidade || 0;
      const quantidadeSugerida = Math.max(
        alerta.estoque_minimo * 2 - quantidadeAtual,
        alerta.estoque_minimo
      );
      return {
        id: alerta.id,
        produto_id: alerta.produto_id,
        produto_nome: alerta.produto_nome,
        estoque_minimo: alerta.estoque_minimo,
        quantidade_atual: quantidadeAtual,
        quantidade_sugerida: quantidadeSugerida,
        fornecedor_id: fornecedorTop?.fornecedor_id || null,
        fornecedor_nome: fornecedorTop?.fornecedor_nome || 'Não definido',
        preco_unitario: fornecedorTop?.preco_unitario || 0,
        prazo_dias: fornecedorTop?.prazo_entrega_dias || 7,
        urgencia: quantidadeAtual < alerta.estoque_minimo ? 'alta' : 'média',
      };
    }).sort((a, b) => {
      if (a.urgencia === 'alta' && b.urgencia === 'média') return -1;
      if (a.urgencia === 'média' && b.urgencia === 'alta') return 1;
      return (b.quantidade_sugerida || 0) - (a.quantidade_sugerida || 0);
    });
  }, [alertasRecompra, estoqueLojas, historicoPrecos, user, encomendasEmCompra]);

  // Indicadores: itens com maior saída e previsão de ruptura
  const indicadoresSaidaEstoque = useMemo(() => {
    const periodoDias = 30;
    const inicioPeriodo = new Date();
    inicioPeriodo.setDate(inicioPeriodo.getDate() - periodoDias);

    const vendasValidas = (vendas || []).filter((venda) => {
      const status = (venda?.status || '').toString().toLowerCase();
      if (status === 'cancelado' || status === 'cancelada') return false;
      const dataVenda = venda?.data_venda ? new Date(venda.data_venda) : null;
      if (!dataVenda || Number.isNaN(dataVenda.getTime())) return false;
      return dataVenda >= inicioPeriodo;
    });

    const agregador = new Map();
    const nomeParaChave = new Map();

    for (const venda of vendasValidas) {
      const itensVenda = Array.isArray(venda.itens)
        ? venda.itens
        : (typeof venda.itens === 'string'
          ? (() => {
              try {
                return JSON.parse(venda.itens);
              } catch {
                return [];
              }
            })()
          : []);

      for (const item of itensVenda) {
        if (isItemEncomenda(item)) continue;

        const quantidade = Number(item?.quantidade || 0);
        if (!Number.isFinite(quantidade) || quantidade <= 0) continue;

        const produtoId = item?.produto_id ? String(item.produto_id) : null;
        const nomeNormalizado = normalizeProductName(item?.produto_nome);

        let key = produtoId ? `id:${produtoId}` : null;
        if (!key && nomeNormalizado) {
          key = nomeParaChave.get(nomeNormalizado) || `nome:${nomeNormalizado}`;
        }
        if (!key) continue;

        if (produtoId && nomeNormalizado) {
          nomeParaChave.set(nomeNormalizado, key);
        }

        if (!agregador.has(key)) {
          agregador.set(key, {
            produto_id: produtoId,
            produto_nome: item?.produto_nome || 'Produto sem nome',
            quantidadeVendida: 0,
          });
        }

        const atual = agregador.get(key);
        atual.quantidadeVendida += quantidade;
      }
    }

    const lista = Array.from(agregador.values()).map((registro) => {
      const produtoCadastro = registro.produto_id
        ? (produtos || []).find((produto) => String(produto.id) === String(registro.produto_id))
        : (produtos || []).find((produto) =>
            (produto?.nome || '').toLowerCase().trim() === (registro.produto_nome || '').toLowerCase().trim()
          );

      const estoqueAtual = Number(produtoCadastro?.quantidade_estoque || 0);
      const mediaDiaria = registro.quantidadeVendida / periodoDias;
      const diasParaZerar = mediaDiaria > 0 ? (estoqueAtual / mediaDiaria) : null;

      let nivelRuptura = 'estavel';
      if (diasParaZerar !== null && diasParaZerar <= 7) {
        nivelRuptura = 'critico';
      } else if (diasParaZerar !== null && diasParaZerar <= 15) {
        nivelRuptura = 'alerta';
      } else if (diasParaZerar !== null && diasParaZerar <= 30) {
        nivelRuptura = 'atencao';
      }

      return {
        ...registro,
        estoqueAtual,
        mediaDiaria,
        diasParaZerar,
        nivelRuptura,
      };
    });

    lista.sort((a, b) => b.quantidadeVendida - a.quantidadeVendida);

    return {
      periodoDias,
      lista,
      top10: lista.slice(0, 10),
      emRisco15Dias: lista.filter((item) => item.diasParaZerar !== null && item.diasParaZerar <= 15),
      itemMaisVendido: lista[0] || null,
    };
  }, [vendas, produtos]);

  // Mutations
  const confirmarEnvioMutation = useMutation({
    mutationFn: async (data) => {
      const { oc, trackingData } = data;
      await comprasService.updateOcStatus(oc.id, 'Pedido Enviado', trackingData);
      return true;
    },
    onSuccess: (sucesso) => {
      if (sucesso) {
        queryClient.invalidateQueries({ queryKey: ['compras'] });
        toast.success('OC enviada com sucesso');
        setEnvioModalOpen(false);
        setOcParaEnvio(null);
      }
    },
    onError: (error) => {
      toast.error(`Erro ao enviar OC: ${error.message}`);
    },
  });

  const deletarMutation = useMutation({
    mutationFn: async (oc) => {
      const confirmado = await confirm({
        title: 'Deletar OC',
        message: `Tem certeza que deseja deletar a OC ${oc.numero_pedido}?`,
        confirmText: 'Deletar',
        variant: 'destructive',
      });

      if (confirmado) {
        await comprasService.deleteOc(oc.id);
        return true;
      }
      return false;
    },
    onSuccess: (sucesso) => {
      if (sucesso) {
        queryClient.invalidateQueries({ queryKey: ['compras'] });
        toast.success('OC deletada');
      }
    },
    onError: (error) => {
      toast.error(`Erro ao deletar OC: ${error.message}`);
    },
  });

  const cancelarMutation = useMutation({
    mutationFn: async (oc) => {
      const confirmado = await confirm({
        title: 'Cancelar OC',
        message: `Tem certeza que deseja cancelar a OC ${oc.numero_pedido} (${oc.fornecedor_nome})? Esta ação não poderá ser desfeita.`,
        confirmText: 'Cancelar OC',
        variant: 'destructive',
      });

      if (confirmado) {
        await comprasService.cancelOc(oc.id, 'Cancelada pelo usuário');
        return true;
      }
      return false;
    },
    onSuccess: (sucesso) => {
      if (sucesso) {
        queryClient.invalidateQueries({ queryKey: ['compras'] });
        toast.success('OC cancelada');
      }
    },
    onError: (error) => {
      toast.error(`Erro ao cancelar OC: ${error.message}`);
    },
  });

  // Handlers
  const handleNovaOc = () => {
    setOcParaEditar(null);
    setOcModalModo('novo');
    setOcModalOpen(true);
  };

  const handleEditarOc = (oc) => {
    if (oc.duplicar) {
      setOcModalModo('duplicar');
    } else if (['Rascunho', 'Aguardando Envio', 'Pedido Enviado', 'Parcialmente Recebido'].includes(oc.status)) {
      setOcModalModo('editar');
    } else {
      setOcModalModo('ver');
    }
    setOcParaEditar(oc);
    setOcModalOpen(true);
  };

  const handleEnviarOc = (oc) => {
    if (temPermissaoEnvio) {
      setOcParaEnvio(oc);
      setEnvioModalOpen(true);
    } else {
      toast.error('Você não tem permissão para enviar OCs');
    }
  };

  const handleConfirmarEnvioOc = (oc, trackingData = {}) => {
    if (!oc) return;
    confirmarEnvioMutation.mutate({ oc, trackingData });
  };

  const handleReceberOc = (oc) => {
    if (temPermissaoRecebimento) {
      setOcParaReceber(oc);
      setRecebimentoModalOpen(true);
    } else {
      toast.error('Você não tem permissão para receber OCs');
    }
  };

  const handleDeletarOc = (oc) => {
    if (['Rascunho'].includes(oc.status)) {
      deletarMutation.mutate(oc);
    } else {
      toast.error('Só é possível deletar OCs em status Rascunho');
    }
  };

  const handleCancelarOc = (oc) => {
    cancelarMutation.mutate(oc);
  };

  const handleAbrirDetalhesVenda = (encomenda) => {
    if (!encomenda.venda_id) {
      toast.error('Esta encomenda não está vinculada a uma venda');
      return;
    }
    const venda = vendas.find(v => v.id === encomenda.venda_id);
    if (venda) {
      setVendaSelecionada(venda);
      setIsVendaDetalhesOpen(true);
    } else {
      toast.error('Venda não encontrada');
    }
  };

  const formatarMoeda = (valor) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(valor || 0);
  };

  const formatarData = (data) => {
    return new Date(data).toLocaleDateString('pt-BR');
  };

  const formatarDiasRuptura = (dias) => {
    if (dias === null || dias === undefined) return 'Sem consumo';
    if (!Number.isFinite(dias)) return 'Sem consumo';
    return `${Math.max(0, Math.round(dias))} dias`;
  };

  const handleExportarCsvGenerico = (dados, nome) => {
    if (!dados || dados.length === 0) return;
    const csv = [
      Object.keys(dados[0] || {}).join(','),
      ...dados.map(d => Object.values(d).map(v => `"${v}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nome}-${new Date().toLocaleDateString('pt-BR')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExportarCsv = () => {
    const csv = [
      ['OC', 'Fornecedor', 'Vendedor', 'Valor', 'Status', 'Data Criação', 'Previsão'].join(','),
      ...ocsFiltradas.map(oc =>
        [
          oc.numero_pedido,
          oc.fornecedor_nome,
          oc.vendedor_nome_oc || oc.centro_custo_nome || '',
          oc.valor_total,
          oc.status,
          new Date(oc.created_at).toLocaleDateString('pt-BR'),
          oc.data_previsao_entrega ? new Date(oc.data_previsao_entrega).toLocaleDateString('pt-BR') : 'Não definida',
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compras-${new Date().toLocaleDateString('pt-BR')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleCopiarListaFornecedor = async (grupo) => {
    try {
      const linhasItens = grupo.itens.map((enc, index) => {
        const cliente = enc.cliente_nome || 'Nao informado';
        const qtd = enc.quantidade || 1;
        const pedido = enc.numero_pedido || 'Sem numero';
        const produto = enc.produto_nome || 'Produto sem nome';
        return `${index + 1}. ${produto} | Qtd: ${qtd} | Cliente: ${cliente} | Pedido: ${pedido}`;
      });

      const texto = [
        `Lista de Encomendas para Compra`,
        `Fornecedor: ${grupo.fornecedor_nome || 'Nao informado'}`,
        `Vendedor: ${grupo.vendedor_nome || 'Nao informado'}`,
        `Total de itens: ${grupo.itens.length}`,
        '',
        ...linhasItens,
      ].join('\n');

      await navigator.clipboard.writeText(texto);
      toast.success(`Lista copiada para ${grupo.fornecedor_nome}`);
    } catch (error) {
      console.error('Erro ao copiar lista de encomendas:', error);
      toast.error('Nao foi possivel copiar a lista');
    }
  };

  if (!temPermissaoVisualizacao) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Você não tem permissão para acessar este módulo</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-end items-center mb-2">
        <div className="flex gap-2">
          {temPermissaoReajusteGlobal && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAjustePrecoModalOpen(true)}
              className="gap-2"
            >
              <DollarSign className="w-4 h-4" />
              Reajuste Global
            </Button>
          )}
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setMostrarTutorial(!mostrarTutorial)}
            className="gap-2"
          >
            <HelpCircle className="w-4 h-4" />
            {mostrarTutorial ? 'Fechar' : 'Ajuda'}
          </Button>
          {temPermissaoCriacao && (
            <Button onClick={handleNovaOc} className="gap-2">
              <Plus className="w-4 h-4" />
              Nova OC
            </Button>
          )}
        </div>
      </div>

      {/* Painel de Orientação/Tutorial */}
      {mostrarTutorial && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-blue-600" />
              Como usar o sistema de Compras
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3 bg-white rounded-lg border border-blue-100">
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingCart className="w-5 h-5 text-blue-600" />
                  <h3 className="font-semibold text-sm">1. Criar Encomenda</h3>
                </div>
                <p className="text-xs text-gray-600">Vendedores criam encomendas no PDV quando há demanda. Aparecem na aba &quot;Encomendas&quot;.</p>
              </div>

              <div className="p-3 bg-white rounded-lg border border-blue-100">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-5 h-5 text-amber-600" />
                  <h3 className="font-semibold text-sm">2. Criar OC</h3>
                </div>
                <p className="text-xs text-gray-600">Clique &quot;Nova OC&quot;, selecione fornecedor e produtos. Status inicia como &quot;Rascunho&quot;.</p>
              </div>

              <div className="p-3 bg-white rounded-lg border border-blue-100">
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="w-5 h-5 text-green-600" />
                  <h3 className="font-semibold text-sm">3. Enviar e Receber</h3>
                </div>
                <p className="text-xs text-gray-600">Enviar → Receber → Estoque auto-incrementa → Financeiro integrado!</p>
              </div>

              <div className="p-3 bg-white rounded-lg border border-blue-100">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-semibold text-sm">4. Análise de Preços</h3>
                </div>
                <p className="text-xs text-gray-600">Acompanhe oscilações de preços por produto e fornecedor na aba &quot;Preços&quot;.</p>
              </div>

              <div className="p-3 bg-white rounded-lg border border-blue-100">
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="w-5 h-5 text-purple-600" />
                  <h3 className="font-semibold text-sm">5. Performance</h3>
                </div>
                <p className="text-xs text-gray-600">Avalie quais fornecedores entregam no prazo e onde você mais investe.</p>
              </div>

              <div className="p-3 bg-white rounded-lg border border-blue-100">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <h3 className="font-semibold text-sm">6. Recomendações</h3>
                </div>
                <p className="text-xs text-gray-600">O sistema sugere o que comprar baseado no seu estoque mínimo configurado.</p>
              </div>
            </div>

            <div className="pt-3 border-t border-blue-100 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start gap-2 text-xs text-gray-700">
                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span><strong>Automação:</strong> Recebimento incrementa estoque e cria lançamento financeiro automaticamente.</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-gray-700">
                <TrendingUp className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                <span><strong>Inteligência:</strong> O histórico de preços ajuda a negociar melhor com base em dados reais.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <AjustePrecoModal
        isOpen={ajustePrecoModalOpen}
        onClose={() => setAjustePrecoModalOpen(false)}
        produtos={produtos}
      />

      {/* Dashboard - Métricas */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-600">Total de OCs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metricas.total}</div>
            <p className="text-xs text-gray-500 mt-1">{metricas.emAberto} em aberto</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-600 flex items-center gap-1">
              <TrendingUp className="w-4 h-4" /> Valor em Aberto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold font-mono">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(metricas.valorEmAberto)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-600 flex items-center gap-1">
              <Package className="w-4 h-4" /> Recebidas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metricas.recebidas}</div>
            <p className="text-xs text-gray-500 mt-1">{metricas.taxaCumprimento}%</p>
          </CardContent>
        </Card>

        <Card className={metricas.atrasadas > 0 ? 'border-red-200 bg-red-50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-xs font-medium flex items-center gap-1 ${metricas.atrasadas > 0 ? 'text-red-600' : 'text-gray-600'}`}>
              <AlertTriangle className="w-4 h-4" /> Atrasadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${metricas.atrasadas > 0 ? 'text-red-600' : ''}`}>{metricas.atrasadas}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-600">Fornecedores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fornecedoresIsLoading ? '...' : fornecedores.filter(f => f.ativo !== false).length}
            </div>
            <p className="text-xs text-gray-500 mt-1">{new Set(ocs.filter(o => o.status !== 'Recebido' && o.status !== 'Cancelada').map(o => o.fornecedor_id).filter(Boolean)).size} com OCs ativas</p>
          </CardContent>
        </Card>

        <Card className={totalAlertas > 0 ? 'border-amber-200 bg-amber-50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-xs font-medium flex items-center gap-1 ${totalAlertas > 0 ? 'text-amber-600' : 'text-gray-600'}`}>
              <AlertTriangle className="w-4 h-4" /> Reabastecer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalAlertas > 0 ? 'text-amber-600' : ''}`}>{totalAlertas}</div>
            {totalAlertas > 0 && <Button size="sm" variant="ghost" onClick={() => setAlertasModalOpen(true)} className="mt-1 h-6 px-2">Ver</Button>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-gray-600 flex items-center gap-1">
              <TrendingUp className="w-4 h-4" /> Mais vendido (30 dias)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {indicadoresSaidaEstoque.itemMaisVendido ? (
              <>
                <div className="text-sm font-semibold truncate" title={indicadoresSaidaEstoque.itemMaisVendido.produto_nome}>
                  {indicadoresSaidaEstoque.itemMaisVendido.produto_nome}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Saída: {Math.round(indicadoresSaidaEstoque.itemMaisVendido.quantidadeVendida)} un | Estoque atual: {indicadoresSaidaEstoque.itemMaisVendido.estoqueAtual}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500">Sem dados de vendas recentes</p>
            )}
          </CardContent>
        </Card>

        <Card className={indicadoresSaidaEstoque.emRisco15Dias.length > 0 ? 'border-red-200 bg-red-50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-xs font-medium flex items-center gap-1 ${indicadoresSaidaEstoque.emRisco15Dias.length > 0 ? 'text-red-600' : 'text-gray-600'}`}>
              <AlertTriangle className="w-4 h-4" /> Ruptura prevista (&lt;= 15 dias)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${indicadoresSaidaEstoque.emRisco15Dias.length > 0 ? 'text-red-600' : ''}`}>
              {indicadoresSaidaEstoque.emRisco15Dias.length}
            </div>
            <p className="text-xs text-gray-500 mt-1">Com base na saída média dos últimos {indicadoresSaidaEstoque.periodoDias} dias</p>
          </CardContent>
        </Card>
      </div>

      {/* Modal de Alertas */}
      {alertasModalOpen && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Produtos para Reabastecer</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setAlertasModalOpen(false)}>✕</Button>
            </div>
          </CardHeader>
          <CardContent>
            {alertasAtivos.length > 0 ? (
              <div className="space-y-2">
                {alertasAtivos.map((alerta) => (
                  <div key={alerta.id} className="p-3 border rounded-lg bg-amber-50">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">{alerta.produto_nome}</p>
                        {alerta.quantidade_atual !== undefined && alerta.estoque_minimo !== undefined && (
                          <p className="text-xs text-gray-600 mt-1">Estoque: {alerta.quantidade_atual} | Mínimo: {alerta.estoque_minimo}</p>
                        )}
                      </div>
                      <Button size="sm" onClick={() => { setAlertasModalOpen(false); handleNovaOc(); }}>Nova OC</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">Nenhum produto para reabastecer</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Abas: Ordens | Encomendas | Reposições | Preços | Performance | Recomendações */}
      <Tabs value={abaAtiva} onValueChange={(val) => {
        setAbaAtiva(val);
        if (val === 'aprovacao-pagamento') {
          setAprovacaoUltimaContagem(ocs.filter(o => o.pagamento_status === 'pendente_aprovacao').length);
        }
      }} className="w-full">
        <TabsList className={`grid w-full ${temPermissaoAprovacaoPagamento ? 'grid-cols-7' : 'grid-cols-6'}`}>
          <TabsTrigger value="ordens" className="gap-2">
            <Package className="w-4 h-4" /> Ordens ({ocsFiltradas.length})
          </TabsTrigger>
          <TabsTrigger value="encomendas" className="gap-2">
            <ShoppingCart className="w-4 h-4" /> Encomendas ({encomendas.length})
          </TabsTrigger>
          <TabsTrigger value="reposicoes" className="gap-1">
            <Wrench className="w-4 h-4" /> Reposições{totalReposicoesPendentes > 0 && (
              <span className="ml-1 bg-orange-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                {totalReposicoesPendentes}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="precos" className="gap-2">
            <DollarSign className="w-4 h-4" /> Preços
          </TabsTrigger>
          <TabsTrigger value="performance" className="gap-2">
            <TrendingUp className="w-4 h-4" /> Performance
          </TabsTrigger>
          <TabsTrigger value="recomendacoes" className="gap-2">
            <AlertTriangle className="w-4 h-4" /> Recomendações
          </TabsTrigger>
          {temPermissaoAprovacaoPagamento && (() => {
              const pendentes = ocs.filter(o => o.pagamento_status === 'pendente_aprovacao').length;
              const naoLidas = abaAtiva !== 'aprovacao-pagamento' && pendentes > 0;
              return (
                <TabsTrigger value="aprovacao-pagamento" className="gap-2 text-amber-700 data-[state=active]:bg-amber-50 relative">
                  <DollarSign className="w-4 h-4" /> Aprovação
                  {pendentes > 0 && (
                    <span className="relative flex h-4 w-4 ml-0.5">
                      {naoLidas && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />}
                      <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-red-500 text-white text-[9px] font-bold">{pendentes}</span>
                    </span>
                  )}
                </TabsTrigger>
              );
            })()}
        </TabsList>

        {/* TAB 1: Ordens de Compra */}
        <TabsContent value="ordens" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="space-y-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input placeholder="Buscar por número OC, fornecedor..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                      <Filter className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os Status</SelectItem>
                      <SelectItem value="Rascunho">Rascunho</SelectItem>
                      <SelectItem value="Aguardando Envio">Aguardando Envio</SelectItem>
                      <SelectItem value="Pedido Enviado">Pedido Enviado</SelectItem>
                      <SelectItem value="Recebido">Recebido</SelectItem>
                      <SelectItem value="Cancelada">Cancelada</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={fornecedorFilter} onValueChange={setFornecedorFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Fornecedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os Fornecedores</SelectItem>
                      {fornecedores.map(f => (
                        <SelectItem key={f.id} value={f.id?.toString()}>{f.nome_empresa}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={vendedorFilter} onValueChange={setVendedorFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Vendedor/Centro" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os Vendedores</SelectItem>
                      {centrosCusto.map(cc => (
                        <SelectItem key={cc.id} value={cc.id}>{cc.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button variant="outline" size="sm" onClick={handleExportarCsv} className="gap-2 ml-auto">
                    <Download className="w-4 h-4" /> CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ordens de Compra <Badge variant="outline" className="ml-2">{ocsFiltradas.length} encontradas</Badge></CardTitle>
            </CardHeader>
            <CardContent>
          <OcTable ocs={ocsFiltradas} isLoading={ocIsLoading} onEdit={handleEditarOc} onDelete={handleDeletarOc} onReceive={handleReceberOc} onSend={handleEnviarOc} onCancel={handleCancelarOc}
              formasAutoAprovadas={formasAutoAprovadas}
              onCriarLancamentoFinanceiro={handleCriarLancamentoFinanceiro}
              onSubmitPaymentApproval={(oc) => {
                if (formasAutoAprovadas.includes(oc.forma_pagamento_oc)) {
                  toast.info('Esta forma de pagamento está configurada para aprovação automática');
                  return;
                }
                if (window.confirm(`Enviar OC ${oc.numero_pedido} para aprovação de pagamento do master?`)) {
                  comprasService.submitForPaymentApproval(oc.id, {
                    observacoes_aprovacao: oc.observacoes_aprovacao,
                    anexos_aprovacao: oc.anexos_aprovacao,
                  }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['compras'] });
                    toast.success(`OC ${oc.numero_pedido} enviada para aprovação de pagamento`);
                  }).catch((err) => toast.error(err.message));
                }
              }}
            />
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: Encomendas */}
        <TabsContent value="encomendas" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> Encomendas Pendentes por Fornecedor</CardTitle>
            </CardHeader>
            <CardContent>
              {encomendasSemFornecedor.length > 0 && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {encomendasSemFornecedor.length} encomenda(s) sem fornecedor selecionado foram bloqueadas e não aparecem para geração de OC.
                </div>
              )}

              {encomendas.length > 0 ? (
                <div className="space-y-3">
                  {encomendasPorFornecedor.map((grupo) => (
                    <div key={grupo.fornecedor_id || grupo.fornecedor_nome} className="p-3 border rounded-lg bg-blue-50">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="font-semibold text-sm text-blue-900">{grupo.fornecedor_nome}</h4>
                          <p className="text-xs text-blue-700">
                            {grupo.vendedores?.length > 0
                              ? `Vendedores: ${grupo.vendedores.join(', ')}`
                              : 'Vendedores não informados'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleCopiarListaFornecedor(grupo)}
                            className="gap-1"
                          >
                            <Copy className="w-3 h-3" /> Copiar Lista
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleGerarOcPorFornecedor(grupo)}
                            className="gap-1"
                          >
                            Gerar OC
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {grupo.itens.map(enc => (
                          <Button
                            key={enc.id}
                            variant="ghost"
                            onClick={() => handleAbrirDetalhesVenda(enc)}
                            className="w-full flex items-center justify-between text-sm p-2 bg-white rounded hover:bg-blue-100"
                          >
                            <div className="text-left">
                              <p className="font-medium">{enc.produto_nome}</p>
                              <p className="text-xs text-gray-500">{enc.vendedor_nome} | Cliente: {enc.cliente_nome} | Qtd: {enc.quantidade}</p>
                            </div>
                            <Badge variant="outline">{enc.status}</Badge>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500">Nenhuma encomenda pendente</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: Histórico de Preços */}
        <TabsContent value="precos" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-4">
                <CardTitle>Histórico de Preços</CardTitle>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <Input placeholder="Buscar produto..." value={searchProduto} onChange={(e) => setSearchProduto(e.target.value)} className="pl-10" />
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <Input placeholder="Buscar fornecedor..." value={searchFornecedorAnalise} onChange={(e) => setSearchFornecedorAnalise(e.target.value)} className="pl-10" />
                  </div>
                  <Select value={ordenacaoAnalise} onValueChange={setOrdenacaoAnalise}>
                    <SelectTrigger>
                      <SelectValue placeholder="Ordenar por..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="data_desc">Data (Recente)</SelectItem>
                      <SelectItem value="delta_asc">Delta % (Menor)</SelectItem>
                      <SelectItem value="delta_desc">Delta % (Maior)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => handleExportarCsvGenerico(analisePrecos, 'historico-precos')} className="gap-2">
                    <Download className="w-4 h-4" /> Export CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead>Produto</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead className="text-right">Preço Anterior</TableHead>
                      <TableHead className="text-right">Preço Novo</TableHead>
                      <TableHead className="text-right">Delta %</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analisePrecos.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan="6" className="text-center text-gray-500 py-4">Nenhum histórico de preços encontrado</TableCell>
                      </TableRow>
                    ) : (
                      analisePrecosPaginada.map((hp, idx) => {
                        const delta = hp.delta_percentual || 0;
                        const isAumento = delta > 0;
                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium text-sm">{hp.produto_nome}</TableCell>
                            <TableCell className="text-sm">{hp.fornecedor_nome}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{formatarMoeda(hp.preco_anterior)}</TableCell>
                            <TableCell className="text-right font-mono text-sm font-semibold">{formatarMoeda(hp.preco_novo)}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={isAumento ? 'destructive' : 'secondary'} className="font-mono">{isAumento ? '+' : ''}{delta.toFixed(1)}%</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-gray-600">{formatarData(hp.created_at)}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {analisePrecos.length > 0 && (
                <div className="flex items-center justify-between mt-4 gap-3">
                  <p className="text-sm text-gray-600">
                    Exibindo {analisePrecosPaginada.length} de {analisePrecos.length} produtos
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPaginaAnalisePrecos((prev) => Math.max(1, prev - 1))}
                      disabled={paginaAnalisePrecos === 1}
                    >
                      Anterior
                    </Button>
                    <span className="text-sm text-gray-700 min-w-[90px] text-center">
                      Página {paginaAnalisePrecos} de {totalPaginasAnalisePrecos}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPaginaAnalisePrecos((prev) => Math.min(totalPaginasAnalisePrecos, prev + 1))}
                      disabled={paginaAnalisePrecos >= totalPaginasAnalisePrecos}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: Performance */}
        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Fornecedores por Volume</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topFornecedoresPorVolume.slice(0, 5).map((f, idx) => (
                    <div key={f.fornecedor_id} className="p-3 border rounded-lg hover:bg-gray-50">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{idx + 1}°</Badge>
                          <span className="font-medium text-sm">{f.fornecedor_nome}</span>
                        </div>
                        <span className="font-mono font-bold text-sm">{formatarMoeda(f.total_gasto)}</span>
                      </div>
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span>{f.total_itens_pedidos} itens</span>
                        <span>{f.total_ocs} OCs</span>
                        <span className={f.taxa_atraso > 20 ? 'text-red-500 font-bold' : ''}>{f.taxa_atraso}% atraso</span>
                        <span>Prazo: {f.prazo_medio_dias}d</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Radar de Atrasos</CardTitle>
              </CardHeader>
              <CardContent>
                {performanceFornecedores.filter(f => f.taxa_atraso > 0).length > 0 ? (
                  <div className="space-y-3">
                    {performanceFornecedores
                      .filter(f => f.taxa_atraso > 0)
                      .sort((a,b) => b.taxa_atraso - a.taxa_atraso)
                      .slice(0, 5)
                      .map((f) => (
                        <div key={f.fornecedor_id} className="p-3 border border-red-100 bg-red-50 rounded-lg">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-sm text-red-900">{f.fornecedor_nome}</span>
                            <Badge variant="destructive">{f.taxa_atraso}%</Badge>
                          </div>
                          <p className="text-xs text-red-700 mt-1">{f.prazo_medio_dias} dias de atraso médio em {f.ocsAtraso} pedidos</p>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm">Nenhum atraso registrado</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 5: Recomendações */}
        <TabsContent value="recomendacoes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Itens Mais Vendidos e Previsão de Ruptura</CardTitle>
              <p className="text-xs text-gray-500">Saída média diária e tempo estimado para zerar estoque com base nos últimos {indicadoresSaidaEstoque.periodoDias} dias</p>
            </CardHeader>
            <CardContent>
              {indicadoresSaidaEstoque.top10.length > 0 ? (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Saída (30d)</TableHead>
                        <TableHead className="text-right">Média/Dia</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                        <TableHead className="text-right">Previsão de Zeragem</TableHead>
                        <TableHead className="text-center">Nível</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {indicadoresSaidaEstoque.top10.map((item) => (
                        <TableRow key={`${item.produto_id || item.produto_nome}`}>
                          <TableCell className="font-medium text-sm">{item.produto_nome}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{Math.round(item.quantidadeVendida)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{item.mediaDiaria.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{item.estoqueAtual}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatarDiasRuptura(item.diasParaZerar)}</TableCell>
                          <TableCell className="text-center">
                            {item.nivelRuptura === 'critico' && <Badge className="bg-red-600">Crítico</Badge>}
                            {item.nivelRuptura === 'alerta' && <Badge className="bg-orange-600">Alerta</Badge>}
                            {item.nivelRuptura === 'atencao' && <Badge className="bg-yellow-600">Atenção</Badge>}
                            {item.nivelRuptura === 'estavel' && <Badge variant="outline">Estável</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500">Sem dados de saída suficientes para projeção</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Produtos para Reabastecer</CardTitle>
                  <p className="text-xs text-gray-500 mt-1">{recomendacoes.length} produtos baseados no estoque mínimo</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleExportarCsvGenerico(recomendacoes, 'recomendacoes')} className="gap-2">
                  <Download className="w-4 h-4" /> Exportar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recomendacoes.length > 0 ? (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                        <TableHead className="text-right">Mínimo</TableHead>
                        <TableHead className="text-right">Sugerido</TableHead>
                        <TableHead>Fornecedor Principal</TableHead>
                        <TableHead className="text-right">Preço Est.</TableHead>
                        <TableHead className="text-center">Urgência</TableHead>
                        <TableHead className="text-right">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recomendacoes.map((rec) => (
                        <TableRow key={rec.id}>
                          <TableCell className="font-medium text-sm">{rec.produto_nome}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{rec.quantidade_atual}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{rec.estoque_minimo}</TableCell>
                          <TableCell className="text-right font-mono font-bold text-blue-600">{rec.quantidade_sugerida}</TableCell>
                          <TableCell className="text-sm">{rec.fornecedor_nome}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatarMoeda(rec.preco_unitario)}</TableCell>
                          <TableCell className="text-center">
                            <Badge className={rec.urgencia === 'alta' ? 'bg-red-500' : 'bg-yellow-500'}>{rec.urgencia.toUpperCase()}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="xs" onClick={() => { setAbaAtiva('ordens'); handleNovaOc(); }}>Pedir</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                  <p className="text-gray-600">Todos os produtos estão com estoque em dia!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Reposições de Assistência */}
        <TabsContent value="reposicoes" className="space-y-4">
          <SolicitacoesReposicaoTab />
        </TabsContent>

        {/* TAB: Aprovação de Pagamento (apenas master) */}
        {temPermissaoAprovacaoPagamento && (
          <TabsContent value="aprovacao-pagamento" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <DollarSign className="w-5 h-5 text-amber-600" />
                      Aprovação de Pagamento
                    </CardTitle>
                    <p className="text-xs text-gray-500 mt-1">Pedidos de compra aguardando confirmação de pagamento</p>
                  </div>
                  <Select value={filtroAprovacaoPagamento} onValueChange={setFiltroAprovacaoPagamento}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendente_aprovacao">Aguardando Aprovação</SelectItem>
                      <SelectItem value="pago">Pagas</SelectItem>
                      <SelectItem value="todos">Todos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  const ocsPagamento = ocs.filter(o => {
                    if (filtroAprovacaoPagamento === 'todos') return o.pagamento_status && o.pagamento_status !== 'nao_aplicavel';
                    return o.pagamento_status === filtroAprovacaoPagamento;
                  });

                  if (ocsPagamento.length === 0) {
                    return (
                      <div className="text-center py-12">
                        <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
                        <p className="text-gray-500">
                          {filtroAprovacaoPagamento === 'pendente_aprovacao'
                            ? 'Nenhum pedido aguardando aprovação de pagamento'
                            : 'Nenhum resultado encontrado'}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-50">
                            <TableHead>OC</TableHead>
                            <TableHead>Fornecedor</TableHead>
                            <TableHead className="text-right">Valor</TableHead>
                            <TableHead>Forma Solicitada</TableHead>
                            <TableHead>Status OC</TableHead>
                            <TableHead>Status Pagamento</TableHead>
                            <TableHead>Data</TableHead>
                            <TableHead className="text-center">Ação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ocsPagamento.map(oc => {
                            const FORMAS = {
                              'a_vista': 'A Vista', 'pix': 'PIX', 'boleto': 'Boleto',
                              'parcelado': 'Parcelado', 'cartao_debito': 'Cartão Débito',
                              'cartao_credito': 'Cartão Crédito', 'transferencia': 'Transferência',
                              'cheque': 'Cheque', 'a_definir': 'A Definir',
                            };
                            return (
                              <TableRow key={oc.id}>
                                <TableCell className="font-mono font-semibold text-sm">{oc.numero_pedido}</TableCell>
                                <TableCell className="text-sm">{oc.fornecedor_nome}</TableCell>
                                <TableCell className="text-right font-mono text-sm font-bold">
                                  R$ {(oc.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-sm">{FORMAS[oc.forma_pagamento_oc] || oc.forma_pagamento_oc || '-'}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">{oc.status}</Badge>
                                </TableCell>
                                <TableCell>
                                  {oc.pagamento_status === 'pendente_aprovacao' && (
                                    <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700 border border-yellow-300">
                                      Aguard. Aprovação
                                    </span>
                                  )}
                                  {oc.pagamento_status === 'pago' && (
                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 border border-green-300">
                                      <CheckCircle className="w-3 h-3" /> Pago
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-gray-500">
                                  {oc.created_at ? new Date(oc.created_at).toLocaleDateString('pt-BR') : '-'}
                                </TableCell>
                                <TableCell className="text-center">
                                  {oc.pagamento_status === 'pendente_aprovacao' ? (
                                    <Button
                                      size="sm"
                                      className="bg-green-600 hover:bg-green-700 gap-1 text-xs"
                                      onClick={() => {
                                        setOcParaAprovacaoPagamento(oc);
                                        setPaymentApprovalOpen(true);
                                      }}
                                    >
                                      <DollarSign className="w-3 h-3" /> Aprovar Pagamento
                                    </Button>
                                  ) : (
                                    <span className="text-xs text-gray-400">
                                      {oc.pagamento_aprovado_em
                                        ? new Date(oc.pagamento_aprovado_em).toLocaleDateString('pt-BR')
                                        : 'Pago'}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Modais */}
      <OcModal
        isOpen={ocModalOpen}
        onClose={() => {
          setOcModalOpen(false);
          setOcParaEditar(null);
        }}
        oc={ocParaEditar}
        modo={ocModalModo}
        onEnviar={handleEnviarOc}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['compras'] });
        }}
      />

      <EnviarOcModal
        open={envioModalOpen}
        onClose={() => {
          setEnvioModalOpen(false);
          setOcParaEnvio(null);
        }}
        oc={ocParaEnvio}
        onConfirmarEnvio={handleConfirmarEnvioOc}
        isConfirmando={confirmarEnvioMutation.isPending}
      />

      <RecebimentoModal
        isOpen={recebimentoModalOpen}
        onClose={() => {
          setRecebimentoModalOpen(false);
          setOcParaReceber(null);
        }}
        oc={ocParaReceber}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['compras'] });
        }}
      />

      <VendaDetalhesModal
        isOpen={isVendaDetalhesOpen}
        onClose={() => {
          setIsVendaDetalhesOpen(false);
          setVendaSelecionada(null);
        }}
        venda={vendaSelecionada}
      />

      <PaymentApprovalModal
        isOpen={paymentApprovalOpen}
        onClose={() => {
          setPaymentApprovalOpen(false);
          setOcParaAprovacaoPagamento(null);
        }}
        oc={ocParaAprovacaoPagamento}
      />

      <CriarLancamentoFromOcModal
        oc={ocParaLancamento}
        open={modalLancamentoOpen}
        onClose={() => {
          setModalLancamentoOpen(false);
          setOcParaLancamento(null);
        }}
        categorias={categorias}
      />
    </div>
  );
}
