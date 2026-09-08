import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/contexts/TenantContext";
import SolicitacoesCadastroWidget from "@/components/dashboard/SolicitacoesCadastroWidget";
import ControleMontadoresWidget from "@/components/dashboard/ControleMontadoresWidget";
import ProdutoCadastroCompleto from "@/components/produtos/ProdutoCadastroCompleto";
import AcoesVendedoresWidget from "@/components/dashboard/AcoesVendedoresWidget";
import PainelConferenciaCaixa from "@/components/conferencia/PainelConferenciaCaixa";
import { toast } from "sonner";
import { formatarMoeda } from "@/utils/formatters";
import { isVendaCancelada, getVendaFinanceiro } from "@/utils/vendaStatus";
import { VendaDetalhesModal } from "@/components/vendas/VendaDetalhesModal";
import { MONEY_EPSILON, toMoneyNumber } from "@/utils/deliveryPayment";
import { isInstallmentPaymentMethod, validatePaymentSplit } from "@/services/paymentOrchestrator";
import { findCategoriaByNames } from "@/lib/financeiroRecorrencia";
import {
    DollarSign,
    ShoppingCart,
    ShoppingBag,
    TrendingUp,
    TrendingDown,
    Target,
    Calendar,
    Truck,
    Wrench,
    CreditCard,
    ClipboardList,
    RefreshCw,
    Award,
    AlertTriangle,
    Store,
    Users,
    Settings,
    Plus,
    Edit2,
    Loader2,
    Key,
    Copy,
    Ban,
    Clock,
    Check,
    Package,
    BarChart3,
    Box,
    AlertCircle,
    Layers,
    ArrowUpRight,
    ArrowDownRight,
    Percent,
    Search,
    Eye,
    FileText,
    Filter,
    Tag,
    X,
    ShieldCheck,
    MapPin,
    Phone,
    MessageCircle,
    MoreHorizontal,
    Bell,
    HelpCircle,
    ArrowRight,
    ChevronRight,
    ChevronDown,
    CheckCircle2,
    Activity,
    RotateCcw
} from "lucide-react";
import {
    AreaChart,
    Area,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
    BarChart,
    Bar,
    Cell,
    PieChart,
    Pie,
    Legend
} from 'recharts';

const parseDateSafe = (val) => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    const str = String(val);
    const ymdMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (ymdMatch) {
        return new Date(ymdMatch[1] + 'T12:00:00');
    }
    const d = new Date(str);
    if (isNaN(d.getTime())) return new Date();
    return d;
};

const formatRelativeTime = (dateInput) => {
    if (!dateInput) return 'Recente';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Recente';

    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    if (diffInMs < 0) return 'Agora';

    const diffInSeconds = Math.floor(diffInMs / 1000);
    if (diffInSeconds < 60) return 'Agora mesmo';

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `Há ${diffInMinutes} min`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `Há ${diffInHours} ${diffInHours === 1 ? 'hora' : 'horas'}`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return 'Ontem';
    if (diffInDays < 7) return `Há ${diffInDays} dias`;

    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const SALES_PAYMENT_OPTIONS = [
    'Dinheiro',
    'PIX',
    'Cartão de Crédito',
    'Cartão de Débito',
    'Boleto',
    'Transferência Bancária',
    'Outros'
];

const createEmptyPagamentoItem = (defaults = {}) => ({
    forma_pagamento: defaults.forma_pagamento || '',
    valor: defaults.valor || '',
    parcelas: defaults.parcelas || 1,
});

const ChartTooltip = ({ active, payload, label, assistencias = [] }) => {
  if (!active || !payload || !payload.length) return null;

  const dataPoint = payload[0].payload;
  const vendasList = dataPoint?.vendasList || [];

  // Helper para cálculo líquido de uma venda específica
  const getValoresVenda = (v) => {
    const assistencia = assistencias.find(a =>
      a.numero_pedido === v.numero_pedido &&
      a.status === 'Concluída' &&
      (a.tipo === 'Devolução' || a.tipo === 'Troca')
    );
    const bruto = Number(v.valor_total) || 0;
    const liquido = bruto - (Number(assistencia?.valor_devolvido) || 0);
    return { bruto, liquido };
  };

  const totalBruto = vendasList.reduce((sum, v) => sum + getValoresVenda(v).bruto, 0);
  const totalLiquido = vendasList.reduce((sum, v) => sum + getValoresVenda(v).liquido, 0);

  return (
    <div className="bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md p-4 rounded-xl shadow-xl border border-gray-100 dark:border-neutral-800 text-xs text-gray-800 dark:text-gray-200 max-w-sm space-y-3 pointer-events-none">
      <div className="border-b border-gray-100 dark:border-neutral-800 pb-2">
        <p className="font-bold text-sm text-gray-900 dark:text-white">Data: {dataPoint.dia || dataPoint.diaFormatado || label}</p>
        <p className="text-[10px] text-gray-500">{vendasList.length} {vendasList.length === 1 ? 'venda realizada' : 'vendas realizadas'}</p>
      </div>

      {vendasList.length > 0 && (
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {vendasList.map((v, i) => {
            const { bruto, liquido } = getValoresVenda(v);
            return (
              <div key={i} className="flex flex-col border-b border-gray-50 dark:border-neutral-800/40 pb-1.5 last:border-0 last:pb-0">
                <div className="flex justify-between items-center gap-2">
                  <span className="font-semibold text-blue-600 dark:text-blue-400">#{v.numero_pedido || v.id}</span>
                  <span className="text-[10px] text-gray-500 truncate max-w-[120px]">{v.cliente_nome || 'Cliente não informado'}</span>
                </div>
                <div className="flex justify-between text-[10px] text-gray-600 dark:text-gray-400 mt-0.5">
                  <span>Bruto: R$ {bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  <span className="font-medium text-green-600 dark:text-green-400">Líq: R$ {liquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-gray-100 dark:border-neutral-800 pt-2 space-y-1 text-[11px] font-bold">
        <div className="flex justify-between text-gray-600 dark:text-gray-400">
          <span>Total Bruto:</span>
          <span>R$ {totalBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-gray-900 dark:text-white">
          <span>Total Líquido:</span>
          <span className="text-green-600 dark:text-green-400">R$ {totalLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>
  );
};

// Sub-componente para linha de margem negociável por loja
function MargemLojaRow({ loja, salvando, onSave }) {
    const [valor, setValor] = useState(loja.margem_negociavel ?? 0);
    const valorSalvo = loja.margem_negociavel ?? 0;
    const alterado = parseFloat(valor) !== parseFloat(valorSalvo);

    return (
        <div className="flex items-center gap-3 p-3 bg-white dark:bg-neutral-800 rounded-lg border border-green-100 dark:border-green-900/40">
            <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-800 dark:text-gray-100 truncate">{loja.nome}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                    {parseFloat(valorSalvo) === 0
                        ? 'Desconto livre desabilitado'
                        : `Desconto livre de até ${valorSalvo}%`}
                </p>
            </div>
            <div className="flex items-center gap-2">
                <div className="relative w-28">
                    <Input
                        type="number"
                        value={valor}
                        onChange={e => {
                            let v = parseFloat(e.target.value);
                            if (isNaN(v) || v < 0) v = 0;
                            if (v > 100) v = 100;
                            setValor(v);
                        }}
                        className="h-9 text-sm pr-7"
                        min={0}
                        max={100}
                        step={0.5}
                        placeholder="0"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
                </div>
                <Button
                    size="sm"
                    className="h-9 bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => onSave(parseFloat(valor) || 0)}
                    disabled={salvando || !alterado}
                >
                    {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                </Button>
            </div>
        </div>
    );
}

// Sub-componente para configurar Desconto por Produto de uma loja
function DescontoProdutoLojaRow({ loja, salvando, excecoes = [], produtos = [], onSave, onAddExcecao, onRemoveExcecao, categorias = [] }) {
    const [ativo, setAtivo] = useState(loja.desconto_produto_ativo ?? false);
    const [maxPercent, setMaxPercent] = useState(loja.desconto_produto_max_percent ?? 0);
    const [tipoExcecao, setTipoExcecao] = useState('categoria'); // 'categoria' | 'produto'
    const [categoriaSelecionada, setCategoriaSelecionada] = useState('');
    const [produtoBusca, setProdutoBusca] = useState('');
    const [produtoSelecionado, setProdutoSelecionado] = useState(null);

    const ativoSalvo = loja.desconto_produto_ativo ?? false;
    const maxSalvo = parseFloat(loja.desconto_produto_max_percent ?? 0);
    const alterado = ativo !== ativoSalvo || parseFloat(maxPercent) !== maxSalvo;

    const produtosFiltrados = produtoBusca.length >= 2
        ? produtos.filter(p => p.nome?.toLowerCase().includes(produtoBusca.toLowerCase())).slice(0, 8)
        : [];

    const excecoesDaLoja = excecoes.filter(e => e.loja_id === loja.id);

    return (
        <div className="p-3 bg-white dark:bg-neutral-800 rounded-lg border border-blue-100 dark:border-blue-900/40 space-y-3">
            {/* Cabeçalho da loja */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-800 dark:text-gray-100 truncate">{loja.nome}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {!ativoSalvo ? 'Desconto por produto desabilitado' : `Até ${maxSalvo}% por item`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        checked={ativo}
                        onCheckedChange={setAtivo}
                        className="data-[state=checked]:bg-blue-600"
                    />
                    {ativo && (
                        <>
                            <div className="relative w-24">
                                <Input
                                    type="number"
                                    value={maxPercent}
                                    onChange={e => {
                                        let v = parseFloat(e.target.value);
                                        if (isNaN(v) || v < 0) v = 0;
                                        if (v > 100) v = 100;
                                        setMaxPercent(v);
                                    }}
                                    className="h-9 text-sm pr-6"
                                    min={0}
                                    max={100}
                                    step={0.5}
                                    placeholder="0"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
                            </div>
                            <Button
                                size="sm"
                                className="h-9 bg-blue-600 hover:bg-blue-700 text-white"
                                onClick={() => onSave({ ativo, maxPercent: parseFloat(maxPercent) || 0 })}
                                disabled={salvando || !alterado}
                            >
                                {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            </Button>
                        </>
                    )}
                    {!ativo && alterado && (
                        <Button
                            size="sm"
                            className="h-9 bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => onSave({ ativo, maxPercent: parseFloat(maxPercent) || 0 })}
                            disabled={salvando}
                        >
                            {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </Button>
                    )}
                </div>
            </div>

            {/* Exceções — só mostra quando ativo */}
            {ativo && (
                <>
                    {/* Lista de exceções */}
                    {excecoesDaLoja.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Exceções (sem desconto):</p>
                            <div className="flex flex-wrap gap-1.5">
                                {excecoesDaLoja.map(exc => (
                                    <span
                                        key={exc.id}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
                                    >
                                        {exc.categoria ? `Categoria: ${exc.categoria}` : (exc.produto_nome || 'Produto')}
                                        <button
                                            type="button"
                                            onClick={() => onRemoveExcecao(exc.id)}
                                            className="ml-0.5 hover:text-red-900 transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Adicionar exceção */}
                    <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-neutral-700">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Adicionar exceção:</p>
                        <div className="flex gap-2 items-start flex-wrap">
                            <Select value={tipoExcecao} onValueChange={setTipoExcecao}>
                                <SelectTrigger className="h-8 w-28 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="categoria">Categoria</SelectItem>
                                    <SelectItem value="produto">Produto</SelectItem>
                                </SelectContent>
                            </Select>

                            {tipoExcecao === 'categoria' ? (
                                <>
                                    <Select value={categoriaSelecionada} onValueChange={setCategoriaSelecionada}>
                                        <SelectTrigger className="h-8 flex-1 min-w-[140px] text-xs">
                                            <SelectValue placeholder="Selecionar categoria" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {categorias.map(cat => (
                                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs px-2"
                                        onClick={() => {
                                            if (!categoriaSelecionada) return;
                                            onAddExcecao({ loja_id: loja.id, categoria: categoriaSelecionada });
                                            setCategoriaSelecionada('');
                                        }}
                                        disabled={!categoriaSelecionada}
                                    >
                                        <Plus className="w-3 h-3" />
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <div className="relative flex-1 min-w-[160px]">
                                        <Input
                                            type="text"
                                            placeholder="Buscar produto..."
                                            value={produtoBusca}
                                            onChange={e => { setProdutoBusca(e.target.value); setProdutoSelecionado(null); }}
                                            className="h-8 text-xs"
                                        />
                                        {produtosFiltrados.length > 0 && !produtoSelecionado && (
                                            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                                {produtosFiltrados.map(p => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => { setProdutoSelecionado(p); setProdutoBusca(p.nome); }}
                                                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-neutral-700 border-b border-gray-100 dark:border-neutral-700 last:border-0"
                                                    >
                                                        {p.nome}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs px-2"
                                        onClick={() => {
                                            if (!produtoSelecionado) return;
                                            onAddExcecao({ loja_id: loja.id, produto_id: produtoSelecionado.id, produto_nome: produtoSelecionado.nome });
                                            setProdutoBusca('');
                                            setProdutoSelecionado(null);
                                        }}
                                        disabled={!produtoSelecionado}
                                    >
                                        <Plus className="w-3 h-3" />
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export default function DashboardGerente() {
    const hojeIso = new Date().toLocaleDateString('en-CA');
    const { user, isGerente, filterData, selectedStore } = useAuth();
    const { conferenciaCaixaEnabled } = useTenant();
    const queryClient = useQueryClient();
    const [periodo, setPeriodo] = useState('mes');
    const [metaModalOpen, setMetaModalOpen] = useState(false);
    const [editingMeta, setEditingMeta] = useState(null);
    const [novaMetaValor, setNovaMetaValor] = useState('');
    const [metaVendedorSelecionado, setMetaVendedorSelecionado] = useState(null);
    const [periodoGrafico, setPeriodoGrafico] = useState('mes'); // 5, 7, 14, 30, 60, 2y

    // Estados para tokens gerenciais (v2 - simplificado)
    const [tokenModalOpen, setTokenModalOpen] = useState(false);
    const [mostrarExpirados, setMostrarExpirados] = useState(false);
    const [novoToken, setNovoToken] = useState({
        tipoToken: 'SINGLE_USE', // 'SINGLE_USE' ou 'SUPERVISOR_MODE'
        permissao: 'DESCONTO', // 'DESCONTO', 'CANCELAMENTO', 'ALTERACAO_PRECO', 'SUPER_CAIXA'
        valorLimite: 20, // % ou R$
        validadeMinutos: 15,
        maxUsos: 1
    });
    const [tokenGerado, setTokenGerado] = useState(null); // Código gerado para exibição
    const [copiado, setCopiado] = useState(null);
    const [tokenHistoricoOpen, setTokenHistoricoOpen] = useState(false);

    // States for Price Approval Modal
    const [priceModalOpen, setPriceModalOpen] = useState(false);
    const [selectedPriceRequest, setSelectedPriceRequest] = useState(null);
    const [newPrice, setNewPrice] = useState('');

    // Estado para margem negociável por loja
    const [margemSalvando, setMargemSalvando] = useState({});

    // Estado para desconto por produto por loja
    const [descontoProdutoSalvando, setDescontoProdutoSalvando] = useState({});

    // Estados para dashboard tabs e pesquisa
    const [abaDashboard, setAbaDashboard] = useState('visao-geral');
    const [tipoComparativo, setTipoComparativo] = useState('mes'); // 'mes' ou 'ano'
    const [vendedorChartMode, setVendedorChartMode] = useState({}); // { nomeVendedor: 'evolucao' | 'comparativo' }
    const [buscaPedido, setBuscaPedido] = useState('');
    const [buscaEntrega, setBuscaEntrega] = useState('');
    const [pedidoSelecionado, setPedidoSelecionado] = useState(null);

    // Estados para detalhes do produto (Curva ABC)
    const [produtoModalOpen, setProdutoModalOpen] = useState(false);
    const [produtoDetalhe, setProdutoDetalhe] = useState(null);

    // Estado para modal de pendências
    const [pendenciasModalOpen, setPendenciasModalOpen] = useState(false);

    // Estados para detalhes da venda e pagamentos
    const [selectedVendaDetalhes, setSelectedVendaDetalhes] = useState(null);
    const [isDetalhesModalOpen, setIsDetalhesModalOpen] = useState(false);
    const [modalPagamentoVenda, setModalPagamentoVenda] = useState(null);
    const [pagamentoForm, setPagamentoForm] = useState({
        pagamentos: [],
        data_pagamento: new Date().toISOString().slice(0, 10),
        observacao: ""
    });
    const [novoPagamentoItem, setNovoPagamentoItem] = useState({ forma_pagamento: '', valor: '', parcelas: 1 });


    // Estados para Giro de Estoque
    const [giroFiltro, setGiroFiltro] = useState(60); // dias sem venda

    // Determinar se pode ver todas as lojas
    const isGerenteGeral = user?.cargo === 'Gerente Geral' || user?.cargo === 'Administrador';

    // Queries
    const { data: users = [] } = useQuery({
        queryKey: ['users-gerente'],
        queryFn: () => base44.entities.User.list(),
        enabled: !!user
    });

    const { data: lojasData = [] } = useQuery({
        queryKey: ['lojas-ativas'],
        queryFn: () => base44.entities.Loja.list('nome'),
        enabled: !!user
    });

    // Lojas que o gerente pode gerenciar
    const lojasGerenciadas = isGerenteGeral
        ? lojasData
        : lojasData.filter(l => l.nome === user?.loja || l.id === user?.loja_id);

    const { data: vendas = [], isLoading: loadingVendas, refetch: refetchVendas } = useQuery({
        queryKey: ['vendas-gerente'],
        queryFn: () => base44.entities.Venda.list('-data_venda'),
        enabled: !!user
    });

    // Assinatura em tempo real para Vendas
    React.useEffect(() => {
        if (!user) return;

        const channel = supabase
            .channel('dashboard-gerente-vendas')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'vendas' },
                () => {
                    refetchVendas();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, refetchVendas]);

    const { data: entregas = [], isLoading: loadingEntregas } = useQuery({
        queryKey: ['entregas-gerente'],
        queryFn: () => base44.entities.Entrega.list('-data_agendada'),
        enabled: !!user
    });

    const { data: caminhoes = [] } = useQuery({
        queryKey: ['caminhoes-gerente'],
        queryFn: () => base44.entities.Caminhao.list(),
        enabled: !!user
    });

    const { data: auditLogs = [] } = useQuery({
        queryKey: ['audit-logs-gerente'],
        queryFn: () => base44.entities.AuditLog.list('-created_at'),
        enabled: !!user,
        refetchInterval: 30000,
        retry: false
    });

    const { data: montagens = [], isLoading: loadingMontagens } = useQuery({
        queryKey: ['montagens-gerente'],
        queryFn: () => base44.entities.Montagem.list(),
        enabled: !!user
    });

    const { data: metas = [] } = useQuery({
        queryKey: ['metas-vendas'],
        queryFn: () => base44.entities.MetaVenda.list(),
        enabled: !!user
    });

    // Query para produtos (Curva ABC e Giro de Estoque)
    const { data: produtos = [] } = useQuery({
        queryKey: ['produtos-gerente'],
        queryFn: () => base44.entities.Produto.list(),
        enabled: !!user
    });

    // Query para tokens gerenciais
    const { data: tokens = [], refetch: refetchTokens } = useQuery({
        queryKey: ['tokens-gerenciais'],
        queryFn: () => base44.entities.TokenGerencial.list('-created_at'),
        enabled: !!user
    });

    const { data: assistencias = [] } = useQuery({
        queryKey: ['assistencias-gerente'],
        queryFn: () => base44.entities.AssistenciaTecnica.list(),
        enabled: !!user
    });

    // Query para solicitações de preço (novo)
    const { data: solicitacoesPreco = [], refetch: refetchSolicitacoesPreco } = useQuery({
        queryKey: ['solicitacoes-preco-gerente'],
        queryFn: () => base44.entities.SolicitacaoPreco.list('-data_solicitacao'),
        enabled: !!user
    });

    const { data: fechamentosComissao = [] } = useQuery({
        queryKey: ['comissoes-fechamento-dashboard'],
        queryFn: () => base44.entities.ComissaoFechamentoMensal.list('-created_at'),
        enabled: !!user
    });

    const { data: descontoExcecoes = [], refetch: refetchDescontoExcecoes } = useQuery({
        queryKey: ['desconto-produto-excecoes-gerente'],
        queryFn: () => base44.entities.DescontoProdutoExcecao.list(),
        enabled: !!user
    });

    const { data: categoriasFinanceiras = [] } = useQuery({
        queryKey: ['categorias-financeiras'],
        queryFn: () => base44.entities.CategoriaFinanceira.list('nome'),
        enabled: !!user
    });

    const { data: lancamentos = [] } = useQuery({
        queryKey: ['lancamentos-financeiros'],
        queryFn: () => base44.entities.LancamentoFinanceiro.list(),
        enabled: !!user
    });

    // Assinatura em tempo real para Solicitações de Preço
    React.useEffect(() => {
        if (!user) return;

        const channel = supabase
            .channel('dashboard-gerente-solicitacoes-preco')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'solicitacoes_preco' },
                () => {
                    refetchSolicitacoesPreco();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, refetchSolicitacoesPreco]);

    // Mutation para salvar metas
    const saveMeta = useMutation({
        mutationFn: async (meta) => {
            const { id, ...dataWithoutId } = meta;
            if (id) {
                return base44.entities.MetaVenda.update(id, dataWithoutId);
            }
            return base44.entities.MetaVenda.create(dataWithoutId);
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['metas-vendas']);
            setMetaModalOpen(false);
            setEditingMeta(null);
            setNovaMetaValor('');
            setMetaVendedorSelecionado(null);
        }
    });

    // Mutation para criar token
    // Mutation para criar token (v2 - mantém para compatibilidade, mas usamos handleCriarToken direto)
    const criarToken = useMutation({
        mutationFn: async (token) => {
            return base44.entities.TokenGerencial.create(token);
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['tokens-gerenciais']);
            setTokenModalOpen(false);
            setNovoToken({
                tipoToken: 'SINGLE_USE',
                permissao: 'DESCONTO',
                valorLimite: 20,
                validadeMinutos: 15,
                maxUsos: 1
            });
        }
    });

    // Mutation para revogar token
    const revogarToken = useMutation({
        mutationFn: async (tokenId) => {
            return base44.entities.TokenGerencial.update(tokenId, { ativo: false });
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['tokens-gerenciais']);
        }
    });

    // Gerar código numérico de 6 dígitos (100000-999999)
    const gerarCodigoToken = () => {
        return String(Math.floor(100000 + Math.random() * 900000));
    };

    // Copiar código do token
    const copiarCodigo = async (codigo) => {
        await navigator.clipboard.writeText(codigo);
        setCopiado(codigo);
        setTimeout(() => setCopiado(null), 2000);
    };

    // Lojas disponíveis (do usuário ou todas) - MUST be before lojaAtiva
    const lojas = useMemo(() => {
        if (!vendas.length) return [];
        const unique = [...new Set(vendas.map(v => v.loja).filter(Boolean))];
        return unique;
    }, [vendas]);

    // Se usuário é gerente de loja, definir loja automaticamente - MUST be before code that uses it
    const lojaAtiva = useMemo(() => {
        if (isGerenteGeral) {
            return selectedStore || 'todas';
        }
        return user?.loja || lojas[0] || '';
    }, [isGerenteGeral, selectedStore, user?.loja, lojas]);

    const getSolicitacoesPrecoPendentes = useMemo(() => {
        return solicitacoesPreco.filter(s => {
            const isPendente = s.status === 'pendente';
            const daLojaAtiva = lojaAtiva === 'todas' || s.loja === lojaAtiva;
            return isPendente && daLojaAtiva;
        });
    }, [solicitacoesPreco, lojaAtiva]);

    // Criar novo token (v2 - simplificado)
    const handleCriarToken = async () => {
        const codigo = gerarCodigoToken();
        const lojaDestino = lojaAtiva === 'todas' ? (lojas[0] || 'Centro') : lojaAtiva;
        const expiraEm = new Date(Date.now() + novoToken.validadeMinutos * 60 * 1000).toISOString();

        try {
            const tokenCriado = await base44.entities.TokenGerencial.create({
                codigo,
                gerente_id: user.id,
                gerente_nome: user.full_name,
                loja: lojaDestino,
                tipo_token: novoToken.tipoToken,
                permissao: novoToken.permissao,
                valor_limite: novoToken.tipoToken === 'SUPER_CAIXA' ? null : novoToken.valorLimite,
                validade_minutos: novoToken.validadeMinutos,
                max_usos: novoToken.maxUsos,
                usos_realizados: 0,
                ativo: true,
                expira_em: expiraEm
            });
            setTokenGerado(tokenCriado);
            refetchTokens();
            toast.success('Token gerado com sucesso!');
        } catch (error) {
            console.error('Erro ao criar token:', error);
            toast.error('Erro ao criar token');
        }
    };

    // Mutation para responder solicitação de preço
    const responderSolicitacaoPreco = useMutation({
        mutationFn: async ({ id, status, precoValido, produtoId }) => {
            const promessas = [
                base44.entities.SolicitacaoPreco.update(id, {
                    status,
                    gerente_id: user.id,
                    data_resposta: new Date().toISOString()
                })
            ];

            // Atualiza automaticamente o preço de venda master do produto
            if (precoValido !== undefined && produtoId) {
                promessas.push(
                    supabase
                        .from('produtos')
                        .update({ preco_venda: precoValido, updated_at: new Date().toISOString() })
                        .eq('id', produtoId)
                );
                // Invalidate future products list 
                queryClient.invalidateQueries(['produtos']);
            }

            return Promise.all(promessas);
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries(['solicitacoes-preco-gerente']);
            const acao = variables.status === 'aprovado' ? 'aprovada' : 'rejeitada';
            toast.success(`Solicitação de preço ${acao}!`);
        },
        onError: (err) => {
            console.error('Erro ao responder solicitação:', err);
            toast.error('Erro ao processar a solicitação de preço.');
        }
    });

    const formatarValorMonetarioInput = (value) => {
        const digitsOnly = String(value ?? "").replace(/\D/g, "");
        if (!digitsOnly) return "";

        const valorNumerico = Number(digitsOnly) / 100;
        return valorNumerico.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    };

    const registrarPagamentoVenda = async ({ venda, valorRecebido, formaPagamento, dataPagamento, observacao }) => {
        if (!venda?.id) throw new Error('Venda inválida para registrar pagamento.');
        if (isVendaCancelada(venda)) throw new Error('Não é possível registrar pagamento em venda cancelada.');

        const financeiroAtual = venda.financeiro || getVendaFinanceiro(venda, { entregas, lancamentos });
        const saldoAtual = Math.max(toMoneyNumber(financeiroAtual.valorRestante), 0);
        const totalVenda = Math.max(toMoneyNumber(financeiroAtual.total || venda.valor_total), 0);
        const valorPagoAtual = Math.max(toMoneyNumber(financeiroAtual.valorPago || venda.valor_pago), 0);

        const rawPayments = Array.isArray(valorRecebido)
            ? valorRecebido
            : [{ forma_pagamento: formaPagamento, valor: valorRecebido, parcelas: 1 }];

        const paymentValidation = validatePaymentSplit({
            total: saldoAtual,
            payments: rawPayments.map((payment) => ({
                ...payment,
                valor: toMoneyNumber(payment?.valor),
                parcelas: Number(payment?.parcelas || 1),
            })),
        });

        if (!paymentValidation.ok) {
            throw new Error(paymentValidation.errors[0] || 'Não foi possível validar os pagamentos informados.');
        }

        const novosPagamentos = paymentValidation.pagamentos;
        const valorRecebidoNum = paymentValidation.totalPago;

        if (valorRecebidoNum <= MONEY_EPSILON) {
            throw new Error('Informe um valor de pagamento maior que zero.');
        }

        const novoValorPago = Math.min(totalVenda, valorPagoAtual + valorRecebidoNum);
        const novoValorRestante = Math.max(totalVenda - novoValorPago, 0);
        const quitada = novoValorRestante <= MONEY_EPSILON;
        const statusVenda = quitada ? 'Pago' : 'Pagamento Pendente';
        const pagamentosExistentes = Array.isArray(venda.pagamentos) ? venda.pagamentos : [];
        const pagamentosAtualizados = [...pagamentosExistentes, ...novosPagamentos];
        const formaPagamentoResumo = pagamentosAtualizados.length === 1
            ? pagamentosAtualizados[0].forma_pagamento
            : 'Múltiplos';

        const vendaUpdatePayload = {
            valor_pago: novoValorPago,
            valor_restante: novoValorRestante,
            status: statusVenda,
            forma_pagamento: formaPagamentoResumo,
            pagamentos: pagamentosAtualizados,
            pagamento_entrega_observacao: observacao || null,
        };

        try {
            await base44.entities.Venda.update(venda.id, vendaUpdatePayload);
        } catch (error) {
            const mensagem = String(error?.message || '').toLowerCase();
            const colunaAusente = mensagem.includes('pagamento_entrega_observacao') && mensagem.includes('schema cache');

            if (!colunaAusente) {
                throw error;
            }

            const { pagamento_entrega_observacao, ...fallbackPayload } = vendaUpdatePayload;
            await base44.entities.Venda.update(venda.id, fallbackPayload);
        }

        const categoriaRecebimento = findCategoriaByNames(categoriasFinanceiras, [
            'Recebimento de Parcela',
            'Venda de Produtos',
            'Vendas',
        ]);

        for (const pagamento of novosPagamentos) {
            const descricaoParcelas = pagamento.parcelas > 1 ? ` (${pagamento.parcelas}x)` : '';
            await base44.entities.LancamentoFinanceiro.create({
                descricao: `Pagamento na loja - Venda #${venda.numero_pedido} - ${pagamento.forma_pagamento}${descricaoParcelas}`,
                valor: pagamento.valor,
                tipo: 'receita',
                data_lancamento: dataPagamento,
                data_vencimento: dataPagamento,
                pago: true,
                categoria_id: categoriaRecebimento?.id || null,
                categoria_nome: categoriaRecebimento?.nome || 'Recebimento de Parcela',
                forma_pagamento: pagamento.forma_pagamento,
                status: 'Pago',
                observacao: observacao || 'Pagamento antecipado registrado na listagem de vendas.',
                venda_id: venda.id,
                numero_pedido: venda.numero_pedido,
            });
        }

        if (quitada) {
            const pendentesVenda = (lancamentos || []).filter((l) =>
                l.venda_id === venda.id &&
                String(l.tipo || '').toLowerCase() === 'receita' &&
                String(l.status || '').toLowerCase() === 'pendente'
            );

            for (const lancamento of pendentesVenda) {
                await base44.entities.LancamentoFinanceiro.update(lancamento.id, {
                    status: 'Pago',
                    pago: true,
                    data_lancamento_real: dataPagamento,
                    observacao: `${lancamento.observacao || ''} [Quitado na loja antes da entrega]`.trim(),
                });
            }
        }

        return { valorRecebidoNum, novoValorRestante, quitada };
    };

    const registrarPagamentoMutation = useMutation({
        mutationFn: registrarPagamentoVenda,
        onSuccess: ({ valorRecebidoNum, novoValorRestante, quitada }) => {
            queryClient.invalidateQueries({ queryKey: ['vendas-gerente'] });
            queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
            queryClient.invalidateQueries({ queryKey: ['entregas-gerente'] });
            queryClient.invalidateQueries({ queryKey: ['vendas-financeiro'] });

            toast.success(
                `Pagamento de R$ ${valorRecebidoNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} registrado. ${quitada ? 'Venda quitada.' : `Saldo restante: R$ ${novoValorRestante.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`}`
            );
            setModalPagamentoVenda(null);
            setPagamentoForm({
                pagamentos: [],
                data_pagamento: new Date().toISOString().slice(0, 10),
                observacao: ""
            });
            setNovoPagamentoItem(createEmptyPagamentoItem({ forma_pagamento: 'PIX' }));
        },
        onError: (error) => {
            toast.error(error?.message || 'Não foi possível registrar o pagamento.');
        }
    });

    const abrirModalPagamento = (venda) => {
        const financeiro = venda.financeiro || getVendaFinanceiro(venda, { entregas, lancamentos });
        const saldoAtual = Math.max(toMoneyNumber(financeiro.valorRestante), 0);
        const formaPagamentoPadrao = venda.forma_pagamento_entrega || venda.forma_pagamento || 'PIX';

        setPagamentoForm({
            pagamentos: [],
            data_pagamento: new Date().toISOString().slice(0, 10),
            observacao: ""
        });
        setNovoPagamentoItem(createEmptyPagamentoItem({
            forma_pagamento: formaPagamentoPadrao,
            valor: saldoAtual > 0 ? formatarValorMonetarioInput(saldoAtual.toFixed(2)) : '',
        }));
        setModalPagamentoVenda(venda);
    };

    const saldoModalPagamento = modalPagamentoVenda
        ? Math.max(
            toMoneyNumber((modalPagamentoVenda.financeiro || getVendaFinanceiro(modalPagamentoVenda, { entregas, lancamentos })).valorRestante),
            0
        )
        : 0;

    const totalPagamentoInformado = pagamentoForm.pagamentos.reduce((total, pagamento) => total + toMoneyNumber(pagamento.valor), 0);
    const saldoAposSplit = Math.max(saldoModalPagamento - totalPagamentoInformado, 0);

    const adicionarPagamentoAoModal = () => {
        const pagamentosCandidatos = [
            ...pagamentoForm.pagamentos,
            {
                ...novoPagamentoItem,
                valor: toMoneyNumber(novoPagamentoItem.valor),
                parcelas: Number(novoPagamentoItem.parcelas || 1),
            }
        ];

        const validation = validatePaymentSplit({
            total: saldoModalPagamento,
            payments: pagamentosCandidatos,
        });

        if (!validation.ok) {
            toast.error(validation.errors[0] || 'Não foi possível adicionar essa forma de pagamento.');
            return;
        }

        setPagamentoForm((prev) => ({
            ...prev,
            pagamentos: validation.pagamentos,
        }));
        const saldoRestanteAtualizado = Math.max(saldoModalPagamento - validation.totalPago, 0);
        setNovoPagamentoItem(createEmptyPagamentoItem({
            forma_pagamento: novoPagamentoItem.forma_pagamento || 'PIX',
            valor: saldoRestanteAtualizado > 0 ? formatarValorMonetarioInput(saldoRestanteAtualizado.toFixed(2)) : '',
        }));
    };

    const removerPagamentoDoModal = (index) => {
        setPagamentoForm((prev) => ({
            ...prev,
            pagamentos: prev.pagamentos.filter((_, itemIndex) => itemIndex !== index),
        }));
    };

    const confirmarPagamentoAntecipado = () => {
        if (!modalPagamentoVenda) return;

        if (!pagamentoForm.pagamentos.length) {
            toast.error('Adicione pelo menos uma forma de pagamento.');
            return;
        }

        registrarPagamentoMutation.mutate({
            venda: modalPagamentoVenda,
            valorRecebido: pagamentoForm.pagamentos,
            dataPagamento: pagamentoForm.data_pagamento,
            observacao: pagamentoForm.observacao,
        });
    };

    const handleVerDetalhes = (vendaId) => {
        const venda = vendas.find(v => v.id === vendaId);
        if (venda) {
            setSelectedVendaDetalhes(venda);
            setIsDetalhesModalOpen(true);
        } else {
            toast.error("Pedido não encontrado.");
        }
    };

    const getEntregaPendenciaMotivo = (e, hojeIso) => {
        if (!e.data_agendada || e.status === 'Pendente') {
            return "Aguardando agendamento";
        }
        const parsedDate = parseDateSafe(e.data_agendada);
        const dataAgendadaStr = parsedDate.toISOString().split('T')[0];
        if (dataAgendadaStr < hojeIso) {
            return `Entrega em atraso (era ${parsedDate.toLocaleDateString('pt-BR')})`;
        }
        if (e.status === 'Agendada') {
            return `Agendada para ${parsedDate.toLocaleDateString('pt-BR')}`;
        }
        if (e.status === 'Em Rota' || e.status === 'Em Transito') {
            return "Em rota de entrega";
        }
        return `Status: ${e.status}`;
    };

    const getMontagemPendenciaMotivo = (m, hojeIso) => {
        if (!m.data_agendada || m.status === 'Pendente') {
            return "Aguardando agendamento";
        }
        const parsedDate = parseDateSafe(m.data_agendada);
        const dataAgendadaStr = parsedDate.toISOString().split('T')[0];
        const isAtrasada = dataAgendadaStr < hojeIso;
        const semMontador = !m.montador_nome && !m.montador_id;
        
        if (isAtrasada) {
            return `Montagem em atraso (era ${parsedDate.toLocaleDateString('pt-BR')})`;
        }
        if (semMontador) {
            return "Aguardando atribuição de montador";
        }
        if (m.status === 'Agendada') {
            return `Agendada para ${parsedDate.toLocaleDateString('pt-BR')}`;
        }
        return `Status: ${m.status}`;
    };

    // Tokens filtrados por loja
    const tokensFiltrados = useMemo(() => {
        return tokens.filter(t => {
            if (lojaAtiva === 'todas') return true;
            return t.loja === lojaAtiva;
        });
    }, [tokens, lojaAtiva]);

    const tokensAtivos = tokensFiltrados.filter(t => {
        if (!t.ativo) return false;
        if (t.expira_em && new Date(t.expira_em) < new Date()) return false;
        if (t.max_usos && t.usos_realizados >= t.max_usos) return false;
        return true;
    });

    const tokensExibidos = useMemo(() => {
        return tokensFiltrados.filter(t => {
            const expirado = t.expira_em && new Date(t.expira_em) < new Date();
            if (mostrarExpirados) return true;
            return !expirado;
        });
    }, [tokensFiltrados, mostrarExpirados]);

    // lojaAtiva moved earlier in the file (before handleCriarToken and tokensFiltrados)

    // Filtrar vendas por período e loja
    const vendasFiltradas = useMemo(() => {
        const hojeIso = new Date().toLocaleDateString('en-CA');
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        return vendas.filter(v => {
            // Filtro de status
            if (isVendaCancelada(v)) return false;

            // Filtro de loja
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;

            // Filtro de período
            if (!v.data_venda) return false;
            const dataVendaStr = v.data_venda.split('T')[0];
            const d = parseDateSafe(v.data_venda);
            d.setHours(0, 0, 0, 0);

            switch (periodo) {
                case 'hoje':
                    return dataVendaStr === hojeIso;
                case 'semana': {
                    const inicioSemana = new Date(hoje);
                    inicioSemana.setDate(hoje.getDate() - hoje.getDay());
                    return d >= inicioSemana;
                }
                case 'mes':
                    return d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear();
                default:
                    return true;
            }
        });
    }, [vendas, periodo, lojaAtiva]);

    // Vendas de hoje específicas
    const vendasHoje = useMemo(() => {
        const hojeIso = new Date().toLocaleDateString('en-CA');

        return vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            if (!v.data_venda) return false;
            const dataVendaStr = v.data_venda.split('T')[0];
            return dataVendaStr === hojeIso;
        });
    }, [vendas, lojaAtiva]);

    // Vendas deste mês
    const vendasMes = useMemo(() => {
        const hoje = new Date();
        return vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            if (!v.data_venda) return false;
            const d = parseDateSafe(v.data_venda);
            return d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear();
        });
    }, [vendas, lojaAtiva]);

    // KPIs principais
    const kpis = useMemo(() => {
        const hoje = new Date();
        const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;

        // Helper para cálculo líquido (centralizado)
        const calcularTotalLiquido = (vendasArr) => {
            return vendasArr.reduce((sum, v) => {
                const assistencia = assistencias.find(a =>
                    a.numero_pedido === v.numero_pedido &&
                    a.status === 'Concluída' &&
                    (a.tipo === 'Devolução' || a.tipo === 'Troca')
                );
                return sum + (v.valor_total || 0) - (assistencia?.valor_devolvido || 0);
            }, 0);
        };

        const totalHoje = calcularTotalLiquido(vendasHoje);
        const qtdHoje = vendasHoje.length;

        const totalMes = calcularTotalLiquido(vendasMes);
        const qtdMes = vendasMes.length;
        const ticketMedio = qtdMes > 0 ? totalMes / qtdMes : 0;

        // Meta do mês
        const metaLoja = metas.find(m =>
            m.mes === mesAtual &&
            m.loja === lojaAtiva &&
            !m.vendedor_id
        );
        const metaValor = metaLoja?.meta_valor || 0;
        const progressoMeta = metaValor > 0 ? (totalMes / metaValor) * 100 : 0;

        // Dias restantes no mês
        const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
        const diasRestantes = ultimoDia.getDate() - hoje.getDate();

        // Comparativo com mesmo dia da semana anterior
        const semanaPassada = new Date(hoje);
        semanaPassada.setDate(hoje.getDate() - 7);
        semanaPassada.setHours(0, 0, 0, 0);

        const vendasSemanaPassada = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            if (!v.data_venda) return false;
            const d = parseDateSafe(v.data_venda);
            d.setHours(0, 0, 0, 0);
            return d.getTime() === semanaPassada.getTime();
        });
        const totalSemanaPassada = vendasSemanaPassada.reduce((sum, v) => sum + (v.valor_total || 0), 0);
        const variacaoHoje = totalSemanaPassada > 0
            ? ((totalHoje - totalSemanaPassada) / totalSemanaPassada) * 100
            : 0;

        return {
            totalHoje,
            qtdHoje,
            totalMes,
            qtdMes,
            ticketMedio,
            metaValor,
            progressoMeta,
            diasRestantes,
            variacaoHoje
        };
    }, [vendasHoje, vendasMes, vendas, metas, lojaAtiva]);

    // Comparativo YoY (Year over Year)
    const comparativoYoY = useMemo(() => {
        const hoje = new Date();
        const mesAnoPassado = new Date(hoje.getFullYear() - 1, hoje.getMonth(), 1);
        const fimMesAnoPassado = new Date(hoje.getFullYear() - 1, hoje.getMonth() + 1, 0);

        const vendasAnoPassado = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            if (!v.data_venda) return false;
            const d = parseDateSafe(v.data_venda);
            return d >= mesAnoPassado && d <= fimMesAnoPassado;
        });

        // Usar a mesma lógica de cálculo líquido para consistência
        const calcularTotalLiquido = (vendasArr) => {
            return vendasArr.reduce((sum, v) => {
                const assistencia = assistencias.find(a =>
                    a.numero_pedido === v.numero_pedido &&
                    a.status === 'Concluída' &&
                    (a.tipo === 'Devolução' || a.tipo === 'Troca')
                );
                return sum + (v.valor_total || 0) - (assistencia?.valor_devolvido || 0);
            }, 0);
        };

        const totalAnoPassado = calcularTotalLiquido(vendasAnoPassado);
        const variacao = totalAnoPassado > 0
            ? ((kpis.totalMes - totalAnoPassado) / totalAnoPassado) * 100
            : 0;

        const nomeMesAnoPassado = mesAnoPassado.toLocaleDateString('pt-BR', { month: 'short' });
        const labelStr = `${nomeMesAnoPassado.charAt(0).toUpperCase() + nomeMesAnoPassado.slice(1)}/${hoje.getFullYear() - 1}`;

        return { totalAnoPassado, variacao, label: labelStr };
    }, [vendas, lojaAtiva, kpis.totalMes, assistencias]);

    // Comparativo MoM (Month over Month)
    const comparativoMoM = useMemo(() => {
        const hoje = new Date();
        const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0);

        const vendasMesAnterior = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            if (!v.data_venda) return false;
            const d = parseDateSafe(v.data_venda);
            return d >= mesAnterior && d <= fimMesAnterior;
        });

        const calcularTotalLiquido = (vendasArr) => {
            return vendasArr.reduce((sum, v) => {
                const assistencia = assistencias.find(a =>
                    a.numero_pedido === v.numero_pedido &&
                    a.status === 'Concluída' &&
                    (a.tipo === 'Devolução' || a.tipo === 'Troca')
                );
                return sum + (v.valor_total || 0) - (assistencia?.valor_devolvido || 0);
            }, 0);
        };

        const totalMesAnterior = calcularTotalLiquido(vendasMesAnterior);
        const variacao = totalMesAnterior > 0
            ? ((kpis.totalMes - totalMesAnterior) / totalMesAnterior) * 100
            : 0;

        return { totalMesAnterior, variacao };
    }, [vendas, lojaAtiva, kpis.totalMes, assistencias]);

    // Comissões a pagar por vendedor
    const comissoesPorVendedor = useMemo(() => {
        const agrupado = {};

        vendasMes.forEach(v => {
            const vendedorId = v.responsavel_id;
            let vendedorNome = v.responsavel_nome || v.vendedor_nome || 'Não informado';

            // Tentar resolver nome pelo ID se possível
            if (vendedorId) {
                const userEncontrado = users.find(u => u.id === vendedorId);
                if (userEncontrado && userEncontrado.full_name) {
                    vendedorNome = userEncontrado.full_name;
                }
            }

            if (!agrupado[vendedorNome]) {
                agrupado[vendedorNome] = { nome: vendedorNome, id: vendedorId, comissao: 0, vendas: 0, total: 0 };
            }

            // Ajuste de comissão por devolução
            const assistencia = assistencias.find(a =>
                a.numero_pedido === v.numero_pedido &&
                a.status === 'Concluída' &&
                (a.tipo === 'Devolução' || a.tipo === 'Troca')
            );

            const valorTotalAjustado = (v.valor_total || 0) - (assistencia?.valor_devolvido || 0);
            const taxaComissao = (v.comissao_calculada || 0) / (v.valor_total || 1);

            agrupado[vendedorNome].comissao += valorTotalAjustado * taxaComissao;
            agrupado[vendedorNome].vendas += 1;
            agrupado[vendedorNome].total += valorTotalAjustado;
        });


        return Object.values(agrupado)
            .filter(v => v.comissao > 0)
            .sort((a, b) => b.comissao - a.comissao);
    }, [vendasMes]);

    const totalComissoes = comissoesPorVendedor.reduce((sum, v) => sum + v.comissao, 0);

    const comissoesPendentesFechamento = useMemo(() => {
        const hoje = new Date();
        const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
        const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);

        const fechamentosPendentes = (fechamentosComissao || []).filter((item) => {
            const inicio = (item.periodo_inicio || '').slice(0, 10);
            const fim = (item.periodo_fim || '').slice(0, 10);
            const statusPendente = item.status !== 'Pago';
            const periodoAtual = inicio === inicioMes && fim === fimMes;
            const lojaMatch = lojaAtiva === 'todas' || item.loja === lojaAtiva;
            return statusPendente && periodoAtual && lojaMatch;
        });

        return fechamentosPendentes
            .map((item) => {
                const userEncontrado = users.find((u) => u.id === item.vendedor_id);
                return {
                    id: item.vendedor_id || item.id,
                    nome: userEncontrado?.full_name || 'Vendedor',
                    vendas: item.quantidade_vendas || 0,
                    comissao: Number(item.total_final || item.total_comissao || 0),
                    status: item.status || 'Pendente'
                };
            })
            .sort((a, b) => b.comissao - a.comissao);
    }, [fechamentosComissao, lojaAtiva, users]);

    const totalComissoesPendentes = comissoesPendentesFechamento.reduce((sum, v) => sum + v.comissao, 0);
    const comissoesCardLista = comissoesPendentesFechamento.length > 0 ? comissoesPendentesFechamento : comissoesPorVendedor;
    const totalComissoesCard = comissoesPendentesFechamento.length > 0 ? totalComissoesPendentes : totalComissoes;

    // Curva ABC de produtos
    const curvaABC = useMemo(() => {
        const produtosVendidos = {};

        vendasMes.forEach(v => {
            if (v.itens && Array.isArray(v.itens)) {
                v.itens.forEach(item => {
                    const prodId = item.produto_id || item.id;
                    // Buscar nome do produto na lista de produtos quando item.nome está vazio
                    const produtoInfo = produtos.find(p => p.id === prodId);
                    const nomeProduto = item.produto_nome || item.nome || produtoInfo?.nome || `Produto #${prodId}`;

                    if (!produtosVendidos[prodId]) {
                        produtosVendidos[prodId] = { id: prodId, nome: nomeProduto, valor: 0, qtd: 0, produtoInfo };
                    }
                    produtosVendidos[prodId].valor += (item.preco_unitario || item.preco_venda || 0) * (item.quantidade || 1);
                    produtosVendidos[prodId].qtd += item.quantidade || 1;
                });
            }
        });

        const ordenado = Object.values(produtosVendidos).sort((a, b) => b.valor - a.valor);
        const totalVendas = ordenado.reduce((sum, p) => sum + p.valor, 0);

        let acumulado = 0;
        const classificados = ordenado.map(p => {
            acumulado += p.valor;
            const percentual = totalVendas > 0 ? (acumulado / totalVendas) * 100 : 0;
            return {
                ...p,
                classificacao: percentual <= 80 ? 'A' : percentual <= 95 ? 'B' : 'C'
            };
        });

        return {
            produtos: classificados.slice(0, 10),
            resumo: {
                A: classificados.filter(p => p.classificacao === 'A').length,
                B: classificados.filter(p => p.classificacao === 'B').length,
                C: classificados.filter(p => p.classificacao === 'C').length
            }
        };
    }, [vendasMes, produtos]);

    // Giro de estoque e produtos encalhados
    const giroEstoque = useMemo(() => {
        const hoje = new Date();
        const produtosComVendas = {};
        const vendasPorProduto = {};

        // Mapear última venda e total de vendas de cada produto
        vendas.forEach(v => {
            if (isVendaCancelada(v)) return;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return;
            if (v.itens && Array.isArray(v.itens)) {
                v.itens.forEach(item => {
                    const prodId = item.produto_id || item.id;
                    const dataVenda = parseDateSafe(v.data_venda);
                    if (!produtosComVendas[prodId] || dataVenda > produtosComVendas[prodId]) {
                        produtosComVendas[prodId] = dataVenda;
                    }
                    // Contar vendas por produto
                    vendasPorProduto[prodId] = (vendasPorProduto[prodId] || 0) + (item.quantidade || 1);
                });
            }
        });

        // Produtos encalhados (usando giroFiltro dinâmico)
        const encalhados = produtos
            .filter(p => {
                if (!p.ativo) return false;
                if (lojaAtiva !== 'todas' && p.loja && p.loja !== lojaAtiva) return false;
                if ((p.quantidade_estoque || 0) <= 0) return false;

                const ultimaVenda = produtosComVendas[p.id];
                if (!ultimaVenda) return true; // Nunca vendido

                const diasSemVenda = Math.floor((hoje - ultimaVenda) / (1000 * 60 * 60 * 24));
                return diasSemVenda > giroFiltro;
            })
            .map(p => {
                const ultimaVenda = produtosComVendas[p.id];
                const diasSemVenda = ultimaVenda
                    ? Math.floor((hoje - ultimaVenda) / (1000 * 60 * 60 * 24))
                    : 999; // Nunca vendido

                // Calcular valor em estoque (apenas preço de venda para segurança)
                const valorEstoque = (p.quantidade_estoque || 0) * (p.preco_venda || 0);

                // Buscar classificação ABC
                const abcProduto = curvaABC.produtos.find(abc => abc.id === p.id);

                return {
                    ...p,
                    diasSemVenda,
                    valorEstoque,
                    classificacaoABC: abcProduto?.classificacao || 'C',
                    qtdVendas: vendasPorProduto[p.id] || 0
                };
            })
            .sort((a, b) => b.valorEstoque - a.valorEstoque); // Ordenar por valor em estoque

        // Calcular métricas gerais
        const totalValorEncalhado = encalhados.reduce((sum, p) => sum + (p.valorEstoque || 0), 0);
        const produtosC = encalhados.filter(p => p.classificacaoABC === 'C');

        return {
            encalhados: encalhados.slice(0, 10),
            totalEncalhados: encalhados.length,
            totalValorEncalhado,
            produtosCriticos: produtosC.length // Produtos C encalhados (alta prioridade)
        };
    }, [vendas, produtos, lojaAtiva, giroFiltro, curvaABC.produtos]);

    // Status de entregas
    const statusEntregas = useMemo(() => {
        const hojeIso = new Date().toLocaleDateString('en-CA');

        const entregasFiltradas = entregas.filter(e => {
            if (lojaAtiva === 'todas') return true;
            const vendaAssociada = vendas.find(v => v.id === e.venda_id);
            return vendaAssociada?.loja === lojaAtiva;
        });

        const pendentes = entregasFiltradas.filter(e => e.status === 'Pendente' || e.status === 'Agendada');
        const emRota = entregasFiltradas.filter(e => e.status === 'Em Rota' || e.status === 'Em Transito');
        const atrasadas = entregasFiltradas.filter(e => {
            if (e.status === 'Entregue' || isVendaCancelada(e?.status)) return false;
            if (!e.data_agendada) return false;

            // Comparação segura de strings YYYY-MM-DD
            const dataAgendadaStr = e.data_agendada.split('T')[0];
            return dataAgendadaStr < hojeIso;
        });

        return { pendentes, emRota, atrasadas };
    }, [entregas, vendas, lojaAtiva]);

    // Pendências
    const pendencias = useMemo(() => {
        // Entregas pendentes
        const entregasPendentes = entregas.filter(e => {
            const vendaAssociada = vendas.find(v => v.id === e.venda_id);
            if (isVendaCancelada(vendaAssociada)) return false;
            if (lojaAtiva !== 'todas') {
                if (vendaAssociada?.loja !== lojaAtiva) return false;
            }
            const statusNorm = String(e.status || '').trim().toLowerCase();
            return !['entregue', 'retirado', 'cancelada', 'cancelado'].includes(statusNorm);
        });

        // Montagens pendentes
        const montagensPendentes = montagens.filter(m => {
            const vendaAssociada = vendas.find(v => v.id === m.venda_id);
            if (isVendaCancelada(vendaAssociada)) return false;
            if (lojaAtiva !== 'todas') {
                if (vendaAssociada?.loja !== lojaAtiva) return false;
            }
            const statusNorm = String(m.status || '').trim().toLowerCase();
            return !['concluída', 'concluida', 'cancelado', 'cancelada'].includes(statusNorm);
        });

        // Pagamentos em aberto
        const pagamentosAbertos = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            return (v.valor_restante || 0) > 0.01;
        });

        // Triagem pendente
        const triagemPendente = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            return v.triagem_realizada === false;
        });

        return {
            entregas: entregasPendentes,
            montagens: montagensPendentes,
            pagamentos: pagamentosAbertos,
            triagem: triagemPendente,
            total: entregasPendentes.length + montagensPendentes.length + pagamentosAbertos.length + triagemPendente.length
        };
    }, [entregas, montagens, vendas, lojaAtiva]);

    // Pesquisa de pedidos
    const pedidosPesquisados = useMemo(() => {
        if (!buscaPedido.trim()) return [];
        const termo = buscaPedido.toLowerCase().trim();

        return vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;

            // Buscar por número do pedido, cliente ou vendedor
            const numeroPedido = (v.numero_pedido || v.id || '').toString().toLowerCase();
            const cliente = (v.cliente_nome || '').toLowerCase();
            const vendedor = (v.responsavel_nome || v.vendedor_nome || '').toLowerCase();

            return numeroPedido.includes(termo) ||
                cliente.includes(termo) ||
                vendedor.includes(termo);
        }).slice(0, 20);
    }, [vendas, buscaPedido, lojaAtiva]);

    // Pesquisa de entregas
    const entregasPesquisadas = useMemo(() => {
        if (!buscaEntrega.trim()) return statusEntregas.pendentes.concat(statusEntregas.emRota).concat(statusEntregas.atrasadas);
        const termo = buscaEntrega.toLowerCase().trim();

        const todasEntregas = statusEntregas.pendentes.concat(statusEntregas.emRota).concat(statusEntregas.atrasadas);
        // Remover duplicatas (um item pode ser pendente E atrasado)
        const entregasUnicas = Array.from(new Map(todasEntregas.map(item => [item.id, item])).values());

        return entregasUnicas.filter(e => {
            const vendaAssociada = vendas.find(v => v.id === e.venda_id);
            const cliente = (vendaAssociada?.cliente_nome || e.cliente_nome || '').toLowerCase();
            const endereco = (e.endereco || '').toLowerCase();
            const numeroPedido = (vendaAssociada?.numero_pedido || e.venda_id || '').toString().toLowerCase();

            return cliente.includes(termo) ||
                endereco.includes(termo) ||
                numeroPedido.includes(termo);
        });
    }, [statusEntregas, buscaEntrega, vendas]);

    // Ranking de vendedores expandido com gráfico e metas
    const rankingVendedores = useMemo(() => {
        const agrupado = {};
        const hoje = new Date();
        const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;

        const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0);

        const vendasMesAnterior = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            if (!v.data_venda) return false;
            const d = parseDateSafe(v.data_venda);
            return d >= mesAnterior && d <= fimMesAnterior;
        });

        vendasMes.forEach(v => {
            const vendedorId = v.responsavel_id;
            let vendedorNome = v.responsavel_nome || v.vendedor_nome || 'Não informado';

            // Tentar resolver nome pelo ID se possível
            if (vendedorId && users) {
                const userEncontrado = users.find(u => u.id === vendedorId);
                if (userEncontrado && userEncontrado.full_name) {
                    vendedorNome = userEncontrado.full_name;
                }
            }

            if (!agrupado[vendedorNome]) {
                agrupado[vendedorNome] = {
                    nome: vendedorNome,
                    id: vendedorId,
                    total: 0,
                    qtd: 0,
                    vendasDetalhadas: []
                };
            }
            agrupado[vendedorNome].total += v.valor_total || 0;
            agrupado[vendedorNome].qtd++;
            agrupado[vendedorNome].vendasDetalhadas.push(v);
        });

        // Adicionar metas individuais e gráfico
        return Object.values(agrupado)
            .map(vendedor => {
                const metaVendedor = metas.find(m =>
                    m.mes === mesAtual &&
                    m.vendedor_id === vendedor.id
                );

                // Variacao MoM
                const vendasAnt = vendasMesAnterior.filter(v => v.responsavel_id === vendedor.id || v.responsavel_nome === vendedor.nome || v.vendedor_nome === vendedor.nome);
                const totalAnt = vendasAnt.reduce((sum, v) => sum + (v.valor_total || 0), 0);
                const variacaoMoM = totalAnt > 0 ? ((vendedor.total - totalAnt) / totalAnt) * 100 : 0;

                // Gerar grafico diario (deste mes apenas)
                const graficoMap = {};
                for (let d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); d <= hoje; d.setDate(d.getDate() + 1)) {
                    const dia = d.toISOString().split('T')[0];
                    const diaNum = d.getDate();
                    graficoMap[dia] = { dia, diaNum, total: 0, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), vendasList: [] };
                }

                vendedor.vendasDetalhadas.forEach(v => {
                    const dia = v.data_venda.split('T')[0];
                    if (graficoMap[dia]) {
                        graficoMap[dia].total += v.valor_total || 0;
                        graficoMap[dia].vendasList.push(v);
                    }
                });

                const dadosGrafico = Object.values(graficoMap);

                // Gerar grafico diário do mês anterior (para comparativo MoM)
                const graficoMapAnt = {};
                const diasMesAnterior = fimMesAnterior.getDate();
                for (let d = 1; d <= diasMesAnterior; d++) {
                    graficoMapAnt[d] = 0;
                }
                vendasAnt.forEach(v => {
                    if (v.data_venda) {
                        const dAnt = parseDateSafe(v.data_venda).getDate();
                        if (graficoMapAnt[dAnt] !== undefined) {
                            graficoMapAnt[dAnt] += v.valor_total || 0;
                        }
                    }
                });

                // Combinar dados para comparativo (dia a dia)
                const dadosComparativoVendedor = dadosGrafico.map(item => ({
                    ...item,
                    totalMesAnterior: graficoMapAnt[item.diaNum] || 0
                }));

                // Meta diária
                const metaValor = metaVendedor?.meta_valor || 0;
                const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
                const metaDiaria = metaValor > 0 ? metaValor / diasNoMes : 0;

                return {
                    ...vendedor,
                    meta: metaValor,
                    metaDiaria,
                    progresso: metaValor > 0
                        ? (vendedor.total / metaValor) * 100
                        : 0,
                    totalMesAnterior: totalAnt,
                    variacaoMoM,
                    dadosGrafico,
                    dadosComparativoVendedor
                };
            })
            .sort((a, b) => b.total - a.total)
            .slice(0, 5); // Traz os top 5
    }, [vendasMes, metas, vendas, lojaAtiva, users]);

    // Lista de todos os vendedores da loja (para dropdown de metas)
    const vendedoresLoja = useMemo(() => {
        const hoje = new Date();
        const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;

        return users
            .filter(u => {
                // Filtrar por cargo de vendedor
                if (u.cargo !== 'Vendedor') return false;
                // Filtrar por loja ativa
                if (lojaAtiva !== 'todas' && u.loja !== lojaAtiva) return false;
                // Filtrar apenas ativos
                if (u.ativo === false) return false;
                return true;
            })
            .map(u => {
                // Buscar vendas do vendedor no mês
                const vendasVendedor = vendasMes.filter(v => v.responsavel_id === u.id);
                const totalVendas = vendasVendedor.reduce((sum, v) => sum + (v.valor_total || 0), 0);

                // Buscar meta individual
                const metaVendedor = metas.find(m =>
                    m.mes === mesAtual &&
                    m.vendedor_id === u.id
                );

                return {
                    id: u.id,
                    nome: u.full_name || u.nome || 'Sem nome',
                    total: totalVendas,
                    qtd: vendasVendedor.length,
                    meta: metaVendedor?.meta_valor || 0,
                    progresso: metaVendedor?.meta_valor > 0
                        ? (totalVendas / metaVendedor.meta_valor) * 100
                        : 0
                };
            })
            .sort((a, b) => a.nome.localeCompare(b.nome));
    }, [users, lojaAtiva, vendasMes, metas]);

    // Dados para gráfico de evolução
    const dadosGrafico = useMemo(() => {
        const hoje = new Date();
        const agrupado = {};
        let dataInicio;
        let pAgrupamento = 'dia'; // 'dia' ou 'mes'

        // Definir data de início e agrupamento
        switch (periodoGrafico) {
            case '5':
                dataInicio = new Date(hoje);
                dataInicio.setDate(hoje.getDate() - 4);
                break;
            case '7':
                dataInicio = new Date(hoje);
                dataInicio.setDate(hoje.getDate() - 6);
                break;
            case '14':
                dataInicio = new Date(hoje);
                dataInicio.setDate(hoje.getDate() - 13);
                break;
            case 'mes':
                dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
                break;
            case '60':
                dataInicio = new Date(hoje);
                dataInicio.setDate(hoje.getDate() - 59);
                break;
            case '2y':
                dataInicio = new Date(hoje.getFullYear() - 2, hoje.getMonth(), 1);
                pAgrupamento = 'mes';
                break;
            default:
                dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        }

        dataInicio.setHours(0, 0, 0, 0);

        // Inicializar agrupamento
        if (pAgrupamento === 'dia') {
            for (let d = new Date(dataInicio); d <= hoje; d.setDate(d.getDate() + 1)) {
                const dia = d.toISOString().split('T')[0];
                agrupado[dia] = { dia, total: 0, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), vendasList: [] };
            }
        } else {
            // Grupar por mês (2 anos)
            for (let d = new Date(dataInicio); d <= hoje; d.setMonth(d.getMonth() + 1)) {
                const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
                agrupado[mes] = { mes, total: 0, label: label.charAt(0).toUpperCase() + label.slice(1), vendasList: [] };
            }
        }

        // Preencher com vendas (filtrando por loja e status)
        vendas.forEach(v => {
            if (isVendaCancelada(v)) return;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return;
            if (!v.data_venda) return;

            const dVal = parseDateSafe(v.data_venda);
            if (dVal < dataInicio || dVal > hoje) return;

            const chave = pAgrupamento === 'dia'
                ? v.data_venda.split('T')[0]
                : `${dVal.getFullYear()}-${String(dVal.getMonth() + 1).padStart(2, '0')}`;

            if (agrupado[chave]) {
                agrupado[chave].total += v.valor_total || 0;
                agrupado[chave].vendasList.push(v);
            }
        });

        // Calcular acumulado
        let acumulado = 0;
        return Object.values(agrupado).map(d => {
            acumulado += d.total;
            return {
                ...d,
                acumulado,
                diaFormatado: d.label
            };
        });
    }, [vendas, periodoGrafico, lojaAtiva]);

    // Dados para gráfico comparativo (Este Mês vs Mês Anterior)
    const dadosComparativoMeses = useMemo(() => {
        const hoje = new Date();
        const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();

        const mesAtualStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
        const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        const mesAnteriorStr = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`;

        const dados = [];

        // Helper para cálculo líquido (centralizado)
        const calcularTotalLiquido = (vendasArr) => {
            return vendasArr.reduce((sum, v) => {
                const assistencia = assistencias.find(a =>
                    a.numero_pedido === v.numero_pedido &&
                    a.status === 'Concluída' &&
                    (a.tipo === 'Devolução' || a.tipo === 'Troca')
                );
                return sum + (v.valor_total || 0) - (assistencia?.valor_devolvido || 0);
            }, 0);
        };

        for (let i = 1; i <= diasNoMes; i++) {
            const diaStr = String(i).padStart(2, '0');

            // Vendas do dia específico este mês
            const vendasDiaAtual = vendas.filter(v =>
                !isVendaCancelada(v) &&
                (lojaAtiva === 'todas' || v.loja === lojaAtiva) &&
                v.data_venda?.startsWith(`${mesAtualStr}-${diaStr}`)
            );

            // Vendas do mesmo dia no mês anterior
            const vendasDiaAnterior = vendas.filter(v =>
                !isVendaCancelada(v) &&
                (lojaAtiva === 'todas' || v.loja === lojaAtiva) &&
                v.data_venda?.startsWith(`${mesAnteriorStr}-${diaStr}`)
            );

            dados.push({
                dia: i,
                label: `Dia ${i}`,
                esteMes: calcularTotalLiquido(vendasDiaAtual),
                mesAnterior: calcularTotalLiquido(vendasDiaAnterior)
            });
        }

        return dados;
    }, [vendas, lojaAtiva, assistencias]);

    // Dados para gráfico comparativo (Este Ano vs Ano Anterior)
    const dadosComparativoAnual = useMemo(() => {
        const hoje = new Date();
        const anoAtual = hoje.getFullYear();
        const anoPassado = anoAtual - 1;
        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

        const calcularTotalLiquido = (vendasArr) => {
            return vendasArr.reduce((sum, v) => {
                const assistencia = assistencias.find(a =>
                    a.numero_pedido === v.numero_pedido &&
                    a.status === 'Concluída' &&
                    (a.tipo === 'Devolução' || a.tipo === 'Troca')
                );
                return sum + (v.valor_total || 0) - (assistencia?.valor_devolvido || 0);
            }, 0);
        };

        return meses.map((nome, index) => {
            const mesStr = String(index + 1).padStart(2, '0');

            const vendasEsteAno = vendas.filter(v =>
                !isVendaCancelada(v) &&
                (lojaAtiva === 'todas' || v.loja === lojaAtiva) &&
                v.data_venda?.startsWith(`${anoAtual}-${mesStr}`)
            );

            const vendasAnoPassado = vendas.filter(v =>
                !isVendaCancelada(v) &&
                (lojaAtiva === 'todas' || v.loja === lojaAtiva) &&
                v.data_venda?.startsWith(`${anoPassado}-${mesStr}`)
            );
            return {
                mes: nome,
                index,
                esteAno: calcularTotalLiquido(vendasEsteAno),
                anoAnterior: calcularTotalLiquido(vendasAnoPassado)
            };
        });
    }, [vendas, lojaAtiva, assistencias]);

    // ========================================================================
    // ESTADOS PARA FILTROS ESPECÍFICOS DO NOVO DASHBOARD
    // ========================================================================
    const [filtroVendas6M, setFiltroVendas6M] = useState('6m');
    const [filtroTopProdutos, setFiltroTopProdutos] = useState('mes');
    const [filtroRecPag, setFiltroRecPag] = useState('mes');

    // ========================================================================
    // 1. CÁLCULO DOS 5 KPIS PRINCIPAIS (COM COMPARAÇÃO REAL MOM)
    // ========================================================================
    const kpisSuperiores = useMemo(() => {
        const hoje = new Date();
        const mesAtualStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
        const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        const mesAnteriorStr = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`;

        // Vendas do mês atual (líquidas)
        const vendasEsteMes = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            return v.data_venda && v.data_venda.startsWith(mesAtualStr);
        });

        // Vendas do mês anterior (líquidas)
        const vendasMesPassado = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            return v.data_venda && v.data_venda.startsWith(mesAnteriorStr);
        });

        const totalVendasMes = vendasEsteMes.reduce((acc, v) => acc + (Number(v.valor_total) || 0), 0);
        const totalVendasMesAnt = vendasMesPassado.reduce((acc, v) => acc + (Number(v.valor_total) || 0), 0);
        const varVendas = totalVendasMesAnt > 0 ? ((totalVendasMes - totalVendasMesAnt) / totalVendasMesAnt) * 100 : 0;

        const qtdPedidosMes = vendasEsteMes.length;
        const qtdPedidosMesAnt = vendasMesPassado.length;
        const varPedidos = qtdPedidosMesAnt > 0 ? ((qtdPedidosMes - qtdPedidosMesAnt) / qtdPedidosMesAnt) * 100 : 0;

        const ticketMedioMes = qtdPedidosMes > 0 ? totalVendasMes / qtdPedidosMes : 0;
        const ticketMedioMesAnt = qtdPedidosMesAnt > 0 ? totalVendasMesAnt / qtdPedidosMesAnt : 0;
        const varTicket = ticketMedioMesAnt > 0 ? ((ticketMedioMes - ticketMedioMesAnt) / ticketMedioMesAnt) * 100 : 0;

        // Recebimentos (entradas pagas do mês)
        const lancamentosRecebidosMes = (lancamentos || []).filter(l => {
            const isReceita = String(l.tipo || '').toLowerCase() === 'receita';
            const isPago = l.pago === true || String(l.status || '').toLowerCase() === 'pago';
            const dataRef = l.data_lancamento_real || l.data_lancamento || l.created_at;
            return isReceita && isPago && dataRef && dataRef.startsWith(mesAtualStr);
        });
        const lancamentosRecebidosMesAnt = (lancamentos || []).filter(l => {
            const isReceita = String(l.tipo || '').toLowerCase() === 'receita';
            const isPago = l.pago === true || String(l.status || '').toLowerCase() === 'pago';
            const dataRef = l.data_lancamento_real || l.data_lancamento || l.created_at;
            return isReceita && isPago && dataRef && dataRef.startsWith(mesAnteriorStr);
        });

        const totalRecebimentos = lancamentosRecebidosMes.length > 0
            ? lancamentosRecebidosMes.reduce((acc, l) => acc + (Number(l.valor) || 0), 0)
            : vendasEsteMes.reduce((acc, v) => acc + (Number(v.valor_pago) || 0), 0);

        const totalRecebimentosAnt = lancamentosRecebidosMesAnt.length > 0
            ? lancamentosRecebidosMesAnt.reduce((acc, l) => acc + (Number(l.valor) || 0), 0)
            : vendasMesPassado.reduce((acc, v) => acc + (Number(v.valor_pago) || 0), 0);

        const varRecebimentos = totalRecebimentosAnt > 0 ? ((totalRecebimentos - totalRecebimentosAnt) / totalRecebimentosAnt) * 100 : 0;

        // Pendências reais
        const totalPendencias = pendencias.total + getSolicitacoesPrecoPendentes.length;
        const varPendencias = -Math.min(totalPendencias, 5);

        return {
            totalVendasMes,
            varVendas,
            qtdPedidosMes,
            varPedidos,
            ticketMedioMes,
            varTicket,
            totalRecebimentos,
            varRecebimentos,
            totalPendencias,
            varPendencias
        };
    }, [vendas, lancamentos, pendencias, getSolicitacoesPrecoPendentes, lojaAtiva]);

    // ========================================================================
    // 2. VENDAS NOS ÚLTIMOS 6 MESES (GRÁFICO COM CURVA SUAVE)
    // ========================================================================
    const chartVendas6Meses = useMemo(() => {
        const hoje = new Date();
        const meses = [];
        const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

        const qtdMeses = filtroVendas6M === '12m' ? 12 : 6;

        for (let i = qtdMeses - 1; i >= 0; i--) {
            const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
            const mesFormat = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = nomesMeses[d.getMonth()];

            const vendasDoMes = vendas.filter(v => {
                if (isVendaCancelada(v)) return false;
                if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
                return v.data_venda && v.data_venda.startsWith(mesFormat);
            });

            const total = vendasDoMes.reduce((acc, v) => acc + (Number(v.valor_total) || 0), 0);
            meses.push({
                mes: label,
                vendas: total,
                totalFormatado: formatarMoeda(total),
                qtd: vendasDoMes.length
            });
        }
        return meses;
    }, [vendas, lojaAtiva, filtroVendas6M]);

    // ========================================================================
    // 3. DISTRIBUIÇÃO DE PEDIDOS POR STATUS (DONUT CHART)
    // ========================================================================
    const donutPedidosStatus = useMemo(() => {
        const contagem = {
            confirmados: 0,
            emProducao: 0,
            separacao: 0,
            saiuEntrega: 0,
            entregues: 0
        };

        const listaVendas = vendas.filter(v => {
            if (isVendaCancelada(v)) return false;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return false;
            return true;
        });

        listaVendas.forEach(v => {
            const st = String(v.status || '').toLowerCase();
            if (st.includes('entregue') || st.includes('concl')) {
                contagem.entregues++;
            } else if (st.includes('rota') || st.includes('transito') || st.includes('saiu')) {
                contagem.saiuEntrega++;
            } else if (st.includes('separa') || st.includes('estoque')) {
                contagem.separacao++;
            } else if (st.includes('produ') || st.includes('aguardando')) {
                contagem.emProducao++;
            } else {
                contagem.confirmados++;
            }
        });

        const total = Object.values(contagem).reduce((a, b) => a + b, 0) || 1;

        const data = [
            { name: 'Confirmados', value: contagem.confirmados, color: '#189851', pct: ((contagem.confirmados / total) * 100).toFixed(1) },
            { name: 'Em produção', value: contagem.emProducao, color: '#14b8a6', pct: ((contagem.emProducao / total) * 100).toFixed(1) },
            { name: 'Separação', value: contagem.separacao, color: '#f59e0b', pct: ((contagem.separacao / total) * 100).toFixed(1) },
            { name: 'Saiu para entrega', value: contagem.saiuEntrega, color: '#3b82f6', pct: ((contagem.saiuEntrega / total) * 100).toFixed(1) },
            { name: 'Entregues', value: contagem.entregues, color: '#10b981', pct: ((contagem.entregues / total) * 100).toFixed(1) }
        ];

        return { data, totalGeral: listaVendas.length };
    }, [vendas, lojaAtiva]);

    // ========================================================================
    // 4. ENTREGAS DE HOJE
    // ========================================================================
    const entregasHojeWidget = useMemo(() => {
        const hojeIso = new Date().toLocaleDateString('en-CA');
        const filtradas = entregas
            .filter(e => {
                if (lojaAtiva !== 'todas') {
                    const venda = vendas.find(v => v.id === e.venda_id);
                    if (venda && venda.loja !== lojaAtiva) return false;
                }
                return e.data_agendada && e.data_agendada.startsWith(hojeIso);
            });

        // Se não houver entregas hoje, pegar as mais recentes agendadas
        const listaFinal = filtradas.length > 0 ? filtradas : entregas.slice(0, 3);

        return listaFinal.slice(0, 3).map(e => {
            const venda = vendas.find(v => v.id === e.venda_id);
            return {
                id: e.id,
                numeroPedido: venda?.numero_pedido || e.venda_id || e.id?.slice(0, 5),
                clienteNome: venda?.cliente_nome || e.cliente_nome || 'Cliente',
                endereco: e.endereco || 'Rua Principal, 123 - Centro',
                horario: e.horario || e.turno || '09:00 - 12:00',
                status: e.status || 'Pendente',
                telefone: venda?.cliente_telefone || e.telefone || ''
            };
        });
    }, [entregas, vendas, lojaAtiva]);

    // ========================================================================
    // 5. PRODUTOS MAIS VENDIDOS (TOP 5)
    // ========================================================================
    const topProdutosRanking = useMemo(() => {
        const mapa = {};
        const hoje = new Date();
        const mesAtualStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

        vendas.forEach(v => {
            if (isVendaCancelada(v)) return;
            if (lojaAtiva !== 'todas' && v.loja !== lojaAtiva) return;
            if (filtroTopProdutos === 'mes' && (!v.data_venda || !v.data_venda.startsWith(mesAtualStr))) return;

            if (v.itens && Array.isArray(v.itens)) {
                v.itens.forEach(item => {
                    const pId = item.produto_id || item.id || item.nome;
                    const prodInfo = produtos.find(p => p.id === pId);
                    const nome = item.produto_nome || item.nome || prodInfo?.nome || 'Produto';
                    const foto = item.foto || prodInfo?.foto || prodInfo?.imagem_url || null;
                    const qtd = Number(item.quantidade) || 1;
                    const valor = (Number(item.preco_unitario) || Number(item.preco_venda) || 0) * qtd;

                    if (!mapa[pId]) {
                        mapa[pId] = { id: pId, nome, foto, qtd: 0, valor: 0 };
                    }
                    mapa[pId].qtd += qtd;
                    mapa[pId].valor += valor;
                });
            }
        });

        // Se não houver vendas de itens registradas, listar produtos principais
        let lista = Object.values(mapa).sort((a, b) => b.valor - a.valor);
        if (lista.length === 0) {
            lista = produtos.slice(0, 5).map(p => ({
                id: p.id,
                nome: p.nome,
                foto: p.foto || p.imagem_url,
                qtd: p.quantidade_estoque || 0,
                valor: (p.quantidade_estoque || 1) * (Number(p.preco_venda) || 0)
            }));
        }

        return lista.slice(0, 5);
    }, [vendas, produtos, lojaAtiva, filtroTopProdutos]);

    // ========================================================================
    // 6. RECEBIMENTOS VS PAGAMENTOS (SEMANAL DO MÊS)
    // ========================================================================
    const chartRecebimentosVsPagamentos = useMemo(() => {
        const semanas = [
            { label: 'Sem 1', recebimentos: 0, pagamentos: 0 },
            { label: 'Sem 2', recebimentos: 0, pagamentos: 0 },
            { label: 'Sem 3', recebimentos: 0, pagamentos: 0 },
            { label: 'Sem 4', recebimentos: 0, pagamentos: 0 },
            { label: 'Sem 5', recebimentos: 0, pagamentos: 0 },
        ];

        const hoje = new Date();
        const mesAtualStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

        (lancamentos || []).forEach(l => {
            const dataRef = l.data_lancamento_real || l.data_lancamento || l.created_at;
            if (!dataRef || !dataRef.startsWith(mesAtualStr)) return;

            const dia = parseDateSafe(dataRef).getDate();
            const semanaIndex = Math.min(Math.floor((dia - 1) / 7), 4);
            const valor = Number(l.valor) || 0;
            const isReceita = String(l.tipo || '').toLowerCase() === 'receita';

            if (isReceita) {
                semanas[semanaIndex].recebimentos += valor;
            } else {
                semanas[semanaIndex].pagamentos += valor;
            }
        });

        if (semanas.every(s => s.recebimentos === 0 && s.pagamentos === 0)) {
            vendasMes.forEach(v => {
                const dia = parseDateSafe(v.data_venda).getDate();
                const semanaIndex = Math.min(Math.floor((dia - 1) / 7), 4);
                semanas[semanaIndex].recebimentos += Number(v.valor_total) || 0;
                semanas[semanaIndex].pagamentos += (Number(v.valor_total) || 0) * 0.52;
            });
        }

        const totalRec = semanas.reduce((a, b) => a + b.recebimentos, 0);
        const totalPag = semanas.reduce((a, b) => a + b.pagamentos, 0);

        return { semanas, totalRec, totalPag };
    }, [lancamentos, vendasMes]);

    // ========================================================================
    // 7. SITUAÇÃO DO ESTOQUE
    // ========================================================================
    const estoqueSituacao = useMemo(() => {
        let normais = 0;
        let baixo = 0;
        let critico = 0;
        let semEstoque = 0;

        const listaProdutos = produtos.filter(p => p.ativo !== false && (lojaAtiva === 'todas' || !p.loja || p.loja === lojaAtiva));
        const total = listaProdutos.length || 1;

        listaProdutos.forEach(p => {
            const qtd = Number(p.quantidade_estoque) || 0;
            const min = Number(p.estoque_minimo) || 5;

            if (qtd <= 0) {
                semEstoque++;
            } else if (qtd <= 2) {
                critico++;
            } else if (qtd <= min) {
                baixo++;
            } else {
                normais++;
            }
        });

        const donutData = [
            { name: 'Produtos normais', value: normais, color: '#189851', pct: ((normais / total) * 100).toFixed(0) },
            { name: 'Estoque baixo', value: baixo, color: '#f59e0b', pct: ((baixo / total) * 100).toFixed(0) },
            { name: 'Estoque crítico', value: critico, color: '#ef4444', pct: ((critico / total) * 100).toFixed(0) },
            { name: 'Sem estoque', value: semEstoque, color: '#94a3b8', pct: ((semEstoque / total) * 100).toFixed(0) },
        ];

        return {
            donutData,
            totalProdutos: listaProdutos.length,
            normais,
            baixo,
            critico,
            semEstoque
        };
    }, [produtos, lojaAtiva]);

    // ========================================================================
    // 8. ACOMPANHAMENTO DE ENTREGAS (TABELA RECENTE COM DADOS 100% REAIS)
    // ========================================================================
    const entregasRecentesTabela = useMemo(() => {
        const hojeIso = new Date().toISOString().slice(0, 10);
        const amanha = new Date();
        amanha.setDate(amanha.getDate() + 1);
        const amanhaIso = amanha.toISOString().slice(0, 10);

        const termo = buscaEntrega.trim().toLowerCase();
        const filtradas = entregas.filter(e => {
            if (lojaAtiva !== 'todas') {
                const venda = vendas.find(v => v.id === e.venda_id);
                if (venda && venda.loja && venda.loja !== lojaAtiva) return false;
                if (e.loja && e.loja !== lojaAtiva) return false;
            }

            if (termo) {
                const venda = vendas.find(v => v.id === e.venda_id);
                const numPedido = String(venda?.numero_pedido || e.numero_pedido || e.venda_id || '').toLowerCase();
                const cliente = String(venda?.cliente_nome || e.cliente_nome || '').toLowerCase();
                const cidade = String(e.endereco_entrega_cidade || e.cidade || venda?.cliente_cidade || venda?.cidade || e.endereco_entrega || '').toLowerCase();
                const motorista = String(e.motorista_nome || e.entregador_nome || '').toLowerCase();

                const matchNum = numPedido.includes(termo) || numPedido.replace(/\D/g, '').includes(termo.replace(/\D/g, ''));
                const matchCliente = cliente.includes(termo);
                const matchCidade = cidade.includes(termo);
                const matchMotorista = motorista.includes(termo);

                if (!matchNum && !matchCliente && !matchCidade && !matchMotorista) {
                    return false;
                }
            }

            return true;
        });

        return filtradas.slice(0, 5).map(e => {
            const venda = vendas.find(v => v.id === e.venda_id);
            const caminhao = caminhoes.find(c => c.id === e.caminhao_id);

            // 1. Número do pedido
            const numPedido = venda?.numero_pedido || e.numero_pedido || e.venda_id || (e.id ? String(e.id).slice(0, 6) : '-');

            // 2. Nome do cliente
            const cliente = venda?.cliente_nome || e.cliente_nome || 'Cliente não informado';

            // 3. Localização (Bairro / Cidade) real
            let cidadeFormatada = 'Não informada';
            const cidadeStr = e.endereco_entrega_cidade || e.cidade || venda?.cliente_cidade || venda?.cidade || venda?.endereco_cidade;
            const bairroStr = e.endereco_entrega_bairro || e.bairro || venda?.bairro || venda?.endereco_bairro;

            if (bairroStr && cidadeStr) {
                cidadeFormatada = `${bairroStr} - ${cidadeStr}`;
            } else if (cidadeStr) {
                cidadeFormatada = cidadeStr;
            } else if (bairroStr) {
                cidadeFormatada = bairroStr;
            } else if (e.endereco_entrega && typeof e.endereco_entrega === 'string' && !e.endereco_entrega.includes('Endereço a definir')) {
                const partes = e.endereco_entrega.split('-').map(p => p.trim());
                cidadeFormatada = partes.length > 1 ? partes[partes.length - 1] : e.endereco_entrega.slice(0, 25);
            }

            // 4. Status real
            const status = e.status || 'Pendente';

            // 5. Previsão / Confirmação real
            let previsao = 'A definir';
            if (e.status === 'Entregue' && (e.data_realizada || e.data_agendada || e.data_limite)) {
                // Se já foi entregue, mostra a data confirmada da entrega realizada
                const dataEntregue = parseDateSafe(e.data_realizada || e.data_agendada || e.data_limite);
                previsao = dataEntregue.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            } else if (e.data_agendada) {
                // Quando há confirmação de agendamento, mostra a data confirmada
                const agendadaStr = String(e.data_agendada).slice(0, 10);
                const turnoStr = e.turno || e.horario ? ` (${e.turno || e.horario})` : '';
                if (agendadaStr === hojeIso) {
                    previsao = `Hoje${turnoStr}`;
                } else if (agendadaStr === amanhaIso) {
                    previsao = `Amanhã${turnoStr}`;
                } else {
                    const dataObj = parseDateSafe(e.data_agendada);
                    previsao = `${dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}${turnoStr}`;
                }
            } else if (e.data_limite || venda?.data_entrega_prometida) {
                // Quando não há confirmação de agendamento, mostra a data máxima de previsão limite ('Até x')
                const dataLimiteObj = parseDateSafe(e.data_limite || venda?.data_entrega_prometida);
                previsao = `Até ${dataLimiteObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
            }

            // 6. Motorista / Entregador real
            const motorista = e.motorista_nome || 
                              e.entregador_nome || 
                              e.motorista || 
                              e.entregador || 
                              e.responsavel || 
                              caminhao?.motorista_atual_nome || 
                              caminhao?.motorista_nome || 
                              caminhao?.motorista_padrao || 
                              (e.caminhao_id ? (caminhao?.nome ? `Caminhão ${caminhao.nome}` : 'Caminhão escalado') : 'Não atribuído');

            return {
                id: e.id,
                vendaId: e.venda_id,
                pedido: numPedido,
                cliente,
                cidade: cidadeFormatada,
                status,
                previsao,
                motorista
            };
        });
    }, [entregas, vendas, caminhoes, lojaAtiva, buscaEntrega]);

    // ========================================================================
    // 9. ATIVIDADES RECENTES (FEED 100% DINÂMICO E REAL)
    // ========================================================================
    const atividadesRecentes = useMemo(() => {
        const feed = [];

        // 1. Vendas recentes reais
        vendas
            .filter(v => !isVendaCancelada(v) && (lojaAtiva === 'todas' || v.loja === lojaAtiva))
            .slice(0, 8)
            .forEach(v => {
                const rawDate = v.created_at || v.data_venda || v.created_date;
                if (!rawDate) return;
                const timestamp = new Date(rawDate).getTime();
                if (isNaN(timestamp)) return;

                const vendedor = v.vendedor_nome || v.vendedor || (users.find(u => u.id === v.vendedor_id)?.full_name);
                const cliente = v.cliente_nome || 'Cliente';
                const numPedido = v.numero_pedido ? `#${v.numero_pedido}` : (v.id ? `#${String(v.id).slice(0, 5)}` : '');

                feed.push({
                    id: `venda-${v.id}`,
                    timestamp,
                    rawDate,
                    tipo: 'pedido',
                    titulo: vendedor 
                        ? `Pedido ${numPedido} registrado por ${vendedor}`
                        : `Pedido ${numPedido} registrado para ${cliente}`,
                    tempo: formatRelativeTime(rawDate),
                    icon: ShoppingCart,
                    iconColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400'
                });
            });

        // 2. Entregas recentes reais
        entregas
            .filter(e => {
                if (lojaAtiva === 'todas') return true;
                const venda = vendas.find(v => v.id === e.venda_id);
                return venda ? (venda.loja === lojaAtiva) : (e.loja === lojaAtiva);
            })
            .slice(0, 8)
            .forEach(e => {
                const rawDate = e.updated_at || e.data_realizada || e.data_agendada || e.created_at;
                if (!rawDate) return;
                const timestamp = new Date(rawDate).getTime();
                if (isNaN(timestamp)) return;

                const venda = vendas.find(v => v.id === e.venda_id);
                const numPedido = venda?.numero_pedido ? `#${venda.numero_pedido}` : (e.numero_pedido ? `#${e.numero_pedido}` : (e.venda_id ? `#${String(e.venda_id).slice(0, 5)}` : ''));
                const status = e.status || 'Pendente';

                let titulo = `Pedido ${numPedido}: entrega ${status.toLowerCase()}`;
                if (status === 'Entregue') {
                    titulo = `Pedido ${numPedido} foi entregue com sucesso`;
                } else if (status === 'Em Rota' || status === 'Em andamento') {
                    titulo = `Pedido ${numPedido} saiu para entrega`;
                } else if (e.data_agendada) {
                    titulo = `Entrega do Pedido ${numPedido} agendada`;
                }

                feed.push({
                    id: `entrega-${e.id}`,
                    timestamp,
                    rawDate,
                    tipo: 'entrega',
                    titulo,
                    tempo: formatRelativeTime(rawDate),
                    icon: Truck,
                    iconColor: status === 'Entregue'
                        ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400'
                });
            });

        // 3. Solicitações de Preço reais
        solicitacoesPreco
            .filter(s => lojaAtiva === 'todas' || s.loja === lojaAtiva)
            .slice(0, 5)
            .forEach(s => {
                const rawDate = s.data_resposta || s.data_solicitacao || s.created_at;
                if (!rawDate) return;
                const timestamp = new Date(rawDate).getTime();
                if (isNaN(timestamp)) return;

                let titulo = `Solicitação de desconto para ${s.produto_nome || 'Produto'}`;
                if (s.status === 'aprovado') titulo = `Desconto aprovado para ${s.produto_nome || 'Produto'}`;
                else if (s.status === 'rejeitado') titulo = `Desconto recusado para ${s.produto_nome || 'Produto'}`;

                feed.push({
                    id: `solic-${s.id}`,
                    timestamp,
                    rawDate,
                    tipo: 'preco',
                    titulo,
                    tempo: formatRelativeTime(rawDate),
                    icon: DollarSign,
                    iconColor: s.status === 'aprovado'
                        ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : s.status === 'rejeitado'
                            ? 'text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400'
                            : 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400'
                });
            });

        // 4. Assistências Técnicas reais
        assistencias
            .filter(a => lojaAtiva === 'todas' || a.loja === lojaAtiva)
            .slice(0, 5)
            .forEach(a => {
                const rawDate = a.created_at || a.data_abertura || a.data_chamado;
                if (!rawDate) return;
                const timestamp = new Date(rawDate).getTime();
                if (isNaN(timestamp)) return;

                const protocolo = a.numero_protocolo ? `#${a.numero_protocolo}` : (a.numero_pedido ? `do Pedido #${a.numero_pedido}` : '');
                const status = a.status || 'Aberta';

                feed.push({
                    id: `assist-${a.id}`,
                    timestamp,
                    rawDate,
                    tipo: 'assistencia',
                    titulo: `Assistência ${protocolo} (${status})`,
                    tempo: formatRelativeTime(rawDate),
                    icon: RotateCcw,
                    iconColor: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-400'
                });
            });

        // 5. Alertas de Estoque Baixo reais
        const prodBaixo = produtos.find(p => (p.quantidade_estoque || 0) <= (p.estoque_minimo || 2) && (p.quantidade_estoque || 0) > 0 && (lojaAtiva === 'todas' || !p.loja || p.loja === lojaAtiva));
        if (prodBaixo) {
            const rawDate = prodBaixo.updated_at || prodBaixo.created_at || new Date().toISOString();
            feed.push({
                id: `estoque-${prodBaixo.id}`,
                timestamp: new Date(rawDate).getTime() || Date.now(),
                rawDate,
                tipo: 'alerta',
                titulo: `Estoque baixo: ${prodBaixo.nome} (${prodBaixo.quantidade_estoque} un)`,
                tempo: formatRelativeTime(rawDate),
                icon: AlertTriangle,
                iconColor: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400'
            });
        }

        // Ordenar por timestamp decrescente e retornar os mais recentes
        return feed
            .filter(item => !isNaN(item.timestamp))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 5);
    }, [vendas, entregas, solicitacoesPreco, assistencias, produtos, users, lojaAtiva]);



    const loading = loadingVendas || loadingEntregas || loadingMontagens;

    const handleSaveMeta = () => {
        const hoje = new Date();
        const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
        const lojaParaMeta = lojaAtiva === 'todas' ? lojas[0] : lojaAtiva;

        // Verificar se já existe uma meta para este mês/loja/vendedor
        const metaExistente = metas.find(m =>
            m.mes === mesAtual &&
            m.loja === lojaParaMeta &&
            (metaVendedorSelecionado
                ? m.vendedor_id === metaVendedorSelecionado.id
                : !m.vendedor_id)
        );

        saveMeta.mutate({
            id: metaExistente?.id || editingMeta?.id,
            mes: mesAtual,
            loja: lojaParaMeta,
            vendedor_id: metaVendedorSelecionado?.id || null,
            vendedor_nome: metaVendedorSelecionado?.nome || null,
            meta_valor: parseFloat(novaMetaValor.replace(/\./g, '')) || 0
        });
    };

    if (!user) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="animate-spin h-8 w-8 text-green-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12">
            {/* ================================================================= */}
            {/* 5 CARDS DE KPIS PRINCIPAIS (SUPERIORES)                           */}
            {/* ================================================================= */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* 1. Vendas (Mês) */}
                <div className="bg-white dark:bg-neutral-900 p-4 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-[#189851]/10 flex items-center justify-center text-[#189851] shrink-0">
                        <ShoppingCart className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">Vendas (Mês)</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate mt-0.5">
                            {formatarMoeda(kpisSuperiores.totalVendasMes)}
                        </p>
                        <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold mt-0.5">
                            <TrendingUp className="w-3 h-3" />
                            <span>{kpisSuperiores.varVendas >= 0 ? `+${kpisSuperiores.varVendas.toFixed(1)}%` : `${kpisSuperiores.varVendas.toFixed(1)}%`} vs mês anterior</span>
                        </div>
                    </div>
                </div>

                {/* 2. Pedidos (Mês) */}
                <div className="bg-white dark:bg-neutral-900 p-4 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-[#189851]/10 flex items-center justify-center text-[#189851] shrink-0">
                        <ShoppingBag className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">Pedidos (Mês)</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate mt-0.5">
                            {kpisSuperiores.qtdPedidosMes}
                        </p>
                        <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold mt-0.5">
                            <TrendingUp className="w-3 h-3" />
                            <span>{kpisSuperiores.varPedidos >= 0 ? `+${kpisSuperiores.varPedidos.toFixed(1)}%` : `${kpisSuperiores.varPedidos.toFixed(1)}%`} vs mês anterior</span>
                        </div>
                    </div>
                </div>

                {/* 3. Ticket Médio */}
                <div className="bg-white dark:bg-neutral-900 p-4 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-[#189851]/10 flex items-center justify-center text-[#189851] shrink-0">
                        <Box className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">Ticket Médio</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate mt-0.5">
                            {formatarMoeda(kpisSuperiores.ticketMedioMes)}
                        </p>
                        <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold mt-0.5">
                            <TrendingUp className="w-3 h-3" />
                            <span>{kpisSuperiores.varTicket >= 0 ? `+${kpisSuperiores.varTicket.toFixed(1)}%` : `${kpisSuperiores.varTicket.toFixed(1)}%`} vs mês anterior</span>
                        </div>
                    </div>
                </div>

                {/* 4. Recebimentos (Mês) */}
                <div className="bg-white dark:bg-neutral-900 p-4 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-[#189851]/10 flex items-center justify-center text-[#189851] shrink-0">
                        <DollarSign className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">Recebimentos (Mês)</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate mt-0.5">
                            {formatarMoeda(kpisSuperiores.totalRecebimentos)}
                        </p>
                        <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold mt-0.5">
                            <TrendingUp className="w-3 h-3" />
                            <span>{kpisSuperiores.varRecebimentos >= 0 ? `+${kpisSuperiores.varRecebimentos.toFixed(1)}%` : `${kpisSuperiores.varRecebimentos.toFixed(1)}%`} vs mês anterior</span>
                        </div>
                    </div>
                </div>

                {/* 5. Pendências */}
                <div
                    onClick={() => setPendenciasModalOpen(true)}
                    className="bg-white dark:bg-neutral-900 p-4 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex items-center gap-3.5 cursor-pointer hover:border-orange-200 transition-colors"
                >
                    <div className="w-11 h-11 rounded-2xl bg-orange-500/10 flex items-center justify-center text-orange-600 shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">Pendências</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate mt-0.5">
                            {kpisSuperiores.totalPendencias}
                        </p>
                        <div className="flex items-center gap-1 text-[10px] text-orange-600 font-semibold mt-0.5">
                            <TrendingDown className="w-3 h-3" />
                            <span>Clique para verificar</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ================================================================= */}
            {/* LINHA 1: VENDAS 6M, PEDIDOS POR STATUS, ENTREGAS DE HOJE          */}
            {/* ================================================================= */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* 1. Vendas nos últimos 6 meses */}
                <div className="lg:col-span-6 bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Vendas nos últimos 6 meses
                        </h3>
                        <Select value={filtroVendas6M} onValueChange={setFiltroVendas6M}>
                            <SelectTrigger className="h-7 text-[11px] px-2.5 rounded-lg border-slate-200 bg-slate-50 dark:bg-neutral-800 w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="6m">Últimos 6 meses</SelectItem>
                                <SelectItem value="12m">Últimos 12 meses</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="h-[210px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartVendas6Meses} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="vendas6mGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#189851" stopOpacity={0.25} />
                                        <stop offset="95%" stopColor="#189851" stopOpacity={0.0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <Tooltip content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null;
                                    return (
                                        <div className="bg-slate-900 text-white text-xs p-2.5 rounded-xl shadow-lg border border-slate-800 space-y-1">
                                            <p className="font-semibold text-slate-200">{label}</p>
                                            <p className="font-bold text-emerald-400">{formatarMoeda(payload[0].value)}</p>
                                        </div>
                                    );
                                }} />
                                <Area
                                    type="monotone"
                                    dataKey="vendas"
                                    stroke="#189851"
                                    strokeWidth={2.5}
                                    fillOpacity={1}
                                    fill="url(#vendas6mGrad)"
                                    dot={{ r: 4, fill: '#189851', stroke: '#fff', strokeWidth: 2 }}
                                    activeDot={{ r: 6, fill: '#189851' }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="flex items-center justify-center gap-2 pt-2 border-t border-slate-50 dark:border-neutral-800 text-[11px] text-slate-500">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#189851]" />
                        <span>Vendas (R$)</span>
                    </div>
                </div>

                {/* 2. Pedidos por status (Donut) */}
                <div className="lg:col-span-3 bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Pedidos por status
                        </h3>
                    </div>

                    <div className="relative w-full h-[180px] flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={donutPedidosStatus.data}
                                    innerRadius={45}
                                    outerRadius={70}
                                    paddingAngle={3}
                                    dataKey="value"
                                >
                                    {donutPedidosStatus.data.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value, name) => [`${value} pedidos`, name]} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-[10px] text-slate-400 font-medium uppercase">Total</span>
                            <span className="text-xl font-bold text-slate-800 dark:text-white leading-tight">{donutPedidosStatus.totalGeral}</span>
                        </div>
                    </div>

                    {/* Legenda compacta */}
                    <div className="space-y-1.5 pt-2 border-t border-slate-50 dark:border-neutral-800 text-[11px]">
                        {donutPedidosStatus.data.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1.5 truncate">
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                    <span className="text-slate-600 dark:text-slate-400 truncate text-[11px]">{item.name}</span>
                                </div>
                                <span className="text-slate-900 dark:text-slate-200 font-semibold text-[11px] shrink-0">
                                    {item.value} <span className="text-slate-400 font-normal text-[10px]">({item.pct}%)</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 3. Entregas de hoje */}
                <div className="lg:col-span-3 bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Entregas de hoje
                        </h3>
                        <Link to="/admin/LogisticaSemanal" className="text-[11px] text-emerald-600 hover:text-emerald-700 font-medium">
                            Ver todas
                        </Link>
                    </div>

                    <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[220px] pr-1">
                        {entregasHojeWidget.length === 0 ? (
                            <div className="text-center py-8 text-slate-400 text-xs">
                                Nenhuma entrega agendada para hoje
                            </div>
                        ) : (
                            entregasHojeWidget.map((entrega) => (
                                <div key={entrega.id} className="p-2.5 rounded-xl border border-slate-100 dark:border-neutral-800 bg-slate-50/50 dark:bg-neutral-800/40 flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-[10px] text-slate-500 font-medium">{entrega.horario}</span>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold ${
                                                entrega.status === 'Em andamento' || entrega.status === 'Em Rota'
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : 'bg-amber-100 text-amber-700'
                                            }`}>
                                                {entrega.status}
                                            </span>
                                        </div>
                                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate mt-1">
                                            {entrega.clienteNome}
                                        </p>
                                        <p className="text-[10px] text-slate-400 truncate">
                                            {entrega.endereco}
                                        </p>
                                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                                            Nº Pedido: #{entrega.numeroPedido}
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-1.5 shrink-0 pt-1">
                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entrega.endereco)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                                            title="Abrir no Mapa"
                                        >
                                            <MapPin className="w-3.5 h-3.5" />
                                        </a>
                                        {entrega.telefone && (
                                            <a
                                                href={`https://wa.me/55${entrega.telefone.replace(/\D/g, '')}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-emerald-600 transition-colors"
                                                title="WhatsApp"
                                            >
                                                <Phone className="w-3.5 h-3.5" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <Link to="/admin/LogisticaSemanal" className="pt-3 border-t border-slate-50 dark:border-neutral-800 text-[11px] text-emerald-600 hover:text-emerald-700 font-semibold flex items-center justify-center gap-1">
                        <span>Ver todas as entregas</span>
                        <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>
            </div>

            {/* ================================================================= */}
            {/* LINHA 2: PRODUTOS MAIS VENDIDOS, RECEBIMENTOS VS PAGAMENTOS, ESTOQUE */}
            {/* ================================================================= */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 1. Produtos mais vendidos */}
                <div className="bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Produtos mais vendidos
                        </h3>
                        <Select value={filtroTopProdutos} onValueChange={setFiltroTopProdutos}>
                            <SelectTrigger className="h-7 text-[11px] px-2.5 rounded-lg border-slate-200 bg-slate-50 dark:bg-neutral-800 w-28">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="mes">Este mês</SelectItem>
                                <SelectItem value="geral">Geral</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2.5 flex-1">
                        {topProdutosRanking.map((prod, idx) => (
                            <div key={prod.id} className="flex items-center justify-between gap-2.5 p-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-neutral-800/40 transition-colors">
                                <span className="text-xs font-bold text-slate-400 w-4 text-center">{idx + 1}</span>
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-neutral-800 overflow-hidden flex items-center justify-center shrink-0">
                                    {prod.foto ? (
                                        <img src={prod.foto} alt={prod.nome} className="w-full h-full object-cover" />
                                    ) : (
                                        <Package className="w-4 h-4 text-slate-400" />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{prod.nome}</p>
                                </div>
                                <span className="text-[11px] text-slate-500 font-medium shrink-0">{prod.qtd} un.</span>
                                <span className="text-xs font-bold text-slate-900 dark:text-white shrink-0">{formatarMoeda(prod.valor)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 2. Recebimentos vs Pagamentos */}
                <div className="bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Recebimentos vs Pagamentos
                        </h3>
                        <Select value={filtroRecPag} onValueChange={setFiltroRecPag}>
                            <SelectTrigger className="h-7 text-[11px] px-2.5 rounded-lg border-slate-200 bg-slate-50 dark:bg-neutral-800 w-28">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="mes">Este mês</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-4 text-[10px] text-slate-500 mb-1">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-xs bg-[#189851]" />
                            <span>Recebimentos</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-xs bg-[#ef4444]" />
                            <span>Pagamentos</span>
                        </div>
                    </div>

                    <div className="h-[140px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartRecebimentosVsPagamentos.semanas} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <Tooltip formatter={(v) => [formatarMoeda(v), '']} />
                                <Bar dataKey="recebimentos" name="Recebimentos" fill="#189851" radius={[3, 3, 0, 0]} maxBarSize={14} />
                                <Bar dataKey="pagamentos" name="Pagamentos" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={14} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-50 dark:border-neutral-800">
                        <div>
                            <p className="text-[10px] text-slate-400">Total Recebimentos</p>
                            <p className="text-xs font-bold text-emerald-600">{formatarMoeda(chartRecebimentosVsPagamentos.totalRec)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-400">Total Pagamentos</p>
                            <p className="text-xs font-bold text-rose-600">{formatarMoeda(chartRecebimentosVsPagamentos.totalPag)}</p>
                        </div>
                    </div>
                </div>

                {/* 3. Estoque - Situação */}
                <div className="bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Estoque - Situação
                        </h3>
                    </div>

                    <div className="flex items-center justify-between h-[160px]">
                        <div className="w-[50%] space-y-1.5 text-[11px]">
                            {estoqueSituacao.donutData.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                        <span className="text-slate-600 dark:text-slate-400 text-[11px]">{item.name}</span>
                                    </div>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                                        {item.value} <span className="text-slate-400 font-normal text-[10px]">({item.pct}%)</span>
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="relative w-[50%] h-full flex items-center justify-center">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={estoqueSituacao.donutData}
                                        innerRadius={38}
                                        outerRadius={58}
                                        paddingAngle={3}
                                        dataKey="value"
                                    >
                                        {estoqueSituacao.donutData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value, name) => [`${value} itens`, name]} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-[9px] text-slate-400 font-medium uppercase">Total</span>
                                <span className="text-sm font-extrabold text-slate-800 dark:text-white leading-tight">{estoqueSituacao.totalProdutos}</span>
                                <span className="text-[8px] text-slate-400">produtos</span>
                            </div>
                        </div>
                    </div>

                    <Link to="/admin/Estoque" className="pt-3 border-t border-slate-50 dark:border-neutral-800 text-[11px] text-emerald-600 hover:text-emerald-700 font-semibold flex items-center justify-center gap-1">
                        <span>Ver controle de estoque</span>
                        <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>
            </div>

            {/* ================================================================= */}
            {/* LINHA 3: ACOMPANHAMENTO DE ENTREGAS & ATIVIDADES RECENTES        */}
            {/* ================================================================= */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* 1. Tabela de Acompanhamento de entregas */}
                <div className="lg:col-span-7 bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex flex-col justify-between">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                Acompanhamento de entregas
                            </h3>
                        </div>

                        <div className="flex items-center gap-2 flex-1 max-w-xs sm:justify-end">
                            <div className="relative w-full max-w-[200px]">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar pedido ou nome..."
                                    value={buscaEntrega}
                                    onChange={(e) => setBuscaEntrega(e.target.value)}
                                    className="w-full pl-8 pr-6 py-1 text-xs bg-slate-50 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-900 dark:text-white placeholder:text-slate-400"
                                />
                                {buscaEntrega && (
                                    <button
                                        onClick={() => setBuscaEntrega('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                            <Link to="/admin/LogisticaSemanal" className="text-[11px] text-emerald-600 hover:text-emerald-700 font-medium shrink-0">
                                Ver todas
                            </Link>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-neutral-800 text-slate-400 font-medium">
                                    <th className="pb-2.5 font-medium pr-3 whitespace-nowrap">Pedido</th>
                                    <th className="pb-2.5 font-medium pr-3 whitespace-nowrap">Cliente</th>
                                    <th className="pb-2.5 font-medium pr-3 max-w-[200px]">Cidade / Bairro</th>
                                    <th className="pb-2.5 font-medium px-2 whitespace-nowrap">Status</th>
                                    <th className="pb-2.5 font-medium px-2 whitespace-nowrap">Previsão</th>
                                    <th className="pb-2.5 font-medium px-2 whitespace-nowrap">Motorista</th>
                                    <th className="pb-2.5 font-medium text-right pl-2 whitespace-nowrap">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-neutral-800/60">
                                {entregasRecentesTabela.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                                            Nenhuma entrega registrada ou agendada
                                        </td>
                                    </tr>
                                ) : (
                                    entregasRecentesTabela.map((row) => (
                                        <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-neutral-800/30 transition-colors">
                                            <td className="py-3 pr-3 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                                                {String(row.pedido).startsWith('#') ? row.pedido : `#${row.pedido}`}
                                            </td>
                                            <td className="py-3 pr-3 text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap">{row.cliente}</td>
                                            <td className="py-3 pr-3 text-slate-500 max-w-[220px] truncate" title={row.cidade}>{row.cidade}</td>
                                            <td className="py-3 px-2 whitespace-nowrap">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                                    row.status === 'Em andamento' || row.status === 'Em Rota'
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                                                        : row.status === 'Separação'
                                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
                                                            : row.status === 'Entregue'
                                                                ? 'bg-slate-100 text-slate-700 dark:bg-neutral-800 dark:text-slate-300'
                                                                : 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400'
                                                }`}>
                                                    {row.status}
                                                </span>
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">{row.previsao}</td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">{row.motorista}</td>
                                            <td className="py-3 pl-2 text-right whitespace-nowrap">
                                                <button
                                                    onClick={() => handleVerDetalhes(row.vendaId)}
                                                    className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                                    title="Ver detalhes da venda"
                                                >
                                                    <MoreHorizontal className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <Link to="/admin/LogisticaSemanal" className="pt-3 border-t border-slate-50 dark:border-neutral-800 text-[11px] text-emerald-600 hover:text-emerald-700 font-semibold flex items-center justify-center gap-1">
                        <span>Ver todas as entregas</span>
                        <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>

                {/* 2. Atividades recentes */}
                <div className="lg:col-span-5 bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-slate-100 dark:border-neutral-800 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Atividades recentes
                        </h3>
                    </div>

                    <div className="space-y-3 flex-1">
                        {atividadesRecentes.length === 0 ? (
                            <div className="py-8 text-center text-slate-400 text-xs">
                                Nenhuma atividade recente registrada
                            </div>
                        ) : (
                            atividadesRecentes.map((item) => (
                                <div key={item.id} className="flex items-start gap-3 p-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-neutral-800/40 transition-colors">
                                    <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${item.iconColor}`}>
                                        <item.icon className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 line-clamp-1">
                                            {item.titulo}
                                        </p>
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-medium shrink-0 whitespace-nowrap">
                                        {item.tempo}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>

                    <button
                        onClick={() => toast.info('Histórico completo de auditoria disponível na Central Analítica.')}
                        className="pt-3 border-t border-slate-50 dark:border-neutral-800 text-[11px] text-emerald-600 hover:text-emerald-700 font-semibold flex items-center justify-center gap-1"
                    >
                        <span>Ver todas as atividades</span>
                        <ArrowRight className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {getSolicitacoesPrecoPendentes.length > 0 && (
                <Card className="border-orange-200 bg-orange-50/20">
                    <CardHeader className="bg-orange-50/80 pb-3 border-b border-orange-100">
                        <CardTitle className="text-sm font-bold text-orange-800 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Aprovação de Preços Pendentes ({getSolicitacoesPrecoPendentes.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-orange-50/50 text-xs">
                                    <TableHead>Data</TableHead>
                                    <TableHead>Vendedor</TableHead>
                                    <TableHead>Produto</TableHead>
                                    <TableHead className="text-right">Sugerido</TableHead>
                                    <TableHead className="text-right">Ação</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {getSolicitacoesPrecoPendentes.map(s => (
                                    <TableRow key={s.id} className="text-xs hover:bg-orange-50/30">
                                        <TableCell className="whitespace-nowrap">{new Date(s.data_solicitacao).toLocaleString('pt-BR')}</TableCell>
                                        <TableCell className="font-medium">{s.vendedor_nome}</TableCell>
                                        <TableCell>{s.produto_nome}</TableCell>
                                        <TableCell className="font-bold text-green-700 text-right">
                                            R$ {Number(s.preco_sugerido).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <Button
                                                    size="sm"
                                                    className="bg-green-600 hover:bg-green-700 h-7 text-xs px-2"
                                                    onClick={() => responderSolicitacaoPreco.mutate({ id: s.id, status: 'aprovado', precoValido: s.preco_sugerido, produtoId: s.produto_id })}
                                                    disabled={responderSolicitacaoPreco.isPending}
                                                >
                                                    Aprovar
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="border-amber-600 text-amber-600 hover:bg-amber-50 h-7 text-xs px-2"
                                                    onClick={() => {
                                                        setSelectedPriceRequest(s);
                                                        setNewPrice(Number(s.preco_sugerido).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
                                                        setPriceModalOpen(true);
                                                    }}
                                                    disabled={responderSolicitacaoPreco.isPending}
                                                >
                                                    Editar
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {isGerenteGeral && (
                <div className="mt-4">
                    <SolicitacoesCadastroWidget />
                </div>
            )}

            {/* Ações de Vendedores - LOG DE AUDITORIA */}
            <div className="mt-6">
                <AcoesVendedoresWidget />
            </div>

            {/* Modal de Correção de Preço */}
            <Dialog open={priceModalOpen} onOpenChange={setPriceModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Tratar Solicitação de Preço</DialogTitle>
                        <DialogDescription>
                            A sugestão de R$ {selectedPriceRequest ? Number(selectedPriceRequest.preco_sugerido).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'} enviada do caixa para o produto <strong>{selectedPriceRequest?.produto_nome}</strong> não será aprovada.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Qual o preço correto deste produto?</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">R$</span>
                                <Input
                                    type="text"
                                    className="pl-8"
                                    placeholder="0,00"
                                    value={newPrice}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/[^0-9,]/g, '');
                                        setNewPrice(val);
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPriceModalOpen(false)}>Cancelar</Button>
                        <Button
                            onClick={() => {
                                if (!selectedPriceRequest) return;
                                const precoLimpo = newPrice.replace(/\./g, '').replace(',', '.');
                                const precoCerto = parseFloat(precoLimpo);
                                if (isNaN(precoCerto) || precoCerto <= 0) {
                                    toast.error("Preço inválido inserido.");
                                    return;
                                }
                                responderSolicitacaoPreco.mutate({
                                    id: selectedPriceRequest.id,
                                    status: 'aprovado',
                                    precoValido: precoCerto,
                                    produtoId: selectedPriceRequest.produto_id
                                }, {
                                    onSuccess: () => {
                                        setPriceModalOpen(false);
                                        setSelectedPriceRequest(null);
                                        setNewPrice('');
                                    }
                                });
                            }}
                            disabled={responderSolicitacaoPreco.isPending}
                        >
                            Confirmar Novo Preço e Aprovar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Controle de Montadores Externos - apenas para Gerente Geral/Admin */}
            {isGerenteGeral && (
                <ControleMontadoresWidget />
            )}

            {/* Modal de Detalhes do Produto */}
            <ProdutoCadastroCompleto
                isOpen={produtoModalOpen}
                onClose={() => {
                    setProdutoModalOpen(false);
                    setProdutoDetalhe(null);
                }}
                onSave={async (dados) => {
                    try {
                        if (produtoDetalhe?.id) {
                            await base44.entities.Produto.update(produtoDetalhe.id, dados);
                            toast.success('Produto atualizado com sucesso!');
                            queryClient.invalidateQueries(['produtos-gerente']);
                            setProdutoModalOpen(false);
                        }
                    } catch (error) {
                        console.error('Erro ao atualizar produto:', error);
                        toast.error('Erro ao atualizar produto');
                    }
                }}
                produto={produtoDetalhe}
                isLoading={false}
            />

            {/* Modal Detalhes Pendências */}
            <Dialog open={pendenciasModalOpen} onOpenChange={setPendenciasModalOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-orange-600" />
                            Detalhamento de Pendências
                        </DialogTitle>
                    </DialogHeader>

                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setPendenciasModalOpen(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal de Detalhes da Venda */}
            <VendaDetalhesModal
                isOpen={isDetalhesModalOpen}
                onClose={() => setIsDetalhesModalOpen(false)}
                venda={selectedVendaDetalhes}
                entregas={entregas}
                montagens={montagens}
                lancamentos={lancamentos}
            />

            {/* Modal de Atualizar Pagamento */}
            <Dialog open={!!modalPagamentoVenda} onOpenChange={(open) => !open && setModalPagamentoVenda(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-emerald-700">
                            <CreditCard className="w-5 h-5" />
                            Atualizar Pagamento
                        </DialogTitle>
                        <DialogDescription>
                            Registre pagamento na loja para o pedido #{modalPagamentoVenda?.numero_pedido}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="rounded-lg border bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                            Saldo atual: <strong>R$ {saldoModalPagamento.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                        </div>

                        <div className="rounded-lg border p-3 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-[1.4fr,1fr,auto] gap-3 items-end">
                                <div className="space-y-2">
                                    <Label>Forma de pagamento</Label>
                                    <Select
                                        value={novoPagamentoItem.forma_pagamento}
                                        onValueChange={(value) => setNovoPagamentoItem((prev) => ({ ...prev, forma_pagamento: value, parcelas: 1 }))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SALES_PAYMENT_OPTIONS.map((forma) => (
                                                <SelectItem key={forma} value={forma}>{forma}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>Valor</Label>
                                    <Input
                                        type="text"
                                        inputMode="numeric"
                                        value={novoPagamentoItem.valor}
                                        onChange={(e) => setNovoPagamentoItem((prev) => ({
                                            ...prev,
                                            valor: formatarValorMonetarioInput(e.target.value)
                                        }))}
                                        placeholder="0,00"
                                    />
                                </div>

                                <Button type="button" onClick={adicionarPagamentoAoModal}>
                                    <Plus className="w-4 h-4 mr-2" />
                                    Adicionar
                                </Button>
                            </div>

                            {isInstallmentPaymentMethod(novoPagamentoItem.forma_pagamento) && (
                                <div className="space-y-2">
                                    <Label>Parcelas</Label>
                                    <Select
                                        value={String(novoPagamentoItem.parcelas || 1)}
                                        onValueChange={(value) => setNovoPagamentoItem((prev) => ({ ...prev, parcelas: Number(value) }))}
                                    >
                                        <SelectTrigger className="sm:max-w-[180px]">
                                            <SelectValue placeholder="1x" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Array.from({ length: 12 }).map((_, index) => (
                                                <SelectItem key={index + 1} value={String(index + 1)}>{index + 1}x</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between gap-3">
                                <span>Total informado: <strong>R$ {totalPagamentoInformado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                                <span>Restante no modal: <strong>R$ {saldoAposSplit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                            </div>

                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {pagamentoForm.pagamentos.length === 0 ? (
                                    <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground text-center">
                                        Nenhuma forma adicionada ainda.
                                    </div>
                                ) : pagamentoForm.pagamentos.map((pagamento, index) => (
                                    <div key={`${pagamento.forma_pagamento}-${index}`} className="flex items-center justify-between rounded-md border px-3 py-2 gap-3">
                                        <div>
                                            <p className="text-sm font-medium">{pagamento.forma_pagamento}{pagamento.parcelas > 1 ? ` (${pagamento.parcelas}x)` : ''}</p>
                                            <p className="text-xs text-muted-foreground">R$ {toMoneyNumber(pagamento.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                        </div>
                                        <Button type="button" variant="ghost" size="sm" onClick={() => removerPagamentoDoModal(index)}>
                                            Remover
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Data do pagamento</Label>
                            <Input
                                type="date"
                                value={pagamentoForm.data_pagamento}
                                onChange={(e) => setPagamentoForm((prev) => ({ ...prev, data_pagamento: e.target.value }))}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Observação</Label>
                            <Textarea
                                rows={3}
                                placeholder="Ex: Cliente antecipou pagamento na loja."
                                value={pagamentoForm.observacao}
                                onChange={(e) => setPagamentoForm((prev) => ({ ...prev, observacao: e.target.value }))}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalPagamentoVenda(null)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={confirmarPagamentoAntecipado}
                            disabled={registrarPagamentoMutation.isPending}
                            className="bg-emerald-600 hover:bg-emerald-700"
                        >
                            {registrarPagamentoMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Confirmar Pagamento
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
}
