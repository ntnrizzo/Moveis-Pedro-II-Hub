import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { formatarTelefone, formatarNome, capitalizar } from "@/utils/formatters";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Plus, Search, Filter, FileText, Loader2, Archive, ShoppingCart, Receipt, CheckCircle, XCircle, AlertTriangle, MessageCircle, CreditCard, Link2, Truck, Package, Wrench, Clock, MapPin, UserCheck, ClipboardList, Info, CalendarX, Settings, ArrowRightLeft, Unlock, ArrowUpDown, ArrowUp, ArrowDown, Percent, Edit2, ShieldCheck, MoreHorizontal, Download, ChevronLeft, ChevronRight, Phone, CalendarDays } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RestricaoCheckbox } from "@/components/ui/restricao-checkbox";
import { useNavigate, useSearchParams } from "react-router-dom";
import { abrirNotaPedidoPDF } from "../components/vendas/NotaPedidoPDF";
import { useAuth } from "@/hooks/useAuth";
import { useLojas } from "@/hooks/useLojas";
import { useTenant } from "@/contexts/TenantContext";
import { useConfirm } from "@/hooks/useConfirm";
import ArquivoTab from "../components/vendas/ArquivoTab";
import TransferirMontagemModal from "../components/vendas/TransferirMontagemModal";
import { VendaDetalhesModal } from "@/components/vendas/VendaDetalhesModal";
import EdicaoPedidoModal from "@/components/conferencia/EdicaoPedidoModal";
import { getVendaFinanceiro, getVendaResumoLogistico, isStatusCancelado, isVendaCancelada } from "@/utils/vendaStatus";
import { buildProductDisplayName } from "@/utils/productReference";
import { MONEY_EPSILON, toMoneyNumber } from "@/utils/deliveryPayment";
import { formatarDataExibicao, obterDataLocalString } from "@/utils/dateUtils";
import { isInstallmentPaymentMethod, validatePaymentSplit } from "@/services/paymentOrchestrator";
import { isAguardandoConferencia } from "@/services/conferenciaCaixaService";
import { registerSalePayment, cancelSaleFinancialEntries } from "@/services/financialOperations";

const STATUS_ENTREGA_OPTIONS = [
    'Aguardando Liberação',
    'Pendente',
    'Agendada',
    'Em Rota',
    'Entregue',
    'Retirado'
];

const STATUS_MONTAGEM_OPTIONS = [
    { label: 'Pendente', value: 'pendente' },
    { label: 'Em andamento', value: 'em_andamento' },
    { label: 'Concluída', value: 'concluida' },
    { label: 'Cancelada', value: 'cancelada' }
];

const SALES_PAYMENT_OPTIONS = [
    'Dinheiro',
    'PIX',
    'Cartão de Débito',
    'Cartão de Crédito',
    'Boleto',
    'Transferência'
];

const createEmptyPagamentoItem = (defaults = {}) => ({
    forma_pagamento: defaults.forma_pagamento || '',
    valor: defaults.valor || '',
    parcelas: defaults.parcelas || 1,
});

const SORT_DEFAULT_DIRECTIONS = {
    cliente: 'asc',
    pedido: 'asc',
    data: 'desc',
    total: 'desc',
};

const ORDER_STAGE_META = {
    andamento: { label: 'Em andamento', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    producao: { label: 'Em produção', className: 'bg-amber-50 text-amber-700 border-amber-100' },
    saiu_entrega: { label: 'Saiu para entrega', className: 'bg-sky-50 text-sky-700 border-sky-100' },
    entregue: { label: 'Entregue', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    cancelado: { label: 'Cancelado', className: 'bg-rose-50 text-rose-700 border-rose-100' },
};

const normalizeOrderText = (value) => String(value || '').trim().toLocaleLowerCase('pt-BR');

const getOrderStage = (venda) => {
    if (isVendaCancelada(venda)) return 'cancelado';

    const deliveryStatus = normalizeOrderText(venda?.resumoLogistico?.entregaPrincipal?.status);
    const saleStatus = normalizeOrderText(venda?.status);
    const combinedStatus = `${deliveryStatus} ${saleStatus}`;

    if (['entregue', 'retirado', 'concluida', 'concluída'].some((status) => deliveryStatus === status)) {
        return 'entregue';
    }

    if (deliveryStatus === 'em rota') return 'saiu_entrega';

    if (['produção', 'producao', 'separação', 'separacao', 'expedição', 'expedicao'].some((status) => combinedStatus.includes(status))) {
        return 'producao';
    }

    if (venda?.triagem_realizada && !venda?.financeiro?.isPending && !deliveryStatus) {
        return 'producao';
    }

    return 'andamento';
};

const isCurrentMonth = (value) => {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const today = new Date();
    return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
};

export default function Vendas() {
    const formatarValorMonetarioInput = (value) => {
        const digitsOnly = String(value ?? "").replace(/\D/g, "");
        if (!digitsOnly) return "";

        const valorNumerico = Number(digitsOnly) / 100;
        return valorNumerico.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    };

    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [orderStageFilter, setOrderStageFilter] = useState("all");
    const [periodFilter, setPeriodFilter] = useState("all");
    const [sellerFilter, setSellerFilter] = useState("all");
    const [paymentFilter, setPaymentFilter] = useState("all");
    const [selectedDashboardVendaId, setSelectedDashboardVendaId] = useState(null);
    const [isDashboardDetailOpen, setIsDashboardDetailOpen] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sortConfig, setSortConfig] = useState({ key: 'data', direction: 'desc' });
    const [activeTab, setActiveTab] = useState("vendas");
    const [selectedVendaDetalhes, setSelectedVendaDetalhes] = useState(null);
    const [isDetalhesModalOpen, setIsDetalhesModalOpen] = useState(false);
    const [modalAcoesVenda, setModalAcoesVenda] = useState(null);
    const [modalPagamentoVenda, setModalPagamentoVenda] = useState(null);
    const [pagamentoForm, setPagamentoForm] = useState({
        pagamentos: [],
        data_pagamento: new Date().toISOString().slice(0, 10),
        observacao: ""
    });
    const [novoPagamentoItem, setNovoPagamentoItem] = useState(createEmptyPagamentoItem({ forma_pagamento: 'PIX' }));

    const liberarEntregaMutation = useMutation({
        mutationFn: (id) => base44.entities.Entrega.update(id, {
            status: 'Pendente',
            data_agendada: null,
            turno: null,
            observacoes: "Entrega liberada pelo vendedor/cliente."
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['entregas'] });
            toast.success("Entrega liberada! O pedido voltou para a triagem da logística.");
        },
        onError: () => {
            toast.error("Erro ao liberar entrega.");
        }
    });

    // Filtros e Ordenação
    // Estados para reagendamento
    const [modalReagendamento, setModalReagendamento] = useState(null); // { vendaId, entregaId, dataAgendada, turno }
    const [motivoReagendamento, setMotivoReagendamento] = useState("");

    // Estados para Preferências de Entrega
    const [modalPreferencias, setModalPreferencias] = useState(null); // { entregaId, preferencias }
    const [preferenciasTemp, setPreferenciasTemp] = useState({ dias: [0, 1, 2, 3, 4, 5, 6], turnos: ['Manhã', 'Tarde', 'Comercial'], obs: "" });
    const [modalTransferencia, setModalTransferencia] = useState(null); // { vendaId }
    const [modalLiberarEntrega, setModalLiberarEntrega] = useState(null); // { entregaId, pedido }
    const [modalStatusEntregaVenda, setModalStatusEntregaVenda] = useState(null); // { venda, entrega }
    const [statusEntregaForm, setStatusEntregaForm] = useState({ status: 'Pendente', observacoes: '' });
    const [modalStatusMontagemVenda, setModalStatusMontagemVenda] = useState(null); // { venda, montagens }
    const [statusMontagemForm, setStatusMontagemForm] = useState({ status: 'pendente' });
    const [selectedVendaIds, setSelectedVendaIds] = useState([]);
    const [isBulkRunning, setIsBulkRunning] = useState(false);
    const [bulkTransferVendedorOpen, setBulkTransferVendedorOpen] = useState(false);
    const [bulkTransferLojaOpen, setBulkTransferLojaOpen] = useState(false);
    const [bulkPagamentoOpen, setBulkPagamentoOpen] = useState(false);
    const [bulkStatusEntregaOpen, setBulkStatusEntregaOpen] = useState(false);
    const [bulkStatusMontagemOpen, setBulkStatusMontagemOpen] = useState(false);
    const [bulkVendedorId, setBulkVendedorId] = useState("");
    const [bulkLoja, setBulkLoja] = useState("");
    const [bulkPagamentoForm, setBulkPagamentoForm] = useState({
        forma_pagamento: "PIX",
        data_pagamento: new Date().toISOString().slice(0, 10),
        observacao: ""
    });
    const [bulkStatusEntregaForm, setBulkStatusEntregaForm] = useState({ status: 'Pendente', observacoes: '' });
    const [bulkStatusMontagemForm, setBulkStatusMontagemForm] = useState({ status: 'pendente' });
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const confirm = useConfirm();

    // Hook de Autenticação e Controle de Acesso
    const { user, filterData, can, getUserLoja } = useAuth();
    const { brandName, conferenciaCaixaEnabled } = useTenant();
    const canCancelVendas = can('cancel_vendas');
    const canManagePayments = can('manage_financeiro') || can('manage_vendas');
    const canManageVendas = can('manage_vendas');
    const canManageDeliveryStatus = can('manage_entregas') || canManageVendas;
    const canCreateVendas = can('create_vendas');
    const canUseBulkActions = user?.cargo === 'Administrador' || user?.cargo === 'Gerente Geral' || canManageDeliveryStatus;

    // Estado para modal de edição de pedido antes da conferência
    const [edicaoPedidoVenda, setEdicaoPedidoVenda] = useState(null);
    const [isEdicaoPedidoOpen, setIsEdicaoPedidoOpen] = useState(false);


    const { data: vendas = [], isLoading } = useQuery({
        queryKey: ['vendas'],
        queryFn: () => base44.entities.Venda.list('-data_venda')
    });

    const { data: clientes = [] } = useQuery({
        queryKey: ['clientes'],
        queryFn: () => base44.entities.Cliente.list()
    });

    // Query para buscar lançamentos (para poder cancelar os vinculados)
    const { data: lancamentos = [] } = useQuery({
        queryKey: ['lancamentos-financeiros'],
        queryFn: () => base44.entities.LancamentoFinanceiro.list()
    });

    // Query para buscar entregas (para mostrar status operacional)
    const { data: entregas = [] } = useQuery({
        queryKey: ['entregas'],
        queryFn: () => base44.entities.Entrega.list('-created_date'),
        refetchInterval: 10000
    });

    // Query para buscar montagens
    const { data: montagens = [] } = useQuery({
        queryKey: ['montagens'],
        queryFn: () => base44.entities.MontagemItem.list(),
        refetchInterval: 10000
    });

    // Query para buscar usuários (para exibir nome do vendedor)
    const { data: users = [] } = useQuery({
        queryKey: ['users_list'],
        queryFn: () => base44.entities.User.list()
    });

    const { data: lojasAtivas = [] } = useLojas();

    // Mutation para cancelar venda
    const cancelarVendaMutation = useMutation({
        mutationFn: async (input) => {
            const venda = input?.venda || input;
            const silent = Boolean(input?.silent);
            if (!canCancelVendas) {
                throw new Error('Sem permissão para cancelar vendas.');
            }

            // 1. Atualizar status da venda para Cancelado
            await base44.entities.Venda.update(venda.id, { status: 'Cancelado' });

            // 2. Cancelar os lançamentos vinculados com validação de cargo/tenant no banco
            const lancamentosCancelados = await cancelSaleFinancialEntries(venda.id);

            // 3. Cancelar entregas vinculadas
            const entregasVenda = entregas.filter(e =>
                e.venda_id === venda.id || e.numero_pedido === venda.numero_pedido
            );
            for (const entrega of entregasVenda) {
                if (!isStatusCancelado(entrega.status)) {
                    await base44.entities.Entrega.update(entrega.id, {
                        status: 'Cancelado',
                        observacoes: (entrega.observacoes || '') + ' [VENDA CANCELADA]'
                    });
                }
            }

            // 4. Cancelar montagens vinculadas (internas e externas)
            const montagensVenda = montagens.filter(m => m.venda_id === venda.id);
            for (const montagem of montagensVenda) {
                if (!isStatusCancelado(montagem.status)) {
                    await base44.entities.MontagemItem.update(montagem.id, {
                        status: 'cancelada',
                        observacoes: (montagem.observacoes || '') + ' [VENDA CANCELADA]'
                    });
                }
            }

            // 5. Cancelar assistências técnicas vinculadas
            try {
                const todasAssistencias = await base44.entities.AssistenciaTecnica.list();
                const assistenciasVenda = todasAssistencias.filter(a => a.venda_id === venda.id);
                for (const assistencia of assistenciasVenda) {
                    if (!isStatusCancelado(assistencia.status)) {
                        await base44.entities.AssistenciaTecnica.update(assistencia.id, {
                            status: 'Cancelada',
                            observacoes: (assistencia.observacoes || '') + ' [VENDA CANCELADA]'
                        });
                    }
                }
            } catch (err) {
                console.error('Erro ao cancelar assistências:');
            }

            // 6. Retornar itens ao estoque
            if (venda.itens && venda.itens.length > 0) {
                for (const item of venda.itens) {
                    if (item.produto_id) {
                        try {
                            const { data: produto } = await supabase
                                .from('produtos')
                                .select('quantidade_estoque')
                                .eq('id', item.produto_id)
                                .single();

                            if (produto) {
                                const novaQuantidade = (produto.quantidade_estoque || 0) + (item.quantidade || 1);
                                await base44.entities.Produto.update(item.produto_id, {
                                    quantidade_estoque: novaQuantidade
                                });
                            }
                        } catch (err) {
                            console.error(`Erro ao retornar estoque do produto ${item.produto_id}:`, err);
                        }
                    }
                }
            }

            // 7. Cancelar ou sinalizar pedidos de compra (encomendas)
            try {
                // 7.1 Cancelar solicitações pendentes
                const { data: solicitacoes } = await supabase
                    .from('solicitacoes_encomenda')
                    .select('*')
                    .or(`venda_id.eq.${venda.id},numero_pedido.eq.${venda.numero_pedido}`);

                if (solicitacoes && solicitacoes.length > 0) {
                    for (const sol of solicitacoes) {
                        const statusNormalizado = (sol.status || '').toLowerCase();
                        if (statusNormalizado === 'pendente' || statusNormalizado === 'aguardando_compra') {
                            await supabase
                                .from('solicitacoes_encomenda')
                                .update({ 
                                    status: 'cancelada', 
                                    observacoes: (sol.observacoes || '') + ' [VENDA CANCELADA]' 
                                })
                                .eq('id', sol.id);
                        } else {
                            await supabase
                                .from('solicitacoes_encomenda')
                                .update({ 
                                    status: 'cancelada_retida_cd', 
                                    observacoes: (sol.observacoes || '') + ' [VENDA CANCELADA - ENVIAR PARA CD]' 
                                })
                                .eq('id', sol.id);
                        }
                    }
                }

                // 7.2 Sinalizar itens nas ordens de compra e alertar o comprador
                const { data: itensCompra } = await supabase
                    .from('compras_oc_itens')
                    .select('id, ordem_compra_id, observacao_item')
                    .or(`pedido_origem_numero.eq.${venda.numero_pedido},descricao_personalizada.ilike.%${venda.numero_pedido}%`);

                if (itensCompra && itensCompra.length > 0) {
                    const ordensNotificadas = new Set();
                    for (const item of itensCompra) {
                        await supabase
                            .from('compras_oc_itens')
                            .update({ 
                                observacao_item: '[VENDA CANCELADA - ENVIAR PARA CD] ' + (item.observacao_item || '')
                            })
                            .eq('id', item.id);
                            
                        if (!ordensNotificadas.has(item.ordem_compra_id)) {
                            ordensNotificadas.add(item.ordem_compra_id);
                            await supabase
                                .from('compras_comunicacoes')
                                .insert([{
                                    ordem_compra_id: item.ordem_compra_id,
                                    tipo: 'SISTEMA',
                                    remetente: 'Sistema Vendas',
                                    destinatario: 'Setor de Compras',
                                    conteudo: { mensagem: `ATENÇÃO: A Venda #${venda.numero_pedido} foi CANCELADA. O item desta venda deve ser redirecionado para o CD quando chegar.` },
                                    data_envio: new Date().toISOString()
                                }]);
                        }
                    }
                }
            } catch (err) {
                console.error('Erro ao cancelar/sinalizar encomendas:', err);
            }

            return {
                vendaId: venda.id,
                lancamentosCancelados: Number(lancamentosCancelados || 0),
                entregasCanceladas: entregasVenda.length,
                montagensCanceladas: montagensVenda.length,
                silent
            };
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['vendas'] });
            queryClient.invalidateQueries({ queryKey: ['lancamentos-venda'] });
            queryClient.invalidateQueries({ queryKey: ['entregas-venda'] });
            queryClient.invalidateQueries({ queryKey: ['montagens-venda'] });
            queryClient.invalidateQueries({ queryKey: ['assistencias-venda'] });
            queryClient.invalidateQueries({ queryKey: ['solicitacoes-pdv'] });
            queryClient.invalidateQueries({ queryKey: ['solicitacoes_encomenda'] });
            queryClient.invalidateQueries({ queryKey: ['pedidos-compra-dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['compras'] });
            if (!result?.silent) {
                toast.success("Venda cancelada! Entregas, montagens, assistências, lançamentos e encomendas vinculadas também foram sinalizados.");
            }
        }
    });

    const registrarPagamentoVenda = async ({ venda, valorRecebido, formaPagamento, dataPagamento, observacao }) => {
        if (!venda?.id) throw new Error('Venda inválida para registrar pagamento.');
        if (isVendaCancelada(venda)) throw new Error('Não é possível registrar pagamento em venda cancelada.');

        const financeiroAtual = venda.financeiro || getVendaFinanceiro(venda, { entregas, lancamentos });
        const saldoAtual = Math.max(toMoneyNumber(financeiroAtual.valorRestante), 0);

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

        const result = await registerSalePayment({
            saleId: venda.id,
            payments: novosPagamentos,
            paymentDate: dataPagamento,
            observation: observacao,
        });
        return {
            valorRecebidoNum: Number(result.valorRecebido || valorRecebidoNum),
            novoValorRestante: Number(result.valorRestante || 0),
            quitada: Boolean(result.pagamentoQuitado),
        };
    };

    const registrarPagamentoMutation = useMutation({
        mutationFn: registrarPagamentoVenda,
        onSuccess: ({ valorRecebidoNum, novoValorRestante, quitada }) => {
            queryClient.invalidateQueries({ queryKey: ['vendas'] });
            queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
            queryClient.invalidateQueries({ queryKey: ['entregas'] });
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

    // Mutation para solicitar reagendamento
    const reagendarMutation = useMutation({
        mutationFn: async ({ entregaId, motivo, dataOriginal, turnoOriginal }) => {
            // 1. Buscar entrega atual para pegar histórico
            const entregaAtual = entregas.find(e => e.id === entregaId);
            const historicoAtual = entregaAtual?.historico_reagendamentos || [];

            const novoEvento = {
                data: dataOriginal,
                turno: turnoOriginal,
                motivo: motivo,
                data_registro: new Date().toISOString(),
                usuario: user?.email || 'vendedor'
            };

            return await base44.entities.Entrega.update(entregaId, {
                status: 'Pendente',
                data_agendada: null,
                turno: null,
                caminhao_id: null,
                ordem_rota: null,
                // Registrar a restrição
                data_restricao: dataOriginal,
                turno_restricao: turnoOriginal,
                motivo_restricao: motivo,
                historico_reagendamentos: [...historicoAtual, novoEvento]
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['entregas'] });
            queryClient.invalidateQueries({ queryKey: ['vendas'] }); // Atualizar badges
            toast.success("Solicitação de reagendamento enviada para Logística!");
            setModalReagendamento(null);
            setMotivoReagendamento("");
        },
        onError: () => toast.error("Erro ao solicitar reagendamento")
    });

    // Mutation para salvar preferências
    const salvarPreferenciasMutation = useMutation({
        mutationFn: async ({ entregaId, preferencias }) => {
            return await base44.entities.Entrega.update(entregaId, {
                preferencias_entrega: preferencias
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['entregas'] });
            toast.success("Preferências de entrega atualizadas!");
            setModalPreferencias(null);
        },
        onError: () => toast.error("Erro ao salvar preferências")
    });

    const confirmarReagendamento = () => {
        if (!modalReagendamento || !motivoReagendamento.trim()) {
            toast.error("Informe o motivo");
            return;
        }
        reagendarMutation.mutate({
            entregaId: modalReagendamento.entregaId,
            motivo: motivoReagendamento,
            dataOriginal: modalReagendamento.dataAgendada,
            turnoOriginal: modalReagendamento.turno
        });
    };

    const confirmarLiberarEntrega = () => {
        if (!modalLiberarEntrega) return;
        liberarEntregaMutation.mutate(modalLiberarEntrega.entregaId);
        setModalLiberarEntrega(null);
    };

    const handleCancelarVenda = async (venda) => {
        if (!canCancelVendas) {
            toast.error('Você não tem permissão para cancelar vendas.');
            return;
        }

        const confirmed = await confirm({
            title: "Cancelar Venda",
            message: `Tem certeza que deseja CANCELAR a venda #${venda.numero_pedido}?\n\nIsso também cancelará todos os lançamentos financeiros, entregas, montagens e assistências vinculadas.`,
            confirmText: "Cancelar Venda",
            variant: "destructive"
        });
        if (!confirmed) return;

        cancelarVendaMutation.mutate(venda);
    };


    // 1. Filtra pelo escopo do usuário, sempre respeitando a loja atribuída.
    const vendasPermitidas = filterData(vendas, {
        userField: 'responsavel_id',
        lojaField: 'loja'
    });
    const vendasComResumo = vendasPermitidas.map((venda) => ({
        ...venda,
        financeiro: getVendaFinanceiro(venda, { entregas, lancamentos }),
        resumoLogistico: getVendaResumoLogistico(venda, { entregas, montagens })
    })).map((venda) => ({
        ...venda,
        orderStage: getOrderStage(venda)
    }));

    // 2. Filtros de Busca e Status da Tela (exclui cancelados da aba principal)
    const filtered = vendasComResumo.filter(v => {
        if (isVendaCancelada(v)) return false;
        if (orderStageFilter !== 'all' && v.orderStage !== orderStageFilter) return false;
        if (statusFilter === 'aguardando_conferencia') {
            // Filtro especial: apenas aguardando conferência de caixa
            if (!isAguardandoConferencia(v)) return false;
        } else {
            if (statusFilter !== 'all' && v.financeiro.displayStatus !== statusFilter) return false;
        }
        if (search && !v.cliente_nome?.toLowerCase().includes(search.toLowerCase()) && !v.numero_pedido?.includes(search)) return false;
        if (sellerFilter !== 'all') {
            const selectedSeller = users.find((seller) => String(seller.id || '').toLowerCase() === sellerFilter.toLowerCase());
            const sellerIdentifiers = [selectedSeller?.id, selectedSeller?.email].filter(Boolean).map((value) => String(value).toLowerCase());
            if (!sellerIdentifiers.includes(String(v.responsavel_id || '').toLowerCase())) return false;
        }
        if (paymentFilter !== 'all') {
            const paymentMethods = [
                v.forma_pagamento,
                v.forma_pagamento_entrega,
                ...(Array.isArray(v.pagamentos) ? v.pagamentos.map((pagamento) => pagamento?.forma_pagamento) : [])
            ].map(normalizeOrderText);
            if (!paymentMethods.includes(normalizeOrderText(paymentFilter))) return false;
        }
        if (periodFilter !== 'all') {
            const saleDate = new Date(v.data_venda || 0);
            if (Number.isNaN(saleDate.getTime())) return false;
            const today = new Date();
            if (periodFilter === 'month' && !isCurrentMonth(saleDate)) return false;
            if (periodFilter === 'week') {
                const sevenDaysAgo = new Date(today);
                sevenDaysAgo.setHours(0, 0, 0, 0);
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
                if (saleDate < sevenDaysAgo || saleDate > today) return false;
            }
        }
        return true;
    });

    // 3. Filtro para aba de cancelados
    const filteredCancelados = vendasComResumo.filter(v => {
        if (!isVendaCancelada(v)) return false;
        if (search && !v.cliente_nome?.toLowerCase().includes(search.toLowerCase()) && !v.numero_pedido?.includes(search)) return false;
        if (sellerFilter !== 'all') {
            const selectedSeller = users.find((seller) => String(seller.id || '').toLowerCase() === sellerFilter.toLowerCase());
            const sellerIdentifiers = [selectedSeller?.id, selectedSeller?.email].filter(Boolean).map((value) => String(value).toLowerCase());
            if (!sellerIdentifiers.includes(String(v.responsavel_id || '').toLowerCase())) return false;
        }
        if (paymentFilter !== 'all') {
            const paymentMethods = [v.forma_pagamento, v.forma_pagamento_entrega, ...(Array.isArray(v.pagamentos) ? v.pagamentos.map((pagamento) => pagamento?.forma_pagamento) : [])].map(normalizeOrderText);
            if (!paymentMethods.includes(normalizeOrderText(paymentFilter))) return false;
        }
        if (periodFilter !== 'all') {
            const saleDate = new Date(v.data_venda || 0);
            if (Number.isNaN(saleDate.getTime())) return false;
            const today = new Date();
            if (periodFilter === 'month' && !isCurrentMonth(saleDate)) return false;
            if (periodFilter === 'week') {
                const sevenDaysAgo = new Date(today);
                sevenDaysAgo.setHours(0, 0, 0, 0);
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
                if (saleDate < sevenDaysAgo || saleDate > today) return false;
            }
        }
        return true;
    });

    const getSortValue = React.useCallback((venda, sortKey) => {
        switch (sortKey) {
            case 'cliente':
                return String(venda.cliente_nome || '').trim().toLocaleLowerCase('pt-BR');
            case 'pedido': {
                const numeroPedido = String(venda.numero_pedido || '').trim();
                const parsedPedido = Number(numeroPedido.replace(/\D/g, ''));
                return Number.isNaN(parsedPedido) ? numeroPedido.toLocaleLowerCase('pt-BR') : parsedPedido;
            }
            case 'data':
                return new Date(venda.data_venda || 0).getTime();
            case 'total':
                return toMoneyNumber(venda.valor_total);
            default:
                return '';
        }
    }, []);

    const sortVendas = React.useCallback((lista) => {
        const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;

        return [...lista].sort((vendaA, vendaB) => {
            const valorA = getSortValue(vendaA, sortConfig.key);
            const valorB = getSortValue(vendaB, sortConfig.key);

            if (typeof valorA === 'string' && typeof valorB === 'string') {
                return valorA.localeCompare(valorB, 'pt-BR', { sensitivity: 'base', numeric: true }) * directionMultiplier;
            }

            if (valorA < valorB) return -1 * directionMultiplier;
            if (valorA > valorB) return 1 * directionMultiplier;

            return 0;
        });
    }, [getSortValue, sortConfig.direction, sortConfig.key]);

    const sortedFiltered = React.useMemo(() => sortVendas(filtered), [filtered, sortVendas]);
    const sortedFilteredCancelados = React.useMemo(() => sortVendas(filteredCancelados), [filteredCancelados, sortVendas]);

    const activeSortedVendas = activeTab === 'cancelados' ? sortedFilteredCancelados : sortedFiltered;
    const totalPages = Math.max(1, Math.ceil(activeSortedVendas.length / pageSize));
    const pageStart = (Math.min(currentPage, totalPages) - 1) * pageSize;
    const paginatedVendas = activeSortedVendas.slice(pageStart, pageStart + pageSize);
    const selectedDashboardVenda = paginatedVendas.find((venda) => venda.id === selectedDashboardVendaId) || paginatedVendas[0] || null;

    const dashboardStats = React.useMemo(() => {
        const total = vendasComResumo.length;
        const byStage = (stage) => vendasComResumo.filter((venda) => venda.orderStage === stage);
        const deliveredThisMonth = byStage('entregue').filter((venda) => {
            const deliveryDate = venda.resumoLogistico?.entregaPrincipal?.data_realizada
                || venda.resumoLogistico?.entregaPrincipal?.data_agendada;
            return isCurrentMonth(deliveryDate);
        }).length;

        return {
            total,
            andamento: byStage('andamento').length,
            producao: byStage('producao').length,
            saiu_entrega: byStage('saiu_entrega').length,
            entregue: deliveredThisMonth,
            cancelado: byStage('cancelado').length,
        };
    }, [vendasComResumo]);

    const dashboardPercent = React.useCallback((value) => {
        if (!dashboardStats.total) return '0%';
        return `${((value / dashboardStats.total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    }, [dashboardStats.total]);

    React.useEffect(() => {
        setCurrentPage(1);
    }, [search, statusFilter, orderStageFilter, periodFilter, sellerFilter, paymentFilter, activeTab, pageSize]);

    React.useEffect(() => {
        if (!paginatedVendas.length) {
            setSelectedDashboardVendaId(null);
            return;
        }
        if (!paginatedVendas.some((venda) => venda.id === selectedDashboardVendaId)) {
            setSelectedDashboardVendaId(paginatedVendas[0].id);
        }
    }, [paginatedVendas, selectedDashboardVendaId]);

    const selectedVendas = sortedFiltered.filter((v) => selectedVendaIds.includes(v.id));
    const selectedIdsSet = new Set(selectedVendaIds);
    const showBulkSelectionColumn = canUseBulkActions && activeTab === 'vendas';
    const visibleVendaIds = paginatedVendas.map((venda) => venda.id);
    const selectedVisibleCount = visibleVendaIds.filter((id) => selectedIdsSet.has(id)).length;
    const allVisibleSelected = visibleVendaIds.length > 0 && selectedVisibleCount === visibleVendaIds.length;
    const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
    const tableColSpanVendas = showBulkSelectionColumn ? 12 : 11;
    const vendedoresDisponiveis = users.filter((u) => u?.id);
    const lojasDisponiveis = React.useMemo(() => {
        const normalizarNomeLoja = (value) => String(value || '').trim();

        const lojasCadastradas = lojasAtivas
            .map((loja) => normalizarNomeLoja(loja?.nome))
            .filter(Boolean);

        const lojaAtuacaoAtual = normalizarNomeLoja(getUserLoja?.()).toLowerCase();

        return lojasCadastradas
            .filter((nome, index, arr) => arr.findIndex((item) => item.toLowerCase() === nome.toLowerCase()) === index)
            .filter((nome) => nome.toLowerCase() !== lojaAtuacaoAtual);
    }, [getUserLoja, lojasAtivas]);

    React.useEffect(() => {
        if (bulkLoja && !lojasDisponiveis.some((loja) => loja === bulkLoja)) {
            setBulkLoja("");
        }
    }, [bulkLoja, lojasDisponiveis]);

    React.useEffect(() => {
        if (!showBulkSelectionColumn) {
            setSelectedVendaIds((prev) => (prev.length ? [] : prev));
            return;
        }

        const visibleIds = new Set(sortedFiltered.map((v) => v.id));
        setSelectedVendaIds((prev) => {
            const next = prev.filter((id) => visibleIds.has(id));
            return next.length === prev.length ? prev : next;
        });
    }, [showBulkSelectionColumn, sortedFiltered]);

    const handleToggleSelectVenda = (vendaId, checked) => {
        setSelectedVendaIds((prev) => {
            if (checked) {
                return prev.includes(vendaId) ? prev : [...prev, vendaId];
            }
            return prev.filter((id) => id !== vendaId);
        });
    };

    const handleSelectAllVendas = (checked) => {
        setSelectedVendaIds((prev) => {
            const withoutVisible = prev.filter((id) => !visibleVendaIds.includes(id));
            return checked ? [...withoutVisible, ...visibleVendaIds] : withoutVisible;
        });
    };

    const handleSortChange = (key) => {
        setSortConfig((prev) => {
            if (prev.key === key) {
                return {
                    key,
                    direction: prev.direction === 'asc' ? 'desc' : 'asc',
                };
            }

            return {
                key,
                direction: SORT_DEFAULT_DIRECTIONS[key] || 'asc',
            };
        });
    };

    const renderSortableHeader = (label, key, className = '') => {
        const isActive = sortConfig.key === key;
        const Icon = !isActive ? ArrowUpDown : (sortConfig.direction === 'asc' ? ArrowUp : ArrowDown);

        return (
            <TableHead className={className}>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-0 font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={() => handleSortChange(key)}
                >
                    <span>{label}</span>
                    <Icon className={`ml-2 h-4 w-4 ${isActive ? 'text-foreground' : 'text-muted-foreground/70'}`} />
                </Button>
            </TableHead>
        );
    };

    const isEntregaFinalizadaStatus = (status) => {
        const normalized = String(status || '').toLowerCase();
        return normalized === 'entregue' || normalized === 'retirado';
    };

    const getEntregaAlvoVenda = (venda) => {
        const entregasVenda = (entregas || []).filter((e) =>
            (e.venda_id === venda.id || e.numero_pedido === venda.numero_pedido) && !isStatusCancelado(e.status)
        );

        if (!entregasVenda.length) return null;

        const naoFinalizada = entregasVenda.find((e) => !isEntregaFinalizadaStatus(e.status));
        return naoFinalizada || entregasVenda[0];
    };

    const atualizarStatusEntrega = async ({ entrega, status, observacoes }) => {
        if (!entrega?.id) {
            throw new Error('Entrega não encontrada para este pedido.');
        }

        const novoStatus = String(status || '').trim();
        if (!novoStatus) {
            throw new Error('Selecione um status de entrega válido.');
        }

        const payload = {
            status: novoStatus,
            observacoes: observacoes?.trim() || null,
        };

        if (novoStatus === 'Entregue' || novoStatus === 'Retirado') {
            payload.data_realizada = new Date().toISOString().slice(0, 10);
        } else if (entrega?.data_realizada) {
            payload.data_realizada = null;
        }

        await base44.entities.Entrega.update(entrega.id, payload);
    };

    const abrirModalStatusEntrega = (venda) => {
        const entrega = getEntregaAlvoVenda(venda);
        if (!entrega) {
            toast.warning('Este pedido não possui entrega elegível para atualização de status.');
            return;
        }

        setStatusEntregaForm({
            status: entrega.status || 'Pendente',
            observacoes: entrega.observacoes || ''
        });
        setModalStatusEntregaVenda({ venda, entrega });
    };

    const getMontagensAlvoVenda = (venda) => {
        return (montagens || []).filter((m) =>
            (m.venda_id === venda.id || m.numero_pedido === venda.numero_pedido) && !isStatusCancelado(m.status)
        );
    };

    const atualizarStatusMontagem = async ({ montagensVenda, status }) => {
        if (!montagensVenda || !montagensVenda.length) {
            throw new Error('Nenhuma montagem encontrada para este pedido.');
        }

        const novoStatus = String(status || '').trim();
        if (!novoStatus) {
            throw new Error('Selecione um status de montagem válido.');
        }

        const payload = {
            status: novoStatus,
            updated_at: new Date().toISOString()
        };

        if (novoStatus === 'concluida') {
            payload.concluido_por = user.id?.toString();
            payload.concluido_por_nome = user.full_name || user.email;
        } else if (novoStatus === 'pendente') {
            payload.concluido_por = null;
            payload.concluido_por_nome = null;
        }

        for (const montagem of montagensVenda) {
            await base44.entities.MontagemItem.update(montagem.id, payload);
        }
    };

    const abrirModalStatusMontagem = (venda) => {
        const montagensVenda = getMontagensAlvoVenda(venda);
        if (!montagensVenda.length) {
            toast.warning('Este pedido não possui montagem elegível para atualização de status.');
            return;
        }

        setStatusMontagemForm({
            status: montagensVenda[0].status || 'pendente'
        });
        setModalStatusMontagemVenda({ venda, montagens: montagensVenda });
    };

    const executarAcaoEmLote = async ({ itens, acao }) => {
        if (!itens.length) {
            toast.warning('Selecione ao menos uma venda para continuar.');
            return;
        }

        setIsBulkRunning(true);
        try {
            const results = await Promise.allSettled(itens.map((venda) => acao(venda)));
            const sucessos = [];
            const falhas = [];

            results.forEach((result, index) => {
                const venda = itens[index];
                if (result.status === 'fulfilled') {
                    sucessos.push(venda.id);
                } else {
                    falhas.push({
                        venda,
                        motivo: result.reason?.message || 'Erro ao processar venda'
                    });
                }
            });

            if (sucessos.length > 0) {
                queryClient.invalidateQueries({ queryKey: ['vendas'] });
                queryClient.invalidateQueries({ queryKey: ['entregas'] });
                queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
            }

            setSelectedVendaIds((prev) => prev.filter((id) => !sucessos.includes(id)));

            if (falhas.length === 0) {
                toast.success(`${sucessos.length} venda(s) processada(s) com sucesso.`);
                return;
            }

            const resumoFalhas = falhas
                .slice(0, 3)
                .map((item) => `#${item.venda.numero_pedido}: ${item.motivo}`)
                .join(' | ');

            toast.warning(
                `Lote concluído com falhas. Sucesso: ${sucessos.length}. Falha: ${falhas.length}. ${resumoFalhas}`
            );
        } finally {
            setIsBulkRunning(false);
        }
    };

    const handleBulkCancelar = async () => {
        const elegiveis = selectedVendas.filter((v) => !isVendaCancelada(v));
        if (!elegiveis.length) {
            toast.warning('Nenhuma venda elegível para cancelamento.');
            return;
        }

        const confirmed = await confirm({
            title: 'Cancelar vendas em lote',
            message: `Tem certeza que deseja cancelar ${elegiveis.length} venda(s)? Esta ação também cancelará entregas, montagens, lançamentos e assistências vinculadas.`,
            confirmText: 'Cancelar vendas',
            variant: 'destructive'
        });
        if (!confirmed) return;

        await executarAcaoEmLote({
            itens: elegiveis,
            acao: (venda) => cancelarVendaMutation.mutateAsync({ venda, silent: true })
        });
    };

    const handleBulkLiberarEntrega = async () => {
        const elegiveis = selectedVendas.filter((venda) => {
            const entregaAguardando = entregas.find((e) =>
                e.numero_pedido === venda.numero_pedido && e.status === 'Aguardando Liberação'
            );
            const podeLiberar = user?.cargo === 'Administrador' || user?.cargo === 'Gerente Geral' || venda.responsavel_id === user?.id;
            return Boolean(entregaAguardando && podeLiberar);
        });

        if (!elegiveis.length) {
            toast.warning('Nenhuma venda selecionada está aguardando liberação.');
            return;
        }

        const confirmed = await confirm({
            title: 'Liberar entregas em lote',
            message: `Deseja liberar ${elegiveis.length} entrega(s) para a logística?`,
            confirmText: 'Liberar entregas'
        });
        if (!confirmed) return;

        await executarAcaoEmLote({
            itens: elegiveis,
            acao: async (venda) => {
                const entregaAguardando = entregas.find((e) =>
                    e.numero_pedido === venda.numero_pedido && e.status === 'Aguardando Liberação'
                );
                if (!entregaAguardando) {
                    throw new Error('Entrega não está aguardando liberação.');
                }
                await base44.entities.Entrega.update(entregaAguardando.id, {
                    status: 'Pendente',
                    data_agendada: null,
                    turno: null,
                    observacoes: 'Entrega liberada pelo vendedor/cliente.'
                });
            }
        });
    };

    const handleBulkTransferirVendedor = async () => {
        if (!bulkVendedorId) {
            toast.error('Selecione o vendedor de destino.');
            return;
        }

        const vendedorDestino = vendedoresDisponiveis.find((u) => String(u.id) === bulkVendedorId);
        if (!vendedorDestino) {
            toast.error('Vendedor selecionado não encontrado.');
            return;
        }

        const elegiveis = selectedVendas.filter((v) => !isVendaCancelada(v));
        await executarAcaoEmLote({
            itens: elegiveis,
            acao: (venda) => base44.entities.Venda.update(venda.id, {
                responsavel_id: vendedorDestino.id,
                responsavel_nome: vendedorDestino.full_name || vendedorDestino.email || venda.responsavel_nome
            })
        });

        setBulkTransferVendedorOpen(false);
        setBulkVendedorId("");
    };

    const handleBulkTransferirLoja = async () => {
        if (!bulkLoja) {
            toast.error('Selecione a loja de destino.');
            return;
        }

        const elegiveis = selectedVendas.filter((v) => !isVendaCancelada(v));
        await executarAcaoEmLote({
            itens: elegiveis,
            acao: (venda) => base44.entities.Venda.update(venda.id, { loja: bulkLoja })
        });

        setBulkTransferLojaOpen(false);
        setBulkLoja("");
    };

    const handleBulkRegistrarPagamento = async () => {
        const elegiveis = selectedVendas.filter((venda) => {
            const financeiro = venda.financeiro || getVendaFinanceiro(venda, { entregas, lancamentos });
            return !isVendaCancelada(venda) && toMoneyNumber(financeiro.valorRestante) > MONEY_EPSILON;
        });

        if (!elegiveis.length) {
            toast.warning('Nenhuma venda com saldo pendente foi selecionada.');
            return;
        }

        await executarAcaoEmLote({
            itens: elegiveis,
            acao: (venda) => {
                const financeiro = venda.financeiro || getVendaFinanceiro(venda, { entregas, lancamentos });
                const saldoRestante = Math.max(toMoneyNumber(financeiro.valorRestante), 0);
                return registrarPagamentoVenda({
                    venda,
                    valorRecebido: saldoRestante,
                    formaPagamento: bulkPagamentoForm.forma_pagamento,
                    dataPagamento: bulkPagamentoForm.data_pagamento,
                    observacao: bulkPagamentoForm.observacao || 'Pagamento em lote na tela de vendas.'
                });
            }
        });

        setBulkPagamentoOpen(false);
        setBulkPagamentoForm({
            forma_pagamento: 'PIX',
            data_pagamento: new Date().toISOString().slice(0, 10),
            observacao: ''
        });
    };

    const handleConfirmarStatusEntrega = async () => {
        if (!modalStatusEntregaVenda) return;

        try {
            await atualizarStatusEntrega({
                entrega: modalStatusEntregaVenda.entrega,
                status: statusEntregaForm.status,
                observacoes: statusEntregaForm.observacoes,
            });

            queryClient.invalidateQueries({ queryKey: ['entregas'] });
            queryClient.invalidateQueries({ queryKey: ['vendas'] });
            toast.success('Status da entrega atualizado com sucesso.');

            setModalStatusEntregaVenda(null);
            setStatusEntregaForm({ status: 'Pendente', observacoes: '' });
        } catch (error) {
            toast.error(error?.message || 'Não foi possível atualizar o status da entrega.');
        }
    };

    const handleBulkAtualizarStatusEntrega = async () => {
        const novoStatus = String(bulkStatusEntregaForm.status || '').trim();
        if (!novoStatus) {
            toast.error('Selecione o novo status da entrega.');
            return;
        }

        const elegiveis = selectedVendas.filter((venda) => Boolean(getEntregaAlvoVenda(venda)));
        if (!elegiveis.length) {
            toast.warning('Nenhuma venda selecionada possui entrega elegível para atualização.');
            return;
        }

        const confirmed = await confirm({
            title: 'Alterar status de entrega em lote',
            message: `Deseja atualizar o status de ${elegiveis.length} entrega(s) para "${novoStatus}"?`,
            confirmText: 'Atualizar status'
        });
        if (!confirmed) return;

        await executarAcaoEmLote({
            itens: elegiveis,
            acao: async (venda) => {
                const entrega = getEntregaAlvoVenda(venda);
                await atualizarStatusEntrega({
                    entrega,
                    status: novoStatus,
                    observacoes: bulkStatusEntregaForm.observacoes,
                });
            }
        });

        setBulkStatusEntregaOpen(false);
        setBulkStatusEntregaForm({ status: 'Pendente', observacoes: '' });
    };

    const handleConfirmarStatusMontagem = async () => {
        if (!modalStatusMontagemVenda) return;

        try {
            await atualizarStatusMontagem({
                montagensVenda: modalStatusMontagemVenda.montagens,
                status: statusMontagemForm.status
            });

            queryClient.invalidateQueries({ queryKey: ['montagens'] });
            queryClient.invalidateQueries({ queryKey: ['vendas'] });
            toast.success('Status da montagem atualizado com sucesso.');

            setModalStatusMontagemVenda(null);
            setStatusMontagemForm({ status: 'pendente' });
        } catch (error) {
            toast.error(error?.message || 'Não foi possível atualizar o status da montagem.');
        }
    };

    const handleBulkAtualizarStatusMontagem = async () => {
        const novoStatus = String(bulkStatusMontagemForm.status || '').trim();
        if (!novoStatus) {
            toast.error('Selecione o novo status da montagem.');
            return;
        }

        const elegiveis = selectedVendas.filter((venda) => getMontagensAlvoVenda(venda).length > 0);
        if (!elegiveis.length) {
            toast.warning('Nenhuma venda selecionada possui montagem elegível para atualização.');
            return;
        }

        const confirmed = await confirm({
            title: 'Alterar status de montagem em lote',
            message: `Deseja atualizar o status de montagem de ${elegiveis.length} pedido(s) para "${novoStatus}"?`,
            confirmText: 'Atualizar status'
        });
        if (!confirmed) return;

        await executarAcaoEmLote({
            itens: elegiveis,
            acao: async (venda) => {
                const montagensVenda = getMontagensAlvoVenda(venda);
                await atualizarStatusMontagem({
                    montagensVenda,
                    status: novoStatus
                });
            }
        });

        setBulkStatusMontagemOpen(false);
        setBulkStatusMontagemForm({ status: 'pendente' });
    };

    const getSellerName = (venda) => {
        if (!venda?.responsavel_id) return '-';
        const responsavelId = String(venda.responsavel_id).toLowerCase();
        const seller = users.find((item) =>
            String(item.id || '').toLowerCase() === responsavelId
            || String(item.email || '').toLowerCase() === responsavelId
        );
        return seller?.full_name || seller?.email || '-';
    };

    const handleExportPedidos = async () => {
        if (!activeSortedVendas.length) {
            toast.warning('Não há pedidos no filtro atual para exportar.');
            return;
        }

        try {
            const XLSX = await import('xlsx');
            const rows = activeSortedVendas.map((venda) => ({
                Pedido: venda.numero_pedido || '',
                Cliente: formatarNome(venda.cliente_nome || ''),
                Telefone: formatarTelefone(venda.cliente_telefone || ''),
                Data: formatarDataExibicao(venda.data_venda),
                Produtos: (venda.itens || []).map((item) => `${item.quantidade || 0}x ${buildProductDisplayName(item.produto_nome || item.nome, item.modelo_referencia)}`).join(' | '),
                Valor: toMoneyNumber(venda.valor_total),
                Status: ORDER_STAGE_META[venda.orderStage]?.label || venda.status || '',
                Pagamento: venda.financeiro?.displayStatus || '',
                'Previsão de entrega': formatarDataExibicao(venda.resumoLogistico?.entregaPrincipal?.data_agendada) || '',
                Vendedor: getSellerName(venda),
                Loja: venda.loja || '',
            }));
            const worksheet = XLSX.utils.json_to_sheet(rows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Pedidos');
            XLSX.writeFile(workbook, `pedidos-${obterDataLocalString()}.xlsx`);
        } catch (error) {
            console.error('Erro ao exportar pedidos:', error);
            toast.error('Não foi possível exportar os pedidos.');
        }
    };

    const handleStageTab = (stage) => {
        if (stage === 'cancelado') {
            setActiveTab('cancelados');
            setOrderStageFilter('all');
            return;
        }
        setActiveTab('vendas');
        setOrderStageFilter(stage);
    };

    return (
        <div className="w-full max-w-[1680px] mx-auto space-y-5">

            {activeTab !== 'arquivo' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                        {[
                            { key: 'all', label: 'Todos os pedidos', value: dashboardStats.total, icon: FileText, tone: 'emerald', detail: 'Total no seu acesso' },
                            { key: 'andamento', label: 'Em andamento', value: dashboardStats.andamento, icon: Clock, tone: 'emerald', detail: `${dashboardPercent(dashboardStats.andamento)} do total` },
                            { key: 'producao', label: 'Em produção', value: dashboardStats.producao, icon: Package, tone: 'amber', detail: `${dashboardPercent(dashboardStats.producao)} do total` },
                            { key: 'saiu_entrega', label: 'Saiu para entrega', value: dashboardStats.saiu_entrega, icon: Truck, tone: 'sky', detail: `${dashboardPercent(dashboardStats.saiu_entrega)} do total` },
                            { key: 'entregue', label: 'Entregues (mês)', value: dashboardStats.entregue, icon: CheckCircle, tone: 'emerald', detail: `${dashboardPercent(dashboardStats.entregue)} do total` },
                            { key: 'cancelado', label: 'Cancelados', value: dashboardStats.cancelado, icon: XCircle, tone: 'rose', detail: `${dashboardPercent(dashboardStats.cancelado)} do total` },
                        ].map((stat) => {
                            const Icon = stat.icon;
                            const iconStyles = {
                                emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
                                amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
                                sky: 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400',
                                rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400',
                            };
                            return (
                                <button
                                    type="button"
                                    key={stat.key}
                                    onClick={() => handleStageTab(stat.key)}
                                    className="group rounded-xl border border-slate-200/80 bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
                                >
                                    <div className="flex items-start gap-3">
                                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconStyles[stat.tone]}`}>
                                            <Icon className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{stat.label}</span>
                                            <span className="mt-0.5 block text-xl font-bold leading-none text-slate-900 dark:text-white">{stat.value}</span>
                                            <span className="mt-1 block truncate text-[10px] text-slate-400 dark:text-slate-500">{stat.detail}</span>
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] dark:border-neutral-800 dark:bg-neutral-900">
                        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 dark:border-neutral-800">
                            <div className="flex min-w-0 items-center gap-6 overflow-x-auto">
                                {[
                                    { key: 'all', label: 'Todos' },
                                    { key: 'andamento', label: 'Em andamento' },
                                    { key: 'producao', label: 'Em produção' },
                                    { key: 'saiu_entrega', label: 'Saiu para entrega' },
                                    { key: 'entregue', label: 'Entregues' },
                                    { key: 'cancelado', label: 'Cancelados' },
                                ].map((tabItem) => {
                                    const isActive = tabItem.key === 'cancelado'
                                        ? activeTab === 'cancelados'
                                        : activeTab === 'vendas' && orderStageFilter === tabItem.key;
                                    return (
                                        <button
                                            type="button"
                                            key={tabItem.key}
                                            onClick={() => handleStageTab(tabItem.key)}
                                            className={`relative h-12 shrink-0 text-xs font-medium transition-colors ${isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
                                        >
                                            {tabItem.label}
                                            {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-emerald-500" />}
                                        </button>
                                    );
                                })}
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab('arquivo')}
                                className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-emerald-700 sm:flex dark:text-slate-400 dark:hover:text-emerald-400"
                            >
                                <Archive className="h-3.5 w-3.5" />
                                Arquivo
                            </button>
                        </div>

                        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-neutral-800">
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                <div className="relative w-full xl:max-w-sm">
                                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        placeholder="Buscar pedido, cliente, produto..."
                                        className="h-9 rounded-lg border-slate-200 bg-white pl-9 text-xs shadow-none dark:border-neutral-700 dark:bg-neutral-950"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                    />
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Select value={periodFilter} onValueChange={setPeriodFilter}>
                                        <SelectTrigger className="h-9 w-[126px] rounded-lg border-slate-200 text-xs shadow-none dark:border-neutral-700">
                                            <CalendarDays className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Período</SelectItem>
                                            <SelectItem value="week">Últimos 7 dias</SelectItem>
                                            <SelectItem value="month">Este mês</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                                        <SelectTrigger className="h-9 w-[138px] rounded-lg border-slate-200 text-xs shadow-none dark:border-neutral-700">
                                            <Filter className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Pagamento</SelectItem>
                                            <SelectItem value="Pagamento Pendente">Pendente</SelectItem>
                                            <SelectItem value="Pago">Pago</SelectItem>
                                            {conferenciaCaixaEnabled && <SelectItem value="aguardando_conferencia">Ag. conferência</SelectItem>}
                                        </SelectContent>
                                    </Select>
                                    <Select value={sellerFilter} onValueChange={setSellerFilter}>
                                        <SelectTrigger className="h-9 w-[138px] rounded-lg border-slate-200 text-xs shadow-none dark:border-neutral-700">
                                            <SelectValue placeholder="Vendedor" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Vendedor</SelectItem>
                                            {vendedoresDisponiveis.map((seller) => (
                                                <SelectItem key={seller.id} value={String(seller.id).toLowerCase()}>{seller.full_name || seller.email}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                                        <SelectTrigger className="h-9 w-[158px] rounded-lg border-slate-200 text-xs shadow-none dark:border-neutral-700">
                                            <SelectValue placeholder="Forma de pagamento" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Forma de pagamento</SelectItem>
                                            {SALES_PAYMENT_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <Button variant="outline" className="h-9 rounded-lg border-slate-200 px-3 text-xs font-medium shadow-none dark:border-neutral-700" onClick={handleExportPedidos}>
                                        <Download className="mr-1.5 h-3.5 w-3.5" />
                                        Exportar
                                    </Button>
                                    {canCreateVendas && (
                                        <Button className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-none hover:bg-emerald-700" onClick={() => navigate('/admin/PDV')}>
                                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                                            Novo pedido
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {showBulkSelectionColumn && selectedVendaIds.length > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/60 px-4 py-3 dark:border-emerald-950 dark:bg-emerald-950/20">
                                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">{selectedVendaIds.length} pedido(s) selecionado(s)</span>
                                <div className="flex flex-wrap gap-2">
                                    {canCancelVendas && <Button size="sm" variant="destructive" onClick={handleBulkCancelar} disabled={isBulkRunning || cancelarVendaMutation.isPending}>Cancelar</Button>}
                                    {canManageVendas && <Button size="sm" variant="outline" onClick={() => setBulkTransferVendedorOpen(true)} disabled={isBulkRunning}>Transferir vendedor</Button>}
                                    {canManageVendas && <Button size="sm" variant="outline" onClick={() => setBulkTransferLojaOpen(true)} disabled={isBulkRunning}>Transferir loja</Button>}
                                    {canManagePayments && <Button size="sm" variant="outline" onClick={() => setBulkPagamentoOpen(true)} disabled={isBulkRunning}>Registrar pagamento</Button>}
                                    {canManageDeliveryStatus && <Button size="sm" variant="outline" onClick={() => setBulkStatusEntregaOpen(true)} disabled={isBulkRunning}>Status da entrega</Button>}
                                    {canManageDeliveryStatus && <Button size="sm" variant="outline" onClick={() => setBulkStatusMontagemOpen(true)} disabled={isBulkRunning}>Status da montagem</Button>}
                                    <Button size="sm" variant="outline" onClick={handleBulkLiberarEntrega} disabled={isBulkRunning}>Liberar entrega</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setSelectedVendaIds([])} disabled={isBulkRunning}>Limpar</Button>
                                </div>
                            </div>
                        )}

                        <div className={`grid min-h-[460px] ${isDashboardDetailOpen && selectedDashboardVenda ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1'}`}>
                            <div className="min-w-0 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-slate-100 bg-slate-50/70 hover:bg-slate-50/70 dark:border-neutral-800 dark:bg-neutral-950/50">
                                                {showBulkSelectionColumn && (
                                                    <TableHead className="w-10 pl-4">
                                                        <Checkbox checked={allVisibleSelected ? true : (someVisibleSelected ? 'indeterminate' : false)} onCheckedChange={(checked) => handleSelectAllVendas(checked === true)} aria-label="Selecionar pedidos visíveis" />
                                                    </TableHead>
                                                )}
                                                {renderSortableHeader('Pedido', 'pedido', 'w-[105px]')}
                                                {renderSortableHeader('Cliente', 'cliente', 'min-w-[170px]')}
                                                <TableHead className="min-w-[190px] text-[10px] font-semibold uppercase tracking-wide text-slate-400">Produtos</TableHead>
                                                {renderSortableHeader('Valor', 'total', 'w-[115px]')}
                                                <TableHead className="w-[130px] text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</TableHead>
                                                <TableHead className="w-[120px] text-[10px] font-semibold uppercase tracking-wide text-slate-400">Previsão entrega</TableHead>
                                                <TableHead className="w-[130px] text-[10px] font-semibold uppercase tracking-wide text-slate-400">Vendedor</TableHead>
                                                <TableHead className="w-14 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ações</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {isLoading ? (
                                                <TableRow><TableCell colSpan={showBulkSelectionColumn ? 9 : 8} className="h-56 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Carregando pedidos...</TableCell></TableRow>
                                            ) : paginatedVendas.length === 0 ? (
                                                <TableRow><TableCell colSpan={showBulkSelectionColumn ? 9 : 8} className="h-56 text-center text-sm text-slate-500"><Package className="mx-auto mb-2 h-8 w-8 text-slate-300" />Nenhum pedido encontrado.</TableCell></TableRow>
                                            ) : paginatedVendas.map((venda) => {
                                                const firstItem = (venda.itens || [])[0];
                                                const firstImage = firstItem?.fotos?.[0] || firstItem?.foto || firstItem?.imagem_url || firstItem?.produto_imagem;
                                                const stageMeta = ORDER_STAGE_META[venda.orderStage] || ORDER_STAGE_META.andamento;
                                                const deliveryDate = venda.resumoLogistico?.entregaPrincipal?.data_agendada;
                                                const sellerName = getSellerName(venda);
                                                return (
                                                    <TableRow
                                                        key={venda.id}
                                                        onClick={() => { setSelectedDashboardVendaId(venda.id); setIsDashboardDetailOpen(true); }}
                                                        className={`cursor-pointer border-slate-100 transition-colors dark:border-neutral-800 ${selectedDashboardVenda?.id === venda.id && isDashboardDetailOpen ? 'bg-emerald-50/50 hover:bg-emerald-50/70 dark:bg-emerald-950/10' : 'hover:bg-slate-50/70 dark:hover:bg-neutral-800/50'}`}
                                                    >
                                                        {showBulkSelectionColumn && <TableCell className="pl-4" onClick={(event) => event.stopPropagation()}><Checkbox checked={selectedIdsSet.has(venda.id)} onCheckedChange={(checked) => handleToggleSelectVenda(venda.id, checked === true)} aria-label={`Selecionar pedido ${venda.numero_pedido}`} /></TableCell>}
                                                        <TableCell>
                                                            <div className="font-semibold text-slate-900 dark:text-white">#{venda.numero_pedido}</div>
                                                            <div className="mt-0.5 text-[10px] text-slate-400">{formatarDataExibicao(venda.data_venda)}</div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">{formatarNome(venda.cliente_nome)}</div>
                                                            <div className="mt-0.5 truncate text-[10px] text-slate-400">{formatarTelefone(venda.cliente_telefone) || venda.loja || '-'}</div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2.5">
                                                                <div className="flex h-9 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 dark:bg-neutral-800">
                                                                    {firstImage ? <img src={firstImage} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-slate-400" />}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">{firstItem ? buildProductDisplayName(firstItem.produto_nome || firstItem.nome, firstItem.modelo_referencia) : 'Sem itens informados'}</div>
                                                                    <div className="mt-0.5 text-[10px] text-slate-400">{(venda.itens || []).length > 1 ? `+${(venda.itens || []).length - 1} item(ns)` : `${firstItem?.quantidade || 0} unidade(s)`}</div>
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-xs font-semibold text-slate-900 dark:text-white">R$ {toMoneyNumber(venda.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                        <TableCell><Badge variant="outline" className={`whitespace-nowrap border px-2 py-0.5 text-[9px] font-semibold ${stageMeta.className}`}>{stageMeta.label}</Badge></TableCell>
                                                        <TableCell className="text-[11px] text-slate-500 dark:text-slate-400">{deliveryDate ? formatarDataExibicao(deliveryDate) : '-'}</TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500 dark:bg-neutral-800 dark:text-slate-300">{sellerName !== '-' ? sellerName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() : '-'}</span>
                                                                <span className="max-w-[92px] truncate text-[11px] text-slate-600 dark:text-slate-300">{sellerName}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                                                            <div className="flex justify-end gap-1">
                                                                {conferenciaCaixaEnabled && isAguardandoConferencia(venda) && <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600" title="Editar antes da conferência" onClick={() => { setEdicaoPedidoVenda(venda); setIsEdicaoPedidoOpen(true); }}><Edit2 className="h-3.5 w-3.5" /></Button>}
                                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500" title="Ações do pedido" onClick={() => setModalAcoesVenda(venda)}><MoreHorizontal className="h-4 w-4" /></Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>

                                <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800">
                                    <span className="text-[10px] text-slate-400">Mostrando {activeSortedVendas.length ? pageStart + 1 : 0} a {Math.min(pageStart + pageSize, activeSortedVendas.length)} de {activeSortedVendas.length} pedidos</span>
                                    <div className="flex items-center gap-2">
                                        <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                                            <SelectTrigger className="h-7 w-[96px] text-[10px]"><SelectValue /></SelectTrigger>
                                            <SelectContent><SelectItem value="10">10 por página</SelectItem><SelectItem value="20">20 por página</SelectItem><SelectItem value="50">50 por página</SelectItem></SelectContent>
                                        </Select>
                                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                                        <span className="min-w-14 text-center text-[10px] text-slate-500">{Math.min(currentPage, totalPages)} / {totalPages}</span>
                                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}><ChevronRight className="h-3.5 w-3.5" /></Button>
                                    </div>
                                </div>
                            </div>

                            {isDashboardDetailOpen && selectedDashboardVenda && (() => {
                                const venda = selectedDashboardVenda;
                                const stageMeta = ORDER_STAGE_META[venda.orderStage] || ORDER_STAGE_META.andamento;
                                const entrega = venda.resumoLogistico?.entregaPrincipal;
                                const subtotal = toMoneyNumber(venda.subtotal ?? venda.valor_subtotal ?? venda.valor_total);
                                const discount = toMoneyNumber(venda.desconto ?? venda.valor_desconto);
                                const freight = toMoneyNumber(venda.valor_frete ?? venda.frete);
                                const phoneDigits = String(venda.cliente_telefone || '').replace(/\D/g, '');
                                const whatsappPhone = phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`;
                                return (
                                    <aside className="border-l border-slate-100 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                                        <div className="flex items-start justify-between border-b border-slate-100 p-4 dark:border-neutral-800">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Pedido #{venda.numero_pedido}</h3>
                                                <Badge variant="outline" className={`mt-2 border px-2 py-0.5 text-[9px] font-semibold ${stageMeta.className}`}>{stageMeta.label}</Badge>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400" aria-label="Fechar detalhes" onClick={() => setIsDashboardDetailOpen(false)}><XCircle className="h-4 w-4" /></Button>
                                        </div>
                                        <div className="max-h-[610px] space-y-5 overflow-y-auto p-4">
                                            <section>
                                                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Cliente</span>
                                                <div className="mt-2 flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{formatarNome(venda.cliente_nome)}</div>
                                                        <div className="mt-0.5 text-[10px] text-slate-400">{formatarTelefone(venda.cliente_telefone) || 'Telefone não informado'}</div>
                                                    </div>
                                                    {phoneDigits && (
                                                        <div className="flex gap-1">
                                                            <a href={`https://wa.me/${whatsappPhone}`} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50" title="Abrir WhatsApp"><MessageCircle className="h-3.5 w-3.5" /></a>
                                                            <a href={`tel:${phoneDigits}`} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="Ligar"><Phone className="h-3.5 w-3.5" /></a>
                                                        </div>
                                                    )}
                                                </div>
                                            </section>

                                            <section>
                                                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Resumo do pedido</span>
                                                <dl className="mt-2 space-y-2 text-[10px]">
                                                    <div className="flex justify-between gap-3"><dt className="text-slate-400">Data do pedido</dt><dd className="text-right font-medium text-slate-600 dark:text-slate-300">{formatarDataExibicao(venda.data_venda)}</dd></div>
                                                    <div className="flex justify-between gap-3"><dt className="text-slate-400">Previsão de entrega</dt><dd className="text-right font-medium text-slate-600 dark:text-slate-300">{entrega?.data_agendada ? formatarDataExibicao(entrega.data_agendada) : 'Não agendada'}</dd></div>
                                                    <div className="flex justify-between gap-3"><dt className="text-slate-400">Forma de pagamento</dt><dd className="max-w-[150px] truncate text-right font-medium text-slate-600 dark:text-slate-300">{venda.forma_pagamento || 'Não informada'}</dd></div>
                                                    <div className="flex justify-between gap-3"><dt className="text-slate-400">Vendedor</dt><dd className="max-w-[150px] truncate text-right font-medium text-slate-600 dark:text-slate-300">{getSellerName(venda)}</dd></div>
                                                </dl>
                                            </section>

                                            <section>
                                                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Itens do pedido ({(venda.itens || []).length})</span>
                                                <div className="mt-2 space-y-3">
                                                    {(venda.itens || []).map((item, index) => {
                                                        const image = item?.fotos?.[0] || item?.foto || item?.imagem_url || item?.produto_imagem;
                                                        const unitValue = toMoneyNumber(item.preco_unitario ?? item.valor_unitario ?? item.preco);
                                                        return (
                                                            <div key={item.id || `${item.produto_id || 'item'}-${index}`} className="flex gap-2.5">
                                                                <div className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 dark:bg-neutral-800">{image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-slate-400" />}</div>
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="line-clamp-2 text-[10px] font-medium leading-4 text-slate-700 dark:text-slate-200">{buildProductDisplayName(item.produto_nome || item.nome, item.modelo_referencia)}</div>
                                                                    <div className="mt-0.5 flex justify-between text-[9px] text-slate-400"><span>Qtd. {item.quantidade || 0}</span>{unitValue > 0 && <span>R$ {unitValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}</div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </section>

                                            <section>
                                                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Resumo financeiro</span>
                                                <dl className="mt-2 space-y-2 text-[10px]">
                                                    <div className="flex justify-between"><dt className="text-slate-400">Subtotal</dt><dd className="font-medium text-slate-600 dark:text-slate-300">R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</dd></div>
                                                    {discount > 0 && <div className="flex justify-between"><dt className="text-slate-400">Desconto</dt><dd className="font-medium text-rose-600">- R$ {discount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</dd></div>}
                                                    {freight > 0 && <div className="flex justify-between"><dt className="text-slate-400">Frete</dt><dd className="font-medium text-slate-600 dark:text-slate-300">R$ {freight.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</dd></div>}
                                                    <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-neutral-800"><dt className="font-semibold text-slate-700 dark:text-slate-200">Total</dt><dd className="text-sm font-bold text-emerald-600">R$ {toMoneyNumber(venda.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</dd></div>
                                                </dl>
                                            </section>

                                            <div className="space-y-2 pt-1">
                                                <Button variant="outline" className="h-9 w-full rounded-lg border-emerald-200 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50" onClick={() => { setSelectedVendaDetalhes(venda); setIsDetalhesModalOpen(true); }}>Ver detalhes completos</Button>
                                                <Button className="h-9 w-full rounded-lg bg-emerald-600 text-[10px] font-semibold text-white hover:bg-emerald-700" onClick={() => setModalAcoesVenda(venda)}>Ações do pedido <ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Button>
                                            </div>
                                        </div>
                                    </aside>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}


            {/* Sistema de Abas */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className={activeTab === 'arquivo' ? 'block' : 'hidden'}>
                <TabsList className="grid w-full max-w-lg grid-cols-3">
                    <TabsTrigger value="vendas" className="flex items-center gap-2">
                        <ShoppingCart className="w-4 h-4" />
                        Pedidos
                    </TabsTrigger>
                    <TabsTrigger value="cancelados" className="flex items-center gap-2">
                        <XCircle className="w-4 h-4" />
                        Cancelados
                    </TabsTrigger>
                    <TabsTrigger value="arquivo" className="flex items-center gap-2">
                        <Archive className="w-4 h-4" />
                        Arquivo
                    </TabsTrigger>
                </TabsList>

                {/* Aba Vendas */}
                <TabsContent value="vendas" className="space-y-4">
                    <div className="flex gap-4 items-center bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Buscar por cliente ou nº do pedido..."
                                className="pl-9 border-gray-200 dark:border-neutral-700"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[220px] border-gray-200 dark:border-neutral-700">
                                <div className="flex items-center gap-2 text-gray-500">
                                    <Filter className="w-4 h-4" />
                                    <SelectValue placeholder="Status" />
                                </div>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os status</SelectItem>
                                <SelectItem value="Pagamento Pendente">Pendente</SelectItem>
                                <SelectItem value="Pago">Pago</SelectItem>
                                {conferenciaCaixaEnabled && (
                                    <SelectItem value="aguardando_conferencia">
                                        <div className="flex items-center gap-2">
                                            <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                                            Aguardando Conferência
                                        </div>
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {showBulkSelectionColumn && selectedVendaIds.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800">
                            <div className="text-sm text-gray-700 dark:text-gray-300">
                                <span className="font-semibold">{selectedVendaIds.length}</span> venda(s) selecionada(s)
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {canCancelVendas && (
                                    <Button size="sm" variant="destructive" onClick={handleBulkCancelar} disabled={isBulkRunning || cancelarVendaMutation.isPending}>
                                        {isBulkRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                                        Cancelar em lote
                                    </Button>
                                )}
                                {canManageVendas && (
                                    <>
                                        <Button size="sm" variant="outline" onClick={() => setBulkTransferVendedorOpen(true)} disabled={isBulkRunning}>
                                            Transferir vendedor
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => setBulkTransferLojaOpen(true)} disabled={isBulkRunning}>
                                            Transferir loja
                                        </Button>
                                    </>
                                )}
                                {canManagePayments && (
                                    <Button size="sm" variant="outline" onClick={() => setBulkPagamentoOpen(true)} disabled={isBulkRunning}>
                                        Registrar pagamento
                                    </Button>
                                )}
                                {canManageDeliveryStatus && (
                                    <>
                                        <Button size="sm" variant="outline" onClick={() => setBulkStatusEntregaOpen(true)} disabled={isBulkRunning}>
                                            Status da entrega
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => setBulkStatusMontagemOpen(true)} disabled={isBulkRunning}>
                                            Status da montagem
                                        </Button>
                                    </>
                                )}
                                <Button size="sm" variant="outline" onClick={handleBulkLiberarEntrega} disabled={isBulkRunning}>
                                    Liberar entrega
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setSelectedVendaIds([])} disabled={isBulkRunning}>
                                    Limpar seleção
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800 overflow-hidden">
                        <Table>
                            <TableHeader className="bg-gray-50 dark:bg-neutral-950">
                                <TableRow>
                                    {showBulkSelectionColumn && (
                                        <TableHead className="w-[48px]">
                                            <Checkbox
                                                checked={allVisibleSelected ? true : (someVisibleSelected ? 'indeterminate' : false)}
                                                onCheckedChange={(checked) => handleSelectAllVendas(checked === true)}
                                                aria-label="Selecionar todas as vendas"
                                            />
                                        </TableHead>
                                    )}
                                    {renderSortableHeader('Pedido', 'pedido', 'w-[100px]')}
                                    {renderSortableHeader('Cliente', 'cliente', 'min-w-[220px]')}
                                    {renderSortableHeader('Data', 'data')}
                                    {renderSortableHeader('Total', 'total')}
                                    <TableHead>Produtos</TableHead>
                                    <TableHead>Loja</TableHead>
                                    <TableHead>Vendedor</TableHead>
                                    <TableHead>Situação</TableHead>

                                    <TableHead>
                                        <div className="flex items-center gap-2">
                                            Andamento
                                            <HoverCard>
                                                <HoverCardTrigger asChild>
                                                    <Info className="h-4 w-4 text-gray-400 cursor-help" />
                                                </HoverCardTrigger>
                                                <HoverCardContent className="w-80">
                                                    <div className="space-y-2">
                                                        <h4 className="text-sm font-semibold">Legenda de Status</h4>
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Badge className="bg-orange-100 text-orange-700 border-orange-200 h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                                                    <ClipboardList className="h-3 w-3" />
                                                                </Badge>
                                                                <span className="text-gray-600">Pendente Triagem (Sem data)</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                                                    <Package className="h-3 w-3" />
                                                                </Badge>
                                                                <span className="text-gray-600">Aguardando Expedição</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                                                    <Clock className="h-3 w-3" />
                                                                </Badge>
                                                                <span className="text-gray-600">A Agendar (Sem data definida)</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Badge className="bg-amber-100 text-amber-700 border-amber-200 h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                                                    <Truck className="h-3 w-3" />
                                                                </Badge>
                                                                <span className="text-gray-600">Entrega Agendada / Pendente</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Badge className="bg-blue-100 text-blue-700 border-blue-200 h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                                                    <Truck className="h-3 w-3" />
                                                                </Badge>
                                                                <span className="text-gray-600">Em Rota de Entrega</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Badge className="bg-green-100 text-green-700 border-green-200 h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                                                    <CheckCircle className="h-3 w-3" />
                                                                </Badge>
                                                                <span className="text-gray-600">Entregue / Concluído</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Badge className="bg-teal-100 text-teal-700 border-teal-200 h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                                                    <Wrench className="h-3 w-3" />
                                                                </Badge>
                                                                <span className="text-gray-600">Entregue, aguardando montador</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Badge className="bg-amber-100 text-amber-700 border-amber-200 h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                                                    <Wrench className="h-3 w-3" />
                                                                </Badge>
                                                                <span className="text-gray-600">Montagem Pendente</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </HoverCardContent>
                                            </HoverCard>
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={tableColSpanVendas} className="text-center py-8 text-gray-500">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                            Carregando vendas...
                                        </TableCell>
                                    </TableRow>
                                ) : sortedFiltered.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={tableColSpanVendas} className="text-center py-8 text-gray-500">
                                            Nenhuma venda encontrada.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    sortedFiltered.map(venda => {
                                        const financeiro = venda.financeiro;

                                        return (
                                        <TableRow
                                            key={venda.id}
                                            className={`cursor-pointer hover:bg-muted/50 transition-colors ${selectedIdsSet.has(venda.id) ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}
                                            onClick={() => {
                                                setSelectedVendaDetalhes(venda);
                                                setIsDetalhesModalOpen(true);
                                            }}
                                        >
                                            {showBulkSelectionColumn && (
                                                <TableCell onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox
                                                        checked={selectedIdsSet.has(venda.id)}
                                                        onCheckedChange={(checked) => handleToggleSelectVenda(venda.id, checked === true)}
                                                        aria-label={`Selecionar venda ${venda.numero_pedido}`}
                                                    />
                                                </TableCell>
                                            )}
                                            <TableCell className="font-medium">#{venda.numero_pedido}</TableCell>
                                            <TableCell className="min-w-[220px]">
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-gray-900 dark:text-white">{formatarNome(venda.cliente_nome)}</span>
                                                    <span className="text-xs text-gray-500">{formatarTelefone(venda.cliente_telefone)}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                                                {formatarDataExibicao(venda.data_venda)}
                                            </TableCell>
                                            <TableCell className="font-bold text-gray-900 dark:text-white">
                                                R$ {venda.valor_total?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </TableCell>
                                            <TableCell>
                                                <div className="max-w-[200px]">
                                                    {(venda.itens || []).slice(0, 2).map((item, idx) => (
                                                        <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                                            {item.quantidade}x {buildProductDisplayName(item.produto_nome || item.nome, item.modelo_referencia)}
                                                        </div>
                                                    ))}
                                                    {(venda.itens || []).length > 2 && (
                                                        <span className="text-[10px] text-gray-400">+{(venda.itens || []).length - 2} mais...</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="font-normal text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-neutral-800">
                                                    {venda.loja}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <span
                                                    className="text-sm text-gray-600 dark:text-gray-400 cursor-help"
                                                    title={`ID: ${venda.responsavel_id}`}
                                                >
                                                    {(() => {
                                                        if (!venda.responsavel_id) return '-';

                                                        // Debug para encontrar o erro
                                                        // console.log('Procurando vendedor:', venda.responsavel_id);
                                                        // console.log('Lista de usuários:', users);

                                                        const responsavelId = String(venda.responsavel_id).toLowerCase();
                                                        const user = users.find(u =>
                                                            String(u.id).toLowerCase() === responsavelId ||
                                                            String(u.email).toLowerCase() === responsavelId
                                                        );

                                                        return user?.full_name || user?.email || '-';
                                                    })()}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1">
                                                    <StatusBadge status={financeiro.displayStatus} />
                                                    {isAguardandoConferencia(venda) && (
                                                        venda.conferencia_caixa_status === 'devolvido' ? (
                                                            <Badge className="text-[10px] h-5 px-1.5 bg-orange-100 text-orange-700 border-orange-200 border font-medium w-fit flex items-center gap-1">
                                                                <AlertTriangle className="w-3 h-3" />
                                                                Devolvido
                                                            </Badge>
                                                        ) : (
                                                            <Badge className="text-[10px] h-5 px-1.5 bg-amber-100 text-amber-700 border-amber-200 border font-medium w-fit flex items-center gap-1">
                                                                <ShieldCheck className="w-3.5 h-3.5" />
                                                                Ag. Conferência
                                                            </Badge>
                                                        )
                                                    )}
                                                </div>
                                            </TableCell>

                                            <TableCell>
                                                <OrderStatusBadge
                                                    venda={venda}
                                                    entregas={entregas}
                                                    montagens={montagens}
                                                    financeiro={financeiro}
                                                />
                                            </TableCell>
                                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center justify-end gap-2">
                                                    {/* Botão de edição para pedidos aguardando conferência */}
                                                    {conferenciaCaixaEnabled && isAguardandoConferencia(venda) && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="border-amber-200 text-amber-700 hover:bg-amber-50"
                                                            title="Editar pedido antes da conferência"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEdicaoPedidoVenda(venda);
                                                                setIsEdicaoPedidoOpen(true);
                                                            }}
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5 mr-1" />
                                                            Editar
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setModalAcoesVenda(venda)}
                                                    >
                                                        Ações
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )})
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* Aba Cancelados */}
                <TabsContent value="cancelados" className="space-y-4">
                    <div className="flex gap-4 items-center bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Buscar por cliente ou nº do pedido..."
                                className="pl-9 border-gray-200 dark:border-neutral-700"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800 overflow-hidden">
                        <Table>
                            <TableHeader className="bg-gray-50 dark:bg-neutral-950">
                                <TableRow>
                                    {renderSortableHeader('Pedido', 'pedido', 'w-[100px]')}
                                    {renderSortableHeader('Cliente', 'cliente', 'min-w-[220px]')}
                                    {renderSortableHeader('Data', 'data')}
                                    {renderSortableHeader('Total', 'total')}
                                    <TableHead>Produtos</TableHead>
                                    <TableHead>Loja</TableHead>
                                    <TableHead>Vendedor</TableHead>
                                    <TableHead>Situação</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                            Carregando...
                                        </TableCell>
                                    </TableRow>
                                ) : sortedFilteredCancelados.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-12 text-gray-500">
                                            <XCircle className="w-10 h-10 mx-auto mb-3 opacity-20" />
                                            <p className="font-medium">Nenhuma venda cancelada encontrada.</p>
                                            <p className="text-sm mt-1">As vendas canceladas aparecerão aqui.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    sortedFilteredCancelados.map(venda => (
                                        <TableRow
                                            key={venda.id}
                                            className="cursor-pointer hover:bg-muted/50 transition-colors opacity-75"
                                            onClick={() => {
                                                setSelectedVendaDetalhes(venda);
                                                setIsDetalhesModalOpen(true);
                                            }}
                                        >
                                            <TableCell className="font-medium">#{venda.numero_pedido}</TableCell>
                                            <TableCell className="min-w-[220px]">
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-gray-900 dark:text-white">{formatarNome(venda.cliente_nome)}</span>
                                                    <span className="text-xs text-gray-500">{formatarTelefone(venda.cliente_telefone)}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                                                {formatarDataExibicao(venda.data_venda)}
                                            </TableCell>
                                            <TableCell className="font-bold text-gray-900 dark:text-white">
                                                R$ {venda.valor_total?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </TableCell>
                                            <TableCell>
                                                <div className="max-w-[200px]">
                                                    {(venda.itens || []).slice(0, 2).map((item, idx) => (
                                                        <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                                            {item.quantidade}x {buildProductDisplayName(item.produto_nome || item.nome, item.modelo_referencia)}
                                                        </div>
                                                    ))}
                                                    {(venda.itens || []).length > 2 && (
                                                        <span className="text-[10px] text-gray-400">+{(venda.itens || []).length - 2} mais...</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="font-normal text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-neutral-800">
                                                    {venda.loja}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                                    {(() => {
                                                        if (!venda.responsavel_id) return '-';
                                                        const responsavelId = String(venda.responsavel_id).toLowerCase();
                                                        const u = users.find(u =>
                                                            String(u.id).toLowerCase() === responsavelId ||
                                                            String(u.email).toLowerCase() === responsavelId
                                                        );
                                                        return u?.full_name || u?.email || '-';
                                                    })()}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <Badge className="bg-red-100 text-red-800 border-red-200 border px-2 py-0.5 text-[10px] uppercase tracking-wider">
                                                    Cancelado
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setModalAcoesVenda(venda)}
                                                >
                                                    Ações
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                {/* Aba Arquivo */}
                <TabsContent value="arquivo">
                    <ArquivoTab />
                </TabsContent>
            </Tabs>

            <VendaDetalhesModal
                isOpen={isDetalhesModalOpen}
                onClose={() => setIsDetalhesModalOpen(false)}
                venda={selectedVendaDetalhes}
                entregas={entregas}
                montagens={montagens}
                lancamentos={lancamentos}
            />

            <Dialog open={!!modalPagamentoVenda} onOpenChange={(open) => !open && setModalPagamentoVenda(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-emerald-700">
                            <CreditCard className="w-5 h-5" />
                            Atualizar Pagamento
                        </DialogTitle>
                        <DialogDescription>
                            Registre pagamento antecipado na loja para o pedido #{modalPagamentoVenda?.numero_pedido}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="rounded-lg border bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                            Saldo atual: <strong>R$ {saldoModalPagamento.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                        </div>

                        <div className="rounded-lg border p-3 space-y-3">
                            <div className="grid gap-3 sm:grid-cols-[1.4fr,1fr,auto] items-end">
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

            {/* Modal Solicitar Reagendamento */}
            <Dialog open={!!modalReagendamento} onOpenChange={() => setModalReagendamento(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-600">
                            <CalendarX className="w-5 h-5" />
                            Solicitar Reagendamento
                        </DialogTitle>
                        <DialogDescription>
                            Motivo pelo qual o cliente não pode receber na data agendada:
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Textarea
                            placeholder="Ex: Cliente estará viajando, pediu para entregar próxima semana..."
                            value={motivoReagendamento}
                            onChange={(e) => setMotivoReagendamento(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalReagendamento(null)}>Cancelar</Button>
                        <Button
                            onClick={confirmarReagendamento}
                            disabled={reagendarMutation.isPending}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {reagendarMutation.isPending ? <Loader2 className="animate-spin" /> : "Confirmar Reagendamento"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!modalStatusEntregaVenda} onOpenChange={(open) => !open && setModalStatusEntregaVenda(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sky-700">
                            <Truck className="w-5 h-5" />
                            Atualizar Status da Entrega
                        </DialogTitle>
                        <DialogDescription>
                            Pedido #{modalStatusEntregaVenda?.venda?.numero_pedido}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Novo status</Label>
                            <Select
                                value={statusEntregaForm.status}
                                onValueChange={(value) => setStatusEntregaForm((prev) => ({ ...prev, status: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_ENTREGA_OPTIONS.map((status) => (
                                        <SelectItem key={status} value={status}>{status}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Observações</Label>
                            <Textarea
                                rows={3}
                                placeholder="Ex: Cliente confirmou recebimento no local."
                                value={statusEntregaForm.observacoes}
                                onChange={(e) => setStatusEntregaForm((prev) => ({ ...prev, observacoes: e.target.value }))}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalStatusEntregaVenda(null)}>Cancelar</Button>
                        <Button onClick={handleConfirmarStatusEntrega} className="bg-sky-600 hover:bg-sky-700">
                            Confirmar status
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>


            {/* Modal de Preferências de Entrega */}
            <Dialog open={!!modalPreferencias} onOpenChange={(open) => !open && setModalPreferencias(null)}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Preferências de Entrega</DialogTitle>
                        <DialogDescription>
                            Defina restrições ou preferências de horário para esta entrega.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-3">
                            <Label>Dias da Semana Permitidos</Label>
                            <div className="grid grid-cols-4 gap-2">
                                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((dia, idx) => (
                                    <RestricaoCheckbox
                                        key={idx}
                                        label={dia}
                                        checked={preferenciasTemp.dias?.includes(idx)}
                                        onCheckedChange={(checked) => {
                                            setPreferenciasTemp(prev => ({
                                                ...prev,
                                                dias: checked
                                                    ? [...(prev.dias || []), idx]
                                                    : (prev.dias || []).filter(d => d !== idx)
                                            }));
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Label>Turnos Permitidos</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {['Manhã', 'Tarde'].map((turno) => (
                                    <RestricaoCheckbox
                                        key={turno}
                                        label={turno}
                                        checked={preferenciasTemp.turnos?.includes(turno)}
                                        onCheckedChange={(checked) => {
                                            setPreferenciasTemp(prev => {
                                                let newTurnos = checked
                                                    ? [...(prev.turnos || []), turno]
                                                    : (prev.turnos || []).filter(t => t !== turno);
                                                if (newTurnos.includes('Manhã') && newTurnos.includes('Tarde')) {
                                                    if (!newTurnos.includes('Comercial')) {
                                                        newTurnos.push('Comercial');
                                                    }
                                                } else {
                                                    newTurnos = newTurnos.filter(t => t !== 'Comercial');
                                                }
                                                return {
                                                    ...prev,
                                                    turnos: newTurnos
                                                };
                                            });
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Observação</Label>
                            <Textarea
                                placeholder="Ex: Ligar antes..."
                                value={preferenciasTemp.obs || ""}
                                onChange={(e) => setPreferenciasTemp(prev => ({ ...prev, obs: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalPreferencias(null)}>Cancelar</Button>
                        <Button
                            onClick={() => salvarPreferenciasMutation.mutate({
                                entregaId: modalPreferencias.entregaId,
                                preferencias: preferenciasTemp
                            })}
                            disabled={salvarPreferenciasMutation.isPending}
                        >
                            {salvarPreferenciasMutation.isPending ? <Loader2 className="animate-spin" /> : "Salvar Preferências"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal de Liberar Entrega */}
            <Dialog open={!!modalLiberarEntrega} onOpenChange={(open) => !open && setModalLiberarEntrega(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-amber-600">
                            <Unlock className="w-5 h-5" />
                            Liberar Entrega para Logística
                        </DialogTitle>
                        <DialogDescription>
                            Você está liberando a entrega para a triagem da logística.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-gray-700 mb-4">
                            <strong>Pedido:</strong> #{modalLiberarEntrega?.pedido}
                        </p>
                        <p className="text-sm text-gray-600">
                            Após confirmar, o pedido voltará para a fila de triagem da logística e poderá ser agendado para entrega.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalLiberarEntrega(null)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={confirmarLiberarEntrega}
                            disabled={liberarEntregaMutation.isPending}
                            className="bg-amber-600 hover:bg-amber-700"
                        >
                            {liberarEntregaMutation.isPending ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Liberando...</>
                            ) : (
                                <><Unlock className="w-4 h-4 mr-2" />Confirmar e Liberar</>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={bulkTransferVendedorOpen} onOpenChange={(open) => !isBulkRunning && setBulkTransferVendedorOpen(open)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Transferir vendedor em lote</DialogTitle>
                        <DialogDescription>
                            Defina o vendedor de destino para as {selectedVendaIds.length} venda(s) selecionada(s).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label>Vendedor destino</Label>
                        <Select value={bulkVendedorId} onValueChange={setBulkVendedorId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione o vendedor" />
                            </SelectTrigger>
                            <SelectContent>
                                {vendedoresDisponiveis.map((vendedor) => (
                                    <SelectItem key={vendedor.id} value={String(vendedor.id)}>
                                        {vendedor.full_name || vendedor.email}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBulkTransferVendedorOpen(false)} disabled={isBulkRunning}>Cancelar</Button>
                        <Button onClick={handleBulkTransferirVendedor} disabled={isBulkRunning || !bulkVendedorId}>
                            {isBulkRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={bulkTransferLojaOpen} onOpenChange={(open) => !isBulkRunning && setBulkTransferLojaOpen(open)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Transferir loja em lote</DialogTitle>
                        <DialogDescription>
                            Defina a loja de destino para as {selectedVendaIds.length} venda(s) selecionada(s).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label>Loja destino</Label>
                        <Select value={bulkLoja} onValueChange={setBulkLoja}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione a loja" />
                            </SelectTrigger>
                            <SelectContent>
                                {lojasDisponiveis.map((loja) => (
                                    <SelectItem key={loja} value={loja}>{loja}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {lojasDisponiveis.length === 0 && (
                            <p className="text-xs text-gray-500">
                                Nenhuma loja de destino disponivel para seu contexto atual.
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBulkTransferLojaOpen(false)} disabled={isBulkRunning}>Cancelar</Button>
                        <Button onClick={handleBulkTransferirLoja} disabled={isBulkRunning || !bulkLoja}>
                            {isBulkRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={bulkPagamentoOpen} onOpenChange={(open) => !isBulkRunning && setBulkPagamentoOpen(open)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Registrar pagamento em lote</DialogTitle>
                        <DialogDescription>
                            Será registrado o valor total pendente de cada venda selecionada.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Forma de pagamento</Label>
                            <Select
                                value={bulkPagamentoForm.forma_pagamento}
                                onValueChange={(value) => setBulkPagamentoForm((prev) => ({ ...prev, forma_pagamento: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                                    <SelectItem value="PIX">PIX</SelectItem>
                                    <SelectItem value="Cartão de Débito">Cartão de Débito</SelectItem>
                                    <SelectItem value="Cartão de Crédito">Cartão de Crédito</SelectItem>
                                    <SelectItem value="Boleto">Boleto</SelectItem>
                                    <SelectItem value="Transferência">Transferência</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Data do pagamento</Label>
                            <Input
                                type="date"
                                value={bulkPagamentoForm.data_pagamento}
                                onChange={(e) => setBulkPagamentoForm((prev) => ({ ...prev, data_pagamento: e.target.value }))}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Observação</Label>
                            <Textarea
                                rows={3}
                                placeholder="Ex: Pagamento registrado em lote na loja."
                                value={bulkPagamentoForm.observacao}
                                onChange={(e) => setBulkPagamentoForm((prev) => ({ ...prev, observacao: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBulkPagamentoOpen(false)} disabled={isBulkRunning}>Cancelar</Button>
                        <Button onClick={handleBulkRegistrarPagamento} disabled={isBulkRunning} className="bg-emerald-600 hover:bg-emerald-700">
                            {isBulkRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Confirmar pagamento
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={bulkStatusEntregaOpen} onOpenChange={(open) => !isBulkRunning && setBulkStatusEntregaOpen(open)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Alterar status de entrega em lote</DialogTitle>
                        <DialogDescription>
                            Atualize o status das entregas vinculadas às {selectedVendaIds.length} venda(s) selecionada(s).
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Novo status</Label>
                            <Select
                                value={bulkStatusEntregaForm.status}
                                onValueChange={(value) => setBulkStatusEntregaForm((prev) => ({ ...prev, status: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_ENTREGA_OPTIONS.map((status) => (
                                        <SelectItem key={status} value={status}>{status}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Observações</Label>
                            <Textarea
                                rows={3}
                                placeholder="Ex: Atualização operacional em lote."
                                value={bulkStatusEntregaForm.observacoes}
                                onChange={(e) => setBulkStatusEntregaForm((prev) => ({ ...prev, observacoes: e.target.value }))}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBulkStatusEntregaOpen(false)} disabled={isBulkRunning}>Cancelar</Button>
                        <Button onClick={handleBulkAtualizarStatusEntrega} disabled={isBulkRunning} className="bg-sky-600 hover:bg-sky-700">
                            {isBulkRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Confirmar status
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={bulkStatusMontagemOpen} onOpenChange={(open) => !isBulkRunning && setBulkStatusMontagemOpen(open)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Alterar status de montagem em lote</DialogTitle>
                        <DialogDescription>
                            Atualize o status das montagens vinculadas aos {selectedVendaIds.length} pedido(s) selecionado(s).
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Novo status</Label>
                            <Select
                                value={bulkStatusMontagemForm.status}
                                onValueChange={(value) => setBulkStatusMontagemForm((prev) => ({ ...prev, status: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_MONTAGEM_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBulkStatusMontagemOpen(false)} disabled={isBulkRunning}>Cancelar</Button>
                        <Button onClick={handleBulkAtualizarStatusMontagem} disabled={isBulkRunning} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                            {isBulkRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Confirmar status
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal de Transferência de Montagem */}
            <TransferirMontagemModal
                isOpen={!!modalTransferencia}
                onClose={() => setModalTransferencia(null)}
                venda={modalTransferencia}
                user={user}
            />

            {/* Modal de Ações da Venda */}
            <Dialog open={!!modalAcoesVenda} onOpenChange={(open) => !open && setModalAcoesVenda(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Settings className="w-5 h-5 text-gray-500" />
                            Ações do Pedido #{modalAcoesVenda?.numero_pedido}
                        </DialogTitle>
                        <DialogDescription>
                            Selecione uma ação para o cliente <strong>{modalAcoesVenda ? formatarNome(modalAcoesVenda.cliente_nome) : ""}</strong>.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-2 py-4">
                        {modalAcoesVenda && (() => {
                            const venda = modalAcoesVenda;
                            const financeiro = venda.financeiro || getVendaFinanceiro(venda, { entregas, lancamentos });
                            const entregaAgendada = entregas.find(e => e.numero_pedido === venda.numero_pedido && e.data_agendada && e.status !== 'Entregue');
                            const entregaAguardando = (entregas || []).find(e =>
                                e.numero_pedido === venda.numero_pedido &&
                                e.status === 'Aguardando Liberação'
                            );
                            const podeLiberar = user?.cargo === 'Administrador' || venda.responsavel_id === user?.id;
                            const entrega = entregas.find(e => e.numero_pedido === venda.numero_pedido && e.status !== 'Entregue');
                            const itensInternosPendentes = montagens.some(m =>
                                m.venda_id === venda.id &&
                                m.tipo_montagem === 'interna' &&
                                m.status !== 'concluida'
                            );

                            return (
                                <>
                                    {/* Nota do Pedido PDF - Sempre disponível */}
                                    <Button
                                        variant="outline"
                                        className="justify-start gap-2 h-11 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                                        onClick={() => {
                                            const clienteCompleto = clientes.find(c => c.id === venda.cliente_id) || { nome_completo: venda.cliente_nome, telefone: venda.cliente_telefone };
                                            let nomeVendedor = venda.responsavel_nome;
                                            if (venda.responsavel_id) {
                                                const u = users.find(user => user.id === venda.responsavel_id);
                                                if (u && u.full_name) nomeVendedor = u.full_name;
                                            }
                                            const lojaInfoPdf = lojasAtivas.find(l => String(l.nome).trim().toLowerCase() === String(venda.loja || '').trim().toLowerCase()) || null;
                                            abrirNotaPedidoPDF(venda, clienteCompleto, nomeVendedor || user?.full_name, lojaInfoPdf ? { ...lojaInfoPdf, empresa_nome: brandName } : null);
                                            setModalAcoesVenda(null);
                                        }}
                                    >
                                        <FileText className="w-4 h-4" />
                                        Visualizar Nota do Pedido (PDF)
                                    </Button>

                                    {/* Atualizar Pagamento */}
                                    {canManagePayments && financeiro.valorRestante > MONEY_EPSILON && !isVendaCancelada(venda) && (
                                        <Button
                                            variant="outline"
                                            className="justify-start gap-2 h-11 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                                            onClick={() => {
                                                abrirModalPagamento(venda);
                                                setModalAcoesVenda(null);
                                            }}
                                        >
                                            <CreditCard className="w-4 h-4" />
                                            Registrar/Atualizar Pagamento
                                        </Button>
                                    )}

                                    {/* Alterar Status da Entrega */}
                                    {canManageDeliveryStatus && (
                                        <>
                                            <Button
                                                variant="outline"
                                                className="justify-start gap-2 h-11 text-sky-600 hover:text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/20"
                                                onClick={() => {
                                                    abrirModalStatusEntrega(venda);
                                                    setModalAcoesVenda(null);
                                                }}
                                            >
                                                <Truck className="w-4 h-4" />
                                                Alterar Status da Entrega
                                            </Button>
                                            <Button
                                                variant="outline"
                                                className="justify-start gap-2 h-11 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/20"
                                                onClick={() => {
                                                    abrirModalStatusMontagem(venda);
                                                    setModalAcoesVenda(null);
                                                }}
                                            >
                                                <Wrench className="w-4 h-4" />
                                                Alterar Status da Montagem
                                            </Button>
                                        </>
                                    )}

                                    {/* Liberar Entrega */}
                                    {entregaAguardando && podeLiberar && (
                                        <Button
                                            variant="outline"
                                            className="justify-start gap-2 h-11 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                            onClick={() => {
                                                setModalLiberarEntrega({
                                                    entregaId: entregaAguardando.id,
                                                    pedido: venda.numero_pedido
                                                });
                                                setModalAcoesVenda(null);
                                            }}
                                        >
                                            <Unlock className="w-4 h-4" />
                                            Liberar Entrega para Logística
                                        </Button>
                                    )}

                                    {/* Preferências de Entrega */}
                                    {entrega && (
                                        <Button
                                            variant="outline"
                                            className="justify-start gap-2 h-11 text-gray-600 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-neutral-800"
                                            onClick={() => {
                                                const prefs = entrega.preferencias_entrega || { dias: [0, 1, 2, 3, 4, 5, 6], turnos: ['Manhã', 'Tarde', 'Comercial'], obs: "" };
                                                setPreferenciasTemp(prefs);
                                                setModalPreferencias({ entregaId: entrega.id });
                                                setModalAcoesVenda(null);
                                            }}
                                        >
                                            <Settings className="w-4 h-4" />
                                            Preferências / Restrições de Entrega
                                        </Button>
                                    )}

                                    {/* Solicitar Reagendamento */}
                                    {entregaAgendada && (
                                        <Button
                                            variant="outline"
                                            className="justify-start gap-2 h-11 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                                            onClick={() => {
                                                setModalReagendamento({
                                                    vendaId: venda.id,
                                                    entregaId: entregaAgendada.id,
                                                    dataAgendada: entregaAgendada.data_agendada,
                                                    turno: entregaAgendada.turno
                                                });
                                                setMotivoReagendamento("");
                                                setModalAcoesVenda(null);
                                            }}
                                        >
                                            <CalendarX className="w-4 h-4" />
                                            Solicitar Reagendamento
                                        </Button>
                                    )}

                                    {/* Transferir Montagem */}
                                    {itensInternosPendentes && (
                                        <Button
                                            variant="outline"
                                            className="justify-start gap-2 h-11 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                                            onClick={() => {
                                                setModalTransferencia(venda);
                                                setModalAcoesVenda(null);
                                            }}
                                        >
                                            <ArrowRightLeft className="w-4 h-4" />
                                            Transferir Montagem para Externo
                                        </Button>
                                    )}

                                    {/* Separador */}
                                    {canCancelVendas && !isVendaCancelada(venda) && (
                                        <div className="border-t my-1 dark:border-neutral-800" />
                                    )}

                                    {/* Cancelar Venda */}
                                    {canCancelVendas && !isVendaCancelada(venda) && (
                                        <Button
                                            variant="destructive"
                                            className="justify-start gap-2 h-11"
                                            onClick={() => {
                                                handleCancelarVenda(venda);
                                                setModalAcoesVenda(null);
                                            }}
                                        >
                                            <XCircle className="w-4 h-4" />
                                            Cancelar Venda
                                        </Button>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalAcoesVenda(null)}>
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!modalStatusMontagemVenda} onOpenChange={(open) => !open && setModalStatusMontagemVenda(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Alterar Status da Montagem</DialogTitle>
                        <DialogDescription>
                            Pedido #{modalStatusMontagemVenda?.venda?.numero_pedido}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Novo status</Label>
                            <Select
                                value={statusMontagemForm.status}
                                onValueChange={(value) => setStatusMontagemForm((prev) => ({ ...prev, status: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_MONTAGEM_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalStatusMontagemVenda(null)}>Cancelar</Button>
                        <Button onClick={handleConfirmarStatusMontagem} className="bg-indigo-600 hover:bg-indigo-700 text-white">Confirmar status</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal de Edição de Pedido (Pré-Conferência) */}
            <EdicaoPedidoModal
                open={isEdicaoPedidoOpen}
                onClose={() => {
                    setIsEdicaoPedidoOpen(false);
                    setEdicaoPedidoVenda(null);
                }}
                venda={edicaoPedidoVenda}
                onSalvar={() => {
                    queryClient.invalidateQueries({ queryKey: ['vendas'] });
                }}
            />
        </div >
    );
}

function StatusBadge({ status }) {
    const styles = {
        "Pago": "bg-green-100 text-green-800 border-green-200",
        "Pagamento Pendente": "bg-yellow-100 text-yellow-800 border-yellow-200",
        "Cancelado": "bg-red-100 text-red-800 border-red-200"
    };
    return (
        <Badge className={`${styles[status] || "bg-gray-100 text-gray-800"} border px-2 py-0.5 text-[10px] uppercase tracking-wider`}>
            {status}
        </Badge>
    );
}

function PaymentStatusBadge({ status, linkPagamento, cliente, numeroPedido, valorTotal }) {
    const enviarCobranca = () => {
        if (!linkPagamento || !cliente?.telefone) return;
        const telefone = cliente.telefone.replace(/\D/g, '');
        const telefoneFormatado = telefone.startsWith('55') ? telefone : `55${telefone}`;
        const mensagem = encodeURIComponent(
            `Olá ${cliente?.nome?.split(' ')[0] || 'Cliente'}! \ud83d\udc4b\n\n` +
            `Notamos que o pagamento do seu pedido #${numeroPedido} ainda está pendente.\n\n` +
            `\ud83d\udcb0 Valor: R$ ${valorTotal?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n` +
            `\ud83d\udd17 Pague agora: ${linkPagamento}\n\n` +
            `Qualquer dúvida, estamos \u00e0 disposi\u00e7\u00e3o! \ud83d\uded4\ufe0f`
        );
        window.open(`https://wa.me/${telefoneFormatado}?text=${mensagem}`, '_blank');
    };

    if (!status) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    const statusStyles = {
        'PAGO': 'bg-green-100 text-green-800 border-green-200',
        'DISPONIVEL': 'bg-green-100 text-green-800 border-green-200',
        'AGUARDANDO_PAGAMENTO': 'bg-orange-100 text-orange-800 border-orange-200',
        'PENDENTE': 'bg-yellow-100 text-yellow-800 border-yellow-200',
        'EM_ANALISE': 'bg-blue-100 text-blue-800 border-blue-200',
        'RECUSADO': 'bg-red-100 text-red-800 border-red-200',
        'CANCELADO': 'bg-red-100 text-red-800 border-red-200'
    };

    const statusLabels = {
        'PAGO': 'Pago',
        'DISPONIVEL': 'Pago',
        'AGUARDANDO_PAGAMENTO': 'Aguardando',
        'PENDENTE': 'Pendente',
        'EM_ANALISE': 'Em Análise',
        'RECUSADO': 'Recusado',
        'CANCELADO': 'Cancelado'
    };

    const isPending = ['AGUARDANDO_PAGAMENTO', 'PENDENTE'].includes(status);

    return (
        <div className="flex items-center gap-2">
            <Badge className={`${statusStyles[status] || 'bg-gray-100 text-gray-800'} border px-2 py-0.5 text-[10px] uppercase tracking-wider`}>
                {statusLabels[status] || status}
            </Badge>
            {isPending && linkPagamento && cliente?.telefone && (
                <Button variant="ghost" size="icon" onClick={enviarCobranca} title="Cobrar via WhatsApp" className="h-6 w-6">
                    <MessageCircle className="w-3.5 h-3.5 text-green-600" />
                </Button>
            )}
            {linkPagamento && (
                <Button variant="ghost" size="icon" onClick={() => window.open(linkPagamento, '_blank')} title="Ver Link de Pagamento" className="h-6 w-6">
                    <Link2 className="w-3.5 h-3.5 text-blue-600" />
                </Button>
            )}
        </div>
    );
}

// Componente para status operacional do pedido
function OrderStatusBadge({ venda, entregas, montagens, financeiro }) {
    // Se a venda foi cancelada, mostrar isso
    if (isVendaCancelada(venda)) {
        return (
            <Badge className="bg-red-100 text-red-700 border border-red-200 gap-1 w-fit">
                <XCircle className="w-3 h-3" />
                Cancelado
            </Badge>
        );
    }

    const badges = [];
    const isStatusFinalizado = (status) => {
        const normalized = String(status || '').toLowerCase();
        return normalized === 'entregue' || normalized === 'retirado' || normalized === 'concluida' || normalized === 'concluída';
    };

    const pushBadge = (key, className, Icon, label) => {
        badges.push(
            <Badge key={key} className={`${className} gap-1 w-fit whitespace-nowrap`}>
                <Icon className="w-3 h-3" />
                {label}
            </Badge>
        );
    };

    // 0. Pre-calculating delivery info to avoid conflicting statuses
    const resumoLogistico = getVendaResumoLogistico(venda, { entregas, montagens });
    const entregasVenda = entregas.filter(e => e.numero_pedido === venda.numero_pedido);
    const temDataEntrega = entregasVenda.some(e => e.data_agendada);
    
    const temEntregaEmAndamento = entregasVenda.some(e => {
        const status = String(e.status || '').toLowerCase();
        return ['entregue', 'retirado', 'em rota', 'agendada', 'concluida', 'concluída'].includes(status);
    });
    
    const triagemPendente = !venda.triagem_realizada && !temDataEntrega && !temEntregaEmAndamento;
    const pagamentoPendente = financeiro?.isPending;

    // 1. Verificação de Triagem
    if (triagemPendente) {
        pushBadge('triagem', 'bg-orange-100 text-orange-700 border border-orange-200', ClipboardList, 'Pendente Triagem');
    }

    let showRetirado = false;
    let showEntregue = false;
    let showMontado = false;
    let showMontagemPendente = false;

    // 2. Verificação de Entrega
    // Se a triagem ainda não foi realizada e não existe data, não mostramos status de entrega/montagem.
    if (!triagemPendente) {
        // Se não tem entregas criadas
        if (entregasVenda.length === 0) {
            // Verificar se todos os itens são do tipo 'retira' (Cliente Retira)
            const todosRetira = resumoLogistico.allRetirada;

            if (resumoLogistico.isMisto) {
                pushBadge('misto', 'bg-indigo-100 text-indigo-700 border border-indigo-200', Package, 'Pedido Misto');
            }

            if (todosRetira && venda.itens?.length > 0) {
                pushBadge('retira', 'bg-purple-100 text-purple-700 border border-purple-200', UserCheck, 'Cliente Retira');
            } else if (venda.triagem_realizada && !pagamentoPendente) {
                // SÓ mostra Aguardando Expedição se a triagem já foi feita e o pagamento não está pendente.
                pushBadge('processando', 'bg-yellow-100 text-yellow-700 border border-yellow-200', Package, 'Aguardando Expedição');
            }
        } else {
            // Tem entregas
            const entrega = resumoLogistico.entregaPrincipal || entregasVenda[0];
            const dataEntrega = entrega.data_agendada ? formatarDataExibicao(entrega.data_agendada) : null;

            const todosRetira = resumoLogistico.allRetirada;

            if (resumoLogistico.isMisto) {
                pushBadge('misto', 'bg-indigo-100 text-indigo-700 border border-indigo-200', Package, 'Pedido Misto');
            }

            if (todosRetira) {
                if (isStatusFinalizado(entrega.status)) {
                    showRetirado = true;
                } else {
                    pushBadge('retirada_pendente', 'bg-purple-100 text-purple-700 border border-purple-200', UserCheck, 'Aguardando Retirada');
                }
            } else {
                // Entrega Comum
                if (isStatusFinalizado(entrega.status)) {
                    showEntregue = true;
                } else if (entrega.status === 'Em Rota') {
                    pushBadge('em_rota', 'bg-blue-100 text-blue-700 border border-blue-200', Truck, 'Em Rota');
                } else {
                    const hojeIso = obterDataLocalString();
                    const dataEntregaIso = entrega.data_agendada ? entrega.data_agendada.split('T')[0] : null;
                    const isAtrasada = dataEntregaIso && dataEntregaIso < hojeIso;

                    if (isAtrasada) {
                        pushBadge('ent_atrasada', 'bg-red-100 text-red-700 border border-red-200', AlertTriangle, `Atrasada: ${dataEntrega}`);
                    } else {
                        pushBadge('ent_pendente', 'bg-amber-100 text-amber-700 border border-amber-200', Truck, `Entrega: ${dataEntrega || 'A Agendar'}`);
                    }
                }
            }
        }
    }

    // 3. Verificação de Montagem
    const temMontagem = resumoLogistico.contagens.montagemInterna > 0 || resumoLogistico.contagens.montagemExterna > 0;

    if (temMontagem && !triagemPendente && !pagamentoPendente) {
        const montagensVenda = montagens.filter(m => m.numero_pedido === venda.numero_pedido);
        const todasConcluidas = montagensVenda.length > 0 && montagensVenda.every(m => m.status === 'concluida');

        if (todasConcluidas) {
            showMontado = true;
        } else {
            showMontagemPendente = true;
        }
    }

    // Processar badges consolidadas
    if (showEntregue && showMontado) {
        pushBadge('concluido_total', 'bg-green-100 text-green-700 border border-green-200', CheckCircle, 'Concluído');
    } else {
        if (showEntregue) pushBadge('entregue', 'bg-green-100 text-green-700 border border-green-200', CheckCircle, 'Entregue');
        if (showMontado) pushBadge('montado', 'bg-green-100 text-green-700 border border-green-200', Wrench, 'Montado');
    }
    
    if (showRetirado) {
        pushBadge('retirado', 'bg-green-100 text-green-700 border border-green-200', CheckCircle, 'Concluído');
    }

    if (showMontagemPendente) {
        pushBadge('mont_pendente', 'bg-amber-100 text-amber-700 border border-amber-200', Wrench, 'Montagem Pendente');
    }

    return (
        <div className="flex flex-col gap-1 items-start">
            {badges}
        </div>
    );
}
