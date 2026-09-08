import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truck, MapPin, Navigation, CheckCircle, Send, Radio, Sun, Sunset, Briefcase, ArrowLeft, Package, AlertTriangle, CreditCard, Camera, PenTool, X, DollarSign, LogOut, Wrench, Link2, MessageCircle, QrCode, Copy, Download, ExternalLink, Check, GripVertical } from "lucide-react";
import { getZapApiUrl } from '../utils/zapApiUrl';
import { useConfirm } from "@/hooks/useConfirm";
import AssinaturaCanvas from "@/components/logistica/AssinaturaCanvas";
import CameraCapture from "@/components/logistica/CameraCapture";
import FotoEntregaCapture from "@/components/logistica/FotoEntregaCapture";
import { supabase } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { whatsappService } from "@/services/whatsappService";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { applyDeliveryPayment, formatMoney, needsDeliveryPaymentConfirmation, toMoneyNumber, MONEY_EPSILON } from "@/utils/deliveryPayment";
import { isStatusCancelado } from "@/utils/vendaStatus";
import { isInstallmentPaymentMethod, validatePaymentSplit } from "@/services/paymentOrchestrator";

const ENTREGADOR_SESSION_KEY = 'entregador_rota_state';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
const PAYMENT_METHOD_OPTIONS = ['Dinheiro', 'PIX', 'Cartão de Débito', 'Cartão de Crédito', 'Boleto', 'Transferência'];
const createEmptyPaymentItem = (defaults = {}) => ({
    forma_pagamento: defaults.forma_pagamento || '',
    valor: defaults.valor || '',
    parcelas: defaults.parcelas || 1,
});

function lerSessaoSalva() {
    try {
        const saved = localStorage.getItem(ENTREGADOR_SESSION_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        if (!parsed.updatedAt || Date.now() - parsed.updatedAt > SESSION_TTL_MS) {
            localStorage.removeItem(ENTREGADOR_SESSION_KEY);
            return null;
        }
        return parsed;
    } catch (e) {
        return null;
    }
}

function statusVendaCancelada(status) {
    return isStatusCancelado(status);
}

// Custom Hook para persistência agressiva do checklist
function useChecklistCache(caminhaoId, dataSelecionada) {
    const [itensConferidos, setItensConferidos] = useState(new Set());
    const cacheKey = `checklist_cache_${dataSelecionada}_${caminhaoId}`;

    // Carregar do localStorage ao iniciar ou mudar chave
    useEffect(() => {
        if (!caminhaoId || !dataSelecionada) return;
        const saved = localStorage.getItem(cacheKey);
        if (saved) {
            try {
                setItensConferidos(new Set(JSON.parse(saved)));
            } catch (e) {
                console.error("Erro ao fazer parse do checklist_cache:", e);
            }
        } else {
            setItensConferidos(new Set());
        }
    }, [cacheKey]);

    // Função para atualizar e salvar imediatamente
    const toggleItem = (itemId) => {
        setItensConferidos(prev => {
            const next = new Set(prev);
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.add(itemId);
            }
            localStorage.setItem(cacheKey, JSON.stringify(Array.from(next)));
            return next;
        });
    };

    const clearCache = () => {
        localStorage.removeItem(cacheKey);
        setItensConferidos(new Set());
    };

    return { itensConferidos, toggleItem, clearCache, setItensConferidos };
}

export default function Entregador() {
    const { brandName, brandLogo, isPaidModuleActive } = useTenant();
    const [user, setUser] = useState(null);

    // Hidratação síncrona do estado da rota a partir de sessão salva localmente
    const _sessaoSalva = lerSessaoSalva();
    const [etapa, setEtapa] = useState(_sessaoSalva?.etapa || 'selecao'); // 'selecao' | 'rota'
    const [rotaIniciada, setRotaIniciada] = useState(_sessaoSalva?.rotaIniciada || false);
    const [enviando, setEnviando] = useState(false);
    const [caminhaoSelecionado, setCaminhaoSelecionado] = useState(_sessaoSalva?.caminhaoSelecionado || null);
    const [turnoSelecionado, setTurnoSelecionado] = useState(_sessaoSalva?.turnoSelecionado || null);
    const [dataSelecionada, setDataSelecionada] = useState(_sessaoSalva?.dataSelecionada || new Date().toISOString().split('T')[0]);
    // false enquanto reconciliação com banco não foi concluída (evita falso "Todas as tarefas concluídas")
    const [sessaoVerificada, setSessaoVerificada] = useState(!_sessaoSalva);
    const gpsInterval = useRef(null);

    // Estados dos modais
    const [modalAssinatura, setModalAssinatura] = useState(null); // entrega ou null
    const [modalFotoEntrega, setModalFotoEntrega] = useState(null); // NOVO: modal de foto dos móveis
    const [modalComprovante, setModalComprovante] = useState(null);
    const [modalFalha, setModalFalha] = useState(null);
    const [observacaoFalha, setObservacaoFalha] = useState("");
    const [fotoFalha, setFotoFalha] = useState(null);
    const [etapaFalha, setEtapaFalha] = useState('foto'); // 'foto' | 'observacao'

    // Estado para modal de conclusão de assistência
    const [modalConcluirAssistencia, setModalConcluirAssistencia] = useState(null);
    const [observacaoAssistencia, setObservacaoAssistencia] = useState("");

    // Estado para modal de link de pagamento

    // Estado para modal de confirmação de pagamento simplificado
    const [modalConfirmaPagamento, setModalConfirmaPagamento] = useState(null);
    const [pagamentoStatus, setPagamentoStatus] = useState('pago'); // 'pago' | 'pendente'
    const [pagamentosConfirmacao, setPagamentosConfirmacao] = useState([]);
    const [novoPagamentoConfirmacao, setNovoPagamentoConfirmacao] = useState(createEmptyPaymentItem());
    const [motivoPendente, setMotivoPendente] = useState("");

    // Estado para checklist de carregamento
    const [modalChecklist, setModalChecklist] = useState(false);
    const [itensChecklist, setItensChecklist] = useState([]);
    const [modoReorganizarParadas, setModoReorganizarParadas] = useState(false);
    const [dragEntregaId, setDragEntregaId] = useState(null);

    // Substituindo state local pelo UseChecklistCache
    const {
        itensConferidos,
        toggleItem: toggleItemConferido,
        clearCache: clearChecklistCache,
        setItensConferidos: _setItensConferidos
    } = useChecklistCache(caminhaoSelecionado, dataSelecionada);

    const queryClient = useQueryClient();
    const confirm = useConfirm();

    useEffect(() => {
        base44.auth.me().then(setUser).catch(console.error);

        // Tentar sincronizar fila offline
        const attemptSync = async () => {
            if (navigator.onLine) {
                try {
                    const { syncOfflineDeliveries } = await import('@/utils/deliveryOfflineQueue');
                    const didSync = await syncOfflineDeliveries();
                    if (didSync) {
                        toast.success("Sincronização de entregas offline concluída!");
                        queryClient.invalidateQueries({ queryKey: ['entregas-dia'] });
                        queryClient.invalidateQueries({ queryKey: ['entregas'] });
                    }
                } catch (e) {
                    console.error("Erro no background sync:", e);
                }
            }
        };

        attemptSync();
        window.addEventListener('online', attemptSync);

        return () => {
            if (gpsInterval.current) clearInterval(gpsInterval.current);
            window.removeEventListener('online', attemptSync);
        };
        // eslint-disable-next-line
    }, []);

    // Lista de caminhões
    const { data: caminhoes = [] } = useQuery({
        queryKey: ['caminhoes'],
        queryFn: () => base44.entities.Caminhao.list()
    });

    // Entregas do dia selecionado
    const { data: todasEntregas = [], refetch } = useQuery({
        queryKey: ['entregas-dia', dataSelecionada],
        queryFn: async () => {
            const todas = await base44.entities.Entrega.list('-ordem_rota');
            const entregasDia = todas.filter(e =>
                e.data_agendada?.startsWith(dataSelecionada) &&
                !isStatusCancelado(e.status)
            );

            const vendaIds = [...new Set(entregasDia.map(e => e.venda_id).filter(Boolean))];
            if (vendaIds.length === 0) return entregasDia;

            try {
                const { data: vendas, error } = await supabase
                    .from('vendas')
                    .select('id, status')
                    .in('id', vendaIds);

                if (error) throw error;

                const vendasCanceladas = new Set(
                    (vendas || [])
                        .filter(v => statusVendaCancelada(v.status))
                        .map(v => v.id)
                );

                return entregasDia.filter(e => !e.venda_id || !vendasCanceladas.has(e.venda_id));
            } catch (erroFiltro) {
                console.error('Erro ao filtrar vendas canceladas nas entregas do dia:', erroFiltro);
                return entregasDia;
            }
        },
        refetchInterval: rotaIniciada ? 10000 : 30000
    });

    // Vendas completas para exibir itens, observações e NF nos cards
    const { data: vendasCompletas = [] } = useQuery({
        queryKey: ['vendas-entregador', dataSelecionada],
        queryFn: async () => {
            const vendaIds = [...new Set(todasEntregas.map(e => e.venda_id).filter(Boolean))];
            if (vendaIds.length === 0) return [];
            const { data, error } = await supabase
                .from('vendas')
                .select('id, numero_pedido, itens, observacoes, forma_pagamento, valor_total, nfe_numero, nfe_status, nfe_chave, cliente_id')
                .in('id', vendaIds);
            if (error) return [];
            return data || [];
        },
        enabled: todasEntregas.length > 0,
        refetchInterval: rotaIniciada ? 30000 : 60000
    });

    // Clientes para telefone alternativo e contatos extras
    const { data: clientesEntregador = [] } = useQuery({
        queryKey: ['clientes-entregador', dataSelecionada],
        queryFn: async () => {
            const clienteIds = [...new Set(vendasCompletas.map(v => v.cliente_id).filter(Boolean))];
            if (clienteIds.length === 0) return [];
            const { data, error } = await supabase
                .from('clientes')
                .select('id, telefone, telefone_alternativo, contatos, email')
                .in('id', clienteIds);
            if (error) return [];
            return data || [];
        },
        enabled: vendasCompletas.length > 0,
        refetchInterval: 60000
    });

    const vendasMapEntregador = Object.fromEntries(vendasCompletas.map(v => [v.id, v]));
    const clientesMapEntregador = Object.fromEntries(clientesEntregador.map(c => [c.id, c]));

    // Assistências Técnicas pendentes
    const { data: todasAssistencias = [], refetch: refetchAssistencias } = useQuery({
        queryKey: ['assistencias-entregador'],
        queryFn: async () => {
            const todas = await base44.entities.AssistenciaTecnica.list('-created_at');
            return todas.filter(a =>
                a.status !== 'Concluída' &&
                !isStatusCancelado(a.status) &&
                (a.tipo === 'Devolução' || a.tipo === 'Troca' || a.tipo === 'Peça Faltante' || a.tipo === 'Visita Técnica' || a.tipo === 'Conserto')
            );
        },
        refetchInterval: rotaIniciada ? 10000 : 60000
    });

    // Montagens Internas por ITEM do pedido
    const { data: montagensItensInternas = [] } = useQuery({
        queryKey: ['montagens-itens-internas-pendentes'],
        queryFn: async () => {
            const todas = await base44.entities.MontagemItem.list('-created_at');
            return todas.filter(m => {
                const tipo = (m.tipo_montagem || '').toLowerCase();
                return tipo === 'interna';
            });
        },
        refetchInterval: rotaIniciada ? 10000 : 60000
    });

    // Agrupar entregas por turno
    const entregasPorTurno = {
        'Manhã': todasEntregas.filter(e => e.turno === 'Manhã'),
        'Tarde': todasEntregas.filter(e => e.turno === 'Tarde'),
        'Comercial': todasEntregas.filter(e => !e.turno || e.turno === 'Comercial')
    };

    // Estado para congelar a ordem da rota (Fix #5)
    const [ordemCongelada, setOrdemCongelada] = useState([]);

    useEffect(() => {
        if (rotaIniciada && todasEntregas.length > 0) {
            const rotaAtualIds = todasEntregas.filter(e => {
                const matchTurno = turnoSelecionado ? (e.turno === turnoSelecionado || (!e.turno && turnoSelecionado === 'Comercial')) : true;
                const matchCaminhao = caminhaoSelecionado ? (e.caminhao_id === caminhaoSelecionado || !e.caminhao_id) : true;
                return matchTurno && matchCaminhao;
            }).sort((a, b) => (a.ordem_rota || 99) - (b.ordem_rota || 99)).map(e => e.id);

            setOrdemCongelada(prev => {
                if (prev.length === 0) return rotaAtualIds;
                // Adiciona novas entregas que chegaram no BD depois
                const novos = rotaAtualIds.filter(id => !prev.includes(id));
                if (novos.length > 0) return [...prev, ...novos];
                return prev;
            });
        }
    }, [rotaIniciada, todasEntregas, turnoSelecionado, caminhaoSelecionado]);

    // Entregas da rota selecionada com ordem congelada
    const entregasRota = todasEntregas.filter(e => {
        const matchTurno = turnoSelecionado ? (e.turno === turnoSelecionado || (!e.turno && turnoSelecionado === 'Comercial')) : true;
        const matchCaminhao = caminhaoSelecionado ? (e.caminhao_id === caminhaoSelecionado || !e.caminhao_id) : true;
        return matchTurno && matchCaminhao;
    }).sort((a, b) => {
        if (ordemCongelada.length > 0) {
            const idxA = ordemCongelada.indexOf(a.id);
            const idxB = ordemCongelada.indexOf(b.id);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
        }
        return (a.ordem_rota || 99) - (b.ordem_rota || 99);
    });

    // Pedidos com pagamento na entrega pendente
    const pedidosAReceber = entregasRota.filter(e => e.status !== 'Entregue' && (e.pagamento_na_entrega || e.valor_a_receber > 0));

    const updateEntrega = useMutation({
        mutationFn: ({ id, data }) => base44.entities.Entrega.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['entregas-dia'] });
            queryClient.invalidateQueries({ queryKey: ['entregas'] });
        }
    });

    const updateCaminhao = useMutation({
        mutationFn: ({ id, data }) => base44.entities.Caminhao.update(id, data)
    });

    const updateAssistencia = useMutation({
        mutationFn: ({ id, data }) => base44.entities.AssistenciaTecnica.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['assistencias-entregador'] });
            queryClient.invalidateQueries({ queryKey: ['assistencias'] });
        }
    });

    const moverParada = (lista, from, to) => {
        const copia = [...lista];
        const [item] = copia.splice(from, 1);
        copia.splice(to, 0, item);
        return copia;
    };

    const salvarOrdemParadas = async (ordemIds) => {
        const updates = ordemIds.map((id, idx) => updateEntrega.mutateAsync({
            id,
            data: { ordem_rota: idx + 1 }
        }));
        await Promise.all(updates);
    };

    const iniciarDragParada = (event, entregaId) => {
        const handle = event.target?.closest?.('[data-drag-handle="true"]');
        if (!handle) {
            event.preventDefault();
            return;
        }

        event.dataTransfer.effectAllowed = 'move';
        setDragEntregaId(entregaId);
    };

    const permitirDropParada = (event) => {
        if (!dragEntregaId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    };

    const finalizarDropParada = async (event, targetEntregaId) => {
        if (!dragEntregaId) return;
        event.preventDefault();

        const ordemAtual = entregasRota.map(e => e.id);
        const fromIndex = ordemAtual.indexOf(dragEntregaId);
        const toIndex = ordemAtual.indexOf(targetEntregaId);

        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
            setDragEntregaId(null);
            return;
        }

        const novaOrdem = moverParada(ordemAtual, fromIndex, toIndex);
        setOrdemCongelada(novaOrdem);
        setDragEntregaId(null);

        try {
            await salvarOrdemParadas(novaOrdem);
            toast.success('Paradas reorganizadas');
        } catch (error) {
            console.error('Erro ao reorganizar paradas:', error);
            toast.error('Nao foi possivel salvar a nova ordem das paradas');
            queryClient.invalidateQueries({ queryKey: ['entregas-dia'] });
            queryClient.invalidateQueries({ queryKey: ['entregas'] });
        }
    };

    const abrirModalConfirmacaoPagamento = (entrega, contexto = 'manual') => {
        const valorInicial = toMoneyNumber(entrega?.valor_a_receber);
        const formaPadrao = String(entrega?.forma_pagamento_entrega || entrega?.forma_pagamento || '').trim();
        setModalConfirmaPagamento({ ...entrega, contexto });
        setPagamentoStatus('pago');
        setPagamentosConfirmacao([]);
        setNovoPagamentoConfirmacao(createEmptyPaymentItem({
            forma_pagamento: formaPadrao,
            valor: valorInicial > 0 ? valorInicial.toFixed(2) : '',
        }));
        setMotivoPendente("");
    };

    const fecharModalConfirmacaoPagamento = () => {
        setModalConfirmaPagamento(null);
        setPagamentoStatus('pago');
        setPagamentosConfirmacao([]);
        setNovoPagamentoConfirmacao(createEmptyPaymentItem());
        setMotivoPendente("");
    };

    const totalPagamentoConfirmacao = pagamentosConfirmacao.reduce((sum, pagamento) => sum + toMoneyNumber(pagamento.valor), 0);
    const saldoPagamentoConfirmacao = Math.max(toMoneyNumber(modalConfirmaPagamento?.valor_a_receber) - totalPagamentoConfirmacao, 0);

    const adicionarPagamentoConfirmacao = () => {
        const totalAlvo = Math.max(toMoneyNumber(modalConfirmaPagamento?.valor_a_receber), 0);
        const validation = validatePaymentSplit({
            total: totalAlvo,
            payments: [
                ...pagamentosConfirmacao,
                {
                    ...novoPagamentoConfirmacao,
                    valor: toMoneyNumber(novoPagamentoConfirmacao.valor),
                    parcelas: Number(novoPagamentoConfirmacao.parcelas || 1),
                },
            ],
        });

        if (!validation.ok) {
            toast.error(validation.errors[0] || 'Não foi possível adicionar essa forma de pagamento.');
            return;
        }

        setPagamentosConfirmacao(validation.pagamentos);
        const saldoRestanteAtualizado = Math.max(totalAlvo - validation.totalPago, 0);
        setNovoPagamentoConfirmacao(createEmptyPaymentItem({
            forma_pagamento: novoPagamentoConfirmacao.forma_pagamento || String(modalConfirmaPagamento?.forma_pagamento_entrega || modalConfirmaPagamento?.forma_pagamento || ''),
            valor: saldoRestanteAtualizado > 0 ? saldoRestanteAtualizado.toFixed(2) : '',
        }));
    };

    const removerPagamentoConfirmacao = (index) => {
        setPagamentosConfirmacao((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    };

    const confirmarPagamentoNoModal = async () => {
        if (!modalConfirmaPagamento) return;

        if (pagamentoStatus === 'pago' && !pagamentosConfirmacao.length) {
            toast.error('Adicione pelo menos uma forma de pagamento.');
            return;
        }

        if (pagamentoStatus === 'pendente' && !motivoPendente.trim()) {
            toast.error('Informe o motivo da pendência.');
            return;
        }

        const contexto = modalConfirmaPagamento.contexto || 'manual';
        const entrega = { ...modalConfirmaPagamento };
        const formaPagamentoResumo = pagamentosConfirmacao.length === 1
            ? pagamentosConfirmacao[0].forma_pagamento
            : 'Múltiplos';
        const pagamentoPayload = {
            pagamentoStatus,
            pagamentos: pagamentosConfirmacao,
            valorRecebido: totalPagamentoConfirmacao,
            formaPagamento: formaPagamentoResumo,
            motivoPendente: motivoPendente.trim(),
        };

        if (pagamentoStatus === 'pago') {
            setModalComprovante({
                ...entrega,
                contexto,
                pagamentoPayload,
            });
            fecharModalConfirmacaoPagamento();
            return;
        }

        try {
            if (contexto === 'finalizacao') {
                await finalizarEntrega(entrega, entrega.assinatura_url, null, pagamentoPayload);
            } else {
                setEnviando(true);
                await applyDeliveryPayment({
                    entrega,
                    ...pagamentoPayload,
                });
                toast.success('Pendência registrada');
                queryClient.invalidateQueries({ queryKey: ['entregas-dia'] });
                queryClient.invalidateQueries({ queryKey: ['entregas'] });
                queryClient.invalidateQueries({ queryKey: ['vendas'] });
                queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
            }
            fecharModalConfirmacaoPagamento();
        } catch (e) {
            console.error('Erro ao registrar pagamento:', e);
            toast.error(e.message || 'Erro ao registrar pagamento');
        } finally {
            setEnviando(false);
        }
    };

    // Persistência da sessão de rota ativa no localStorage
    useEffect(() => {
        if (etapa === 'rota' && rotaIniciada && caminhaoSelecionado && turnoSelecionado) {
            localStorage.setItem(ENTREGADOR_SESSION_KEY, JSON.stringify({
                etapa,
                rotaIniciada,
                caminhaoSelecionado,
                turnoSelecionado,
                dataSelecionada,
                updatedAt: Date.now()
            }));
        }
    }, [etapa, rotaIniciada, caminhaoSelecionado, turnoSelecionado, dataSelecionada]);

    // RECUPERAR ESTADO AO INICIAR (Fonte de Verdade: Banco de Dados)
    useEffect(() => {
        if (!user) return;
        const restaurarSessaoAPartirDoBanco = async () => {
            try {
                // Consultamos o banco para ver se há um caminhão 'Em Trânsito' atrelado a este motorista.
                const { data: caminhaoAtivo } = await supabase
                    .from('caminhoes')
                    .select('id, turno_atual, motorista_atual_nome')
                    .eq('status_rota', 'Em Trânsito')
                    .eq('motorista_atual_nome', user?.full_name)
                    .single();

                if (caminhaoAtivo) {
                    // Banco confirma rota ativa: restaurar e preferir data salva localmente
                    const sessaoSalva = lerSessaoSalva();
                    setCaminhaoSelecionado(caminhaoAtivo.id);
                    setTurnoSelecionado(caminhaoAtivo.turno_atual || 'Comercial');
                    if (sessaoSalva?.dataSelecionada) {
                        setDataSelecionada(sessaoSalva.dataSelecionada);
                    }
                    setRotaIniciada(true);
                    setEtapa('rota');
                    toast.success("Rota recuperada!");
                }
                // Se data=null (PGRST116 - sem rota no banco), não limpa sessão local.
                // Pode ser GPS ainda não atualizado ou motorista_atual_nome com divergência.
                // O localStorage (com TTL de 12h) é a fonte primária de navegação;
                // apenas finalizarRota() e o TTL fazem limpeza explícita.
            } catch (error) {
                // Erro real de rede/DB: mantém estado local para não perder sessão
                console.log("Erro ao verificar rota ativa:", error?.message);
            } finally {
                setSessaoVerificada(true);
            }
        };

        restaurarSessaoAPartirDoBanco();
    }, [user?.full_name]);

    // GARANTIR RASTREAMENTO CONDICIONAL SEGURO (React Lifecycle) E RECUPERACAO DE ESBOSSO
    useEffect(() => {
        if (rotaIniciada && caminhaoSelecionado) {
            iniciarRastreamento();

            // Tentar recuperar um rascunho de assinatura inacabado
            try {
                const draft = sessionStorage.getItem('rascunho_entrega');
                if (draft) {
                    const parsed = JSON.parse(draft);
                    if (parsed && parsed.id) {
                        setModalFotoEntrega(parsed);
                        toast.info("Rascunho da sua última assinatura foi recuperado.");
                    }
                }
            } catch (e) { void e; }
        }
        return () => {
            if (gpsInterval.current) {
                clearInterval(gpsInterval.current);
                gpsInterval.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rotaIniciada, caminhaoSelecionado]);

    const iniciarRastreamento = () => {
        if (!navigator.geolocation) {
            toast.error("GPS não suportado neste dispositivo.");
            return;
        }
        atualizarPosicao();
        gpsInterval.current = setInterval(atualizarPosicao, 5000);
    };

    const atualizarPosicao = () => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                if (caminhaoSelecionado) {
                    updateCaminhao.mutate({
                        id: caminhaoSelecionado,
                        data: {
                            latitude,
                            longitude,
                            ultima_atualizacao: new Date().toISOString(),
                            status_rota: 'Em Trânsito',
                            motorista_atual_nome: user?.full_name || 'Entregador',
                            turno_atual: turnoSelecionado
                        }
                    });
                }
            },
            (error) => console.error("Erro GPS:", error),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    };

    const pararRastreamento = () => {
        if (gpsInterval.current) {
            clearInterval(gpsInterval.current);
            gpsInterval.current = null;
        }
        if (caminhaoSelecionado) {
            updateCaminhao.mutate({
                id: caminhaoSelecionado,
                data: { status_rota: 'Parado', motorista_atual_nome: null, turno_atual: null }
            });
        }
    };

    const rotaPossuiAndamento = (entregas = []) => {
        const statusAndamento = ['Entregue', 'Próxima parada', 'A caminho', 'Em rota'];
        return entregas.some((entrega) =>
            statusAndamento.includes(entrega?.status)
        );
    };

    // Preparar checklist de carregamento
    const prepararChecklist = async () => {
        if (!caminhaoSelecionado || !turnoSelecionado) {
            toast.error("Selecione caminhão e turno primeiro.");
            return;
        }
        if (entregasRota.length === 0) {
            toast.error("Nenhuma entrega para carregar.");
            return;
        }

        if (rotaPossuiAndamento(entregasRota)) {
            const retomarSemChecklist = await confirm({
                title: 'Retomar rota',
                message: 'Esta rota já possui andamento. Deseja retomar sem checklist?',
                confirmText: 'Retomar'
            });

            if (!retomarSemChecklist) return;

            setRotaIniciada(true);
            setEtapa('rota');
            await refetch();
            if (!gpsInterval.current) {
                iniciarRastreamento();
            }
            toast.success('Rota retomada!');
            return;
        }

        setEnviando(true);
        try {
            // Buscar itens de todas as vendas de uma vez
            const vendaIds = entregasRota.map(e => e.venda_id).filter(Boolean);

            let vendasMap = {};
            if (vendaIds.length > 0) {
                const { data: vendas, error } = await supabase
                    .from('vendas')
                    .select('id, itens, numero_pedido')
                    .in('id', vendaIds);

                if (error) throw error;

                vendas.forEach(v => {
                    vendasMap[v.id] = v;
                });
            }

            const itens = [];
            for (const entrega of entregasRota) {
                if (entrega.venda_id && vendasMap[entrega.venda_id]) {
                    const venda = vendasMap[entrega.venda_id];
                    if (venda?.itens) {
                        const vendaItens = typeof venda.itens === 'string' ? JSON.parse(venda.itens) : venda.itens;
                        vendaItens.forEach(item => {
                            const bloqueadoMontagem = itemTemMontagemPendente(entrega, item);
                            itens.push({
                                id: `${entrega.id}-${item.produto_id || item.id}`,
                                pedido: venda.numero_pedido || entrega.numero_pedido,
                                entrega_id: entrega.id,
                                cliente: entrega.cliente_nome,
                                produto_id: item.produto_id || item.id,
                                produto: item.nome || item.produto_nome,
                                quantidade: item.quantidade || 1,
                                cor: item.cor,
                                codigo: item.codigo_barras || item.sku,
                                detalhes: item.detalhes || item.descricao || item.observacao,
                                bloqueado_montagem: bloqueadoMontagem
                            });
                        });
                    }
                }
            }

            console.log('Itens parsed:', itens.length);

            if (itens.length === 0) {
                console.log('Nenhum item, chamando iniciarRota...');
                await iniciarRota();
                return;
            }

            setItensChecklist(itens);
            // setItensConferidos(new Set()); Removido para respeitar o cache que foi montado pelo hook
            setModalChecklist(true);
        } catch (error) {
            console.error('Erro ao preparar checklist:', error);
            toast.error("Erro ao carregar itens da carga.");
        } finally {
            setEnviando(false);
        }
    };

    const iniciarRota = async () => {
        console.log('iniciarRota chamado');
        if (!caminhaoSelecionado || !turnoSelecionado) {
            toast.error("Selecione caminhão e turno primeiro.");
            return;
        }

        const entregasComMontagemPendente = entregasRota.filter(temMontagemPendente);
        if (entregasComMontagemPendente.length > 0) {
            const pedidos = entregasComMontagemPendente
                .slice(0, 3)
                .map(e => `#${e.numero_pedido}`)
                .join(', ');
            const sufixo = entregasComMontagemPendente.length > 3 ? ', ...' : '';

            toast.error(
                `Rota bloqueada: há ${entregasComMontagemPendente.length} pedido(s) com montagem pendente (${pedidos}${sufixo}).`
            );
            return;
        }

        // Verificar se tem pedidos a receber
        // Verificar se tem pedidos a receber
        if (pedidosAReceber.length > 0) {
            console.log('Pedidos a receber:', pedidosAReceber.length);
            const formas = [...new Set(pedidosAReceber.map(p => p.forma_pagamento_entrega || p.forma_pagamento).filter(Boolean))];
            const totalReceber = pedidosAReceber.reduce((sum, p) => sum + (p.valor_a_receber || 0), 0);

            let avisoExtra = "";
            if (formas.some(f => f.toLowerCase().includes('dinheiro'))) avisoExtra += "💵 Leve troco!\n";
            if (formas.some(f => f.toLowerCase().includes('cartão') || f.toLowerCase().includes('debito') || f.toLowerCase().includes('crédito'))) avisoExtra += "💳 Leve a máquina!\n";

            const continuar = await confirm({
                title: "⚠️ ATENÇÃO: Pedidos a Receber!",
                message: `Você tem ${pedidosAReceber.length} pedido(s) para receber na entrega!\n\n💰 Total: R$ ${totalReceber.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n📝 Formas: ${formas.length > 0 ? formas.join(', ') : 'Não especificado'}\n\n${avisoExtra}`,
                confirmText: "Entendi, Continuar",
                variant: "default"
            });

            if (!continuar) return;
        }

        console.log('Pedindo confirmação de rota...');
        const confirmed = await confirm({
            title: "Iniciar Rota",
            message: `Iniciar rota ${turnoSelecionado} com ${entregasRota.length} entregas?`,
            confirmText: "Iniciar"
        });
        console.log('Confirmação:', confirmed);
        if (!confirmed) return;

        setEnviando(true);
        try {
            // 🔧 SAFEGUARD: Atualizar motorista_atual_nome no caminhão
            if (user?.full_name) {
                console.log(`🚗 Registrando motorista "${user.full_name}" no caminhão...`);
                let motoristaSincronizado = false;
                let tentativas = 0;
                const MAX_TENTATIVAS = 3;

                while (tentativas < MAX_TENTATIVAS && !motoristaSincronizado) {
                    try {
                        await updateCaminhao.mutateAsync({
                            id: caminhaoSelecionado,
                            data: {
                                motorista_atual_nome: user.full_name,
                                turno_atual: turnoSelecionado,
                                status_rota: 'Em Trânsito'
                            }
                        });
                        console.log(`✅ Motorista registrado com sucesso em "${turnoSelecionado}"`);
                        motoristaSincronizado = true;
                    } catch (erro) {
                        tentativas++;
                        console.warn(`⚠️  Erro ao registrar motorista (tentativa ${tentativas}/${MAX_TENTATIVAS}):`, erro);
                        if (tentativas < MAX_TENTATIVAS) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }
                }

                if (!motoristaSincronizado) {
                    console.error('❌ Falha ao registrar motorista após 3 tentativas.');
                    toast.warning('Aviso: Não conseguimos registrar o motorista no sistema. Contate um administrador se o problema persistir.');
                }
            }

            for (const entrega of entregasRota) {
                if (!entrega.caminhao_id) {
                    await base44.entities.Entrega.update(entrega.id, { caminhao_id: caminhaoSelecionado });
                }
            }

            const rotaJaPossuiAndamento = rotaPossuiAndamento(entregasRota);
            const primeiraPendente = entregasRota.find((e) => e.status !== 'Entregue');

            // Notificar apenas em rota nova e somente o primeiro pedido pendente se módulo WhatsApp ativo.
            if (primeiraPendente && !rotaJaPossuiAndamento) {
                if (isPaidModuleActive('whatsapp')) {
                    await whatsappService.notifyRouteStart([primeiraPendente]);
                    await whatsappService.sendDeliveryNextStop(
                        primeiraPendente.cliente_telefone,
                        primeiraPendente
                    );
                } else {
                    console.log("Notificação de início de rota pulada: módulo 'whatsapp' inativo.");
                }
            }

            setRotaIniciada(true);
            setEtapa('rota');
            
            // Refetch para garantir que o useEffect de avisarProximo() tenha dados frescos
            // Especialmente crítico com 1 pedido (issue de timing)
            await refetch();
            
            iniciarRastreamento();

            // Item 3: Cache do checklist deletado/limpo apenas quando iniciarReta for sucesso (200 OK do DB implícito pelos updates acima)
            clearChecklistCache();

            toast.success("Rota iniciada! GPS ativo.");
        } catch (e) {
            toast.error("Erro ao iniciar rota.");
        } finally {
            setEnviando(false);
        }
    };

    const finalizarRota = async () => {
        const confirmed = await confirm({
            title: "Finalizar Rota",
            message: "Tem certeza que deseja finalizar a rota?",
            confirmText: "Finalizar",
            variant: "destructive"
        });
        if (!confirmed) return;

        pararRastreamento();
        
        // 🔧 SAFEGUARD: Limpar motorista_atual_nome do caminhão com retry
        if (caminhaoSelecionado) {
            let tentativas = 0;
            const MAX_TENTATIVAS = 3;
            let sucesso = false;

            while (tentativas < MAX_TENTATIVAS && !sucesso) {
                try {
                    console.log(`🧹 Tentativa ${tentativas + 1}: Limpando motorista_atual_nome do caminhão...`);
                    await updateCaminhao.mutateAsync({
                        id: caminhaoSelecionado,
                        data: {
                            motorista_atual_nome: null,
                            turno_atual: null,
                            status_rota: 'Parado'
                        }
                    });
                    console.log('✅ Caminhão atualizado com sucesso (motorista_atual_nome limpado)');
                    sucesso = true;
                } catch (erro) {
                    tentativas++;
                    console.warn(`⚠️  Erro ao atualizar caminhão (tentativa ${tentativas}/${MAX_TENTATIVAS}):`, erro);
                    
                    // Aguardar 500ms antes de tentar novamente
                    if (tentativas < MAX_TENTATIVAS) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }

            if (!sucesso) {
                console.error('❌ Falha ao limpar motorista_atual_nome após 3 tentativas. Dados podem ficar inconsistentes.');
                toast.warning('Aviso: Não conseguimos limpar os dados do caminhão. A inconsistência pode ocorrer sem ação manual.');
                // Mesmo com erro, continuamos finalizando a rota localmente
                // Mas o usuário é alertado para contatar um admin se necessário
            }

            // Invalidar cache de caminhões para forçar refetch na próxima visualização
            queryClient.invalidateQueries({ queryKey: ['caminhoes-rastreamento'] });
            queryClient.invalidateQueries({ queryKey: ['caminhoes'] });
        }

        localStorage.removeItem(ENTREGADOR_SESSION_KEY);
        setRotaIniciada(false);
        setEtapa('selecao');
        setCaminhaoSelecionado(null);
        setTurnoSelecionado(null);
        toast.success("Rota finalizada!");
    };

    const primeiraPendenteId = entregasRota.find(e => e.status !== 'Entregue')?.id;

    const normalizarNumeroPedido = (valor) => (valor || '').toString().replace(/\D/g, '');

    const contarItensMontagemInterna = (entrega) => {
        const itens = entrega?.itens_montagem_interna;
        if (Array.isArray(itens)) return itens.length;

        if (typeof itens === 'string') {
            try {
                const parsed = JSON.parse(itens);
                return Array.isArray(parsed) ? parsed.length : 0;
            } catch (e) {
                void e;
                return 0;
            }
        }

        return 0;
    };

    const statusMontagemConcluida = (status) => {
        const statusNorm = (status || '')
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
        return statusNorm === 'concluida';
    };

    const normalizarTextoComparacao = (valor) => (valor || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    const getMontagensInternasRelacionadas = (entrega) => {
        const entregaId = entrega?.id?.toString();
        const vendaId = entrega?.venda_id?.toString();
        const numeroPedidoNorm = normalizarNumeroPedido(entrega?.numero_pedido);

        return montagensItensInternas.filter((montagem) => {
            const itemEntregaId = montagem?.entrega_id?.toString();
            const itemVendaId = montagem?.venda_id?.toString();
            const itemNumeroPedidoNorm = normalizarNumeroPedido(montagem?.numero_pedido);

            if (entregaId && itemEntregaId && itemEntregaId === entregaId) return true;
            if (vendaId && itemVendaId && itemVendaId === vendaId) return true;
            if (numeroPedidoNorm && itemNumeroPedidoNorm && itemNumeroPedidoNorm === numeroPedidoNorm) return true;
            return false;
        });
    };

    // Verifica bloqueio por item: se qualquer item de montagem interna estiver pendente
    const temMontagemPendente = (entrega) => {
        const montagensRelacionadas = getMontagensInternasRelacionadas(entrega);

        if (montagensRelacionadas.length > 0) {
            return montagensRelacionadas.some((montagem) => !statusMontagemConcluida(montagem?.status));
        }

        // Fallback: se a entrega tem itens de montagem interna e status ainda não está concluído,
        // mantém o bloqueio apenas quando ainda não existem registros de montagem para confrontar.
        const totalItensInternos = contarItensMontagemInterna(entrega);
        const pendentePorStatusDaEntrega = totalItensInternos > 0 && !statusMontagemConcluida(entrega?.montagem_status);

        return pendentePorStatusDaEntrega;
    };

    const itemTemMontagemPendente = (entrega, itemVenda) => {
        const montagensPendentes = getMontagensInternasRelacionadas(entrega)
            .filter((montagem) => !statusMontagemConcluida(montagem?.status));

        if (montagensPendentes.length === 0) return false;

        const itemProdutoId = itemVenda?.produto_id?.toString();
        const itemNome = normalizarTextoComparacao(itemVenda?.nome || itemVenda?.produto_nome);

        return montagensPendentes.some((montagem) => {
            const montagemProdutoId = montagem?.produto_id?.toString();
            const montagemNome = normalizarTextoComparacao(montagem?.produto_nome);

            if (itemProdutoId && montagemProdutoId) {
                return itemProdutoId === montagemProdutoId;
            }

            if (itemNome && montagemNome) {
                return itemNome === montagemNome;
            }

            return false;
        });
    };

    // Iniciar processo de finalizar entrega (abre assinatura)
    const iniciarFinalizacao = (entrega) => {
        if (temMontagemPendente(entrega)) {
            toast.error('Montagem Pendente: Conclua a montagem interna antes de entregar.');
            return;
        }
        setModalAssinatura(entrega);
    };

    // Salvar assinatura e pedir foto dos móveis (NOVO FLUXO)
    const salvarAssinatura = async (assinaturaDataUrl) => {
        const entrega = modalAssinatura;
        setModalAssinatura(null);

        const rascunho = { ...entrega, assinatura_url: assinaturaDataUrl };
        // NOVO: Salvar rascunho na sessionStorage para não perder se fechar o app/recarregar
        sessionStorage.setItem('rascunho_entrega', JSON.stringify(rascunho));

        if (isPaidModuleActive('fotos_entrega')) {
            // NOVO: Sempre pedir foto dos móveis após assinatura
            setModalFotoEntrega(rascunho);
        } else {
            toast.info("Fotos de confirmação de entrega desativadas no plano atual. Pulando etapa de fotos...");
            // Se tem pagamento pendente na entrega, pedir comprovante de pagamento
            if (needsDeliveryPaymentConfirmation(entrega)) {
                abrirModalConfirmacaoPagamento(rascunho, 'finalizacao');
            } else {
                // Finalizar diretamente
                await finalizarEntrega(rascunho, rascunho.assinatura_url, null, null);
            }
        }
    };

    // NOVO: Salvar fotos dos móveis e verificar se precisa de comprovante de pagamento
    const salvarFotosEntrega = async (fotosData) => {
        const entrega = modalFotoEntrega;
        setModalFotoEntrega(null);

        const entregaComFotos = {
            ...entrega,
            fotos_entrega: fotosData.fotos,
            geolocalizacao_entrega: fotosData.geolocalizacao,
            data_hora_entrega: fotosData.dataHoraEntrega
        };

        // Se tem pagamento, pedir comprovante
        if (needsDeliveryPaymentConfirmation(entrega)) {
            abrirModalConfirmacaoPagamento(entregaComFotos, 'finalizacao');
        } else {
            // Finalizar diretamente
            await finalizarEntrega(entregaComFotos, entrega.assinatura_url, null, null);
        }
    };

    // Salvar comprovante e finalizar
    const salvarComprovante = async (comprovanteDataUrl) => {
        const entrega = modalComprovante;
        setModalComprovante(null);

        if (!entrega) return;

        if (entrega.contexto === 'finalizacao') {
            await finalizarEntrega(entrega, entrega.assinatura_url, comprovanteDataUrl, entrega.pagamentoPayload || null);
            return;
        }

        setEnviando(true);
        try {
            await applyDeliveryPayment({
                entrega,
                ...(entrega.pagamentoPayload || {}),
                comprovanteUrl: comprovanteDataUrl,
            });
            toast.success('Pagamento confirmado!');
            queryClient.invalidateQueries({ queryKey: ['entregas-dia'] });
            queryClient.invalidateQueries({ queryKey: ['entregas'] });
            queryClient.invalidateQueries({ queryKey: ['vendas'] });
            queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
        } catch (error) {
            console.error('Erro ao registrar pagamento com comprovante:', error);
            toast.error(error.message || 'Erro ao registrar pagamento');
        } finally {
            setEnviando(false);
        }
    };

    // Finalizar entrega com assinatura, fotos e comprovante
    const finalizarEntrega = async (entrega, assinaturaUrl, comprovanteUrl, pagamentoPayload = null) => {
        setEnviando(true);
        try {
            if (entrega?.venda_id) {
                const { data: vendaAtual, error: vendaError } = await supabase
                    .from('vendas')
                    .select('id, status')
                    .eq('id', entrega.venda_id)
                    .single();

                if (vendaError) throw vendaError;

                if (statusVendaCancelada(vendaAtual?.status)) {
                    toast.error('Entrega bloqueada: esta venda foi cancelada.');
                    return;
                }
            }

            const updateData = {
                status: 'Entregue',
                data_realizada: new Date().toISOString(),
                assinatura_url: assinaturaUrl,
            };

            // NOVO: Adicionar fotos da entrega
            if (entrega.fotos_entrega) {
                // Se offline, isso terá as base64. O componente de envio lerá os base64 e enviará pra storage.
                // Mas para o updateData final, não teremos as urls prontas ainda. 
                // A queue sincronizer cuidará disso.
                updateData.fotos_entrega = entrega.fotos_entrega;
                updateData.foto_entrega_url = entrega.fotos_entrega[0]?.url || null;
            }

            // NOVO: Adicionar geolocalização
            if (entrega.geolocalizacao_entrega) {
                updateData.geolocalizacao_entrega = entrega.geolocalizacao_entrega;
            }

            // NOVO: Adicionar data/hora exata
            if (entrega.data_hora_entrega) {
                updateData.data_hora_entrega = entrega.data_hora_entrega;
            }

            if (comprovanteUrl) {
                updateData.comprovante_pagamento_url = comprovanteUrl;
            }

            // SE DETECTADO OFFLINE OU COM FALTAS DE UPLOAD, SALVA NA FILA OFFLINE
            if (entrega.isOffline || !navigator.onLine) {
                const { saveDeliveryToOfflineQueue } = await import('@/utils/deliveryOfflineQueue');
                await saveDeliveryToOfflineQueue(entrega.id, {
                    updateData,
                    fotosOfflineList: entrega.isOffline ? entrega.fotos_entrega : [],
                    financialPayload: pagamentoPayload ? {
                        entrega: {
                            id: entrega.id,
                            venda_id: entrega.venda_id,
                            valor_a_receber: entrega.valor_a_receber,
                            forma_pagamento_entrega: entrega.forma_pagamento_entrega,
                            forma_pagamento: entrega.forma_pagamento,
                            numero_pedido: entrega.numero_pedido,
                        },
                        ...pagamentoPayload,
                        comprovanteUrl,
                    } : null,
                });

                toast.success("Entrega salva offline! Será sincronizada quando houver internet.");
                sessionStorage.removeItem('rascunho_entrega');

                // Atualizar estado cacheado do React Query para UI responder imediato sem refetch
                queryClient.setQueryData(['entregas-dia', dataSelecionada], (oldData) => {
                    if (!oldData) return oldData;
                    return oldData.map(e => e.id === entrega.id ? { ...e, status: 'Entregue' } : e);
                });
            } else {
                // 🚀 AUTOMAÇÃO: Chamar o robô de WhatsApp para concluir e avisar o próximo se módulo ativo
                if (isPaidModuleActive('whatsapp')) {
                    try {
                        const completionResult = await whatsappService.notifyDeliveryCompletion(entrega.id, updateData);
                        if (completionResult?.status === 'failed') {
                            throw new Error("A API retornou erro HTTP (500/400)");
                        }

                        // Se foi para fila offline do bot, persistimos no banco aqui para manter consistência imediata.
                        if (completionResult?.status === 'queued') {
                            await updateEntrega.mutateAsync({ id: entrega.id, data: updateData });
                        }
                    } catch (zapErr) {
                        console.error("Falha ao chamar automação do robô, tentando fallback direto no banco...");
                        await updateEntrega.mutateAsync({ id: entrega.id, data: updateData });
                    }
                } else {
                    // Sem WhatsApp, apenas salva no banco diretamente
                    await updateEntrega.mutateAsync({ id: entrega.id, data: updateData });
                }

                if (pagamentoPayload) {
                    await applyDeliveryPayment({
                        entrega,
                        ...pagamentoPayload,
                        comprovanteUrl,
                    });
                }

                // Atualizar cache imediatamente para que o useEffect detecte a próxima entrega
                // assim que setEnviando(false) rodar no finally, mesmo se o robô estiver offline
                queryClient.setQueryData(['entregas-dia', dataSelecionada], (oldData) => {
                    if (!oldData) return oldData;
                    return oldData.map(e => e.id === entrega.id ? { ...e, status: 'Entregue' } : e);
                });

                toast.success("Entrega finalizada!");
                sessionStorage.removeItem('rascunho_entrega');
                queryClient.invalidateQueries({ queryKey: ['vendas'] });
                queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
                await refetch();
            }
        } catch (error) {
            toast.error("Erro ao finalizar entrega.");
            console.error(error);
        } finally {
            setEnviando(false);
        }
    };

    // Iniciar processo de falha na entrega
    const iniciarFalhaEntrega = (entrega) => {
        setModalFalha(entrega);
        setFotoFalha(null);
        setObservacaoFalha("");
        setEtapaFalha('foto');
    };

    // Salvar foto da falha
    const salvarFotoFalha = (fotoDataUrl) => {
        setFotoFalha(fotoDataUrl);
        setEtapaFalha('observacao');
    };

    // Confirmar falha na entrega
    const confirmarFalhaEntrega = async () => {
        if (!fotoFalha) {
            toast.error("Foto obrigatória!");
            return;
        }
        if (!observacaoFalha.trim()) {
            toast.error("Observação obrigatória!");
            return;
        }

        setEnviando(true);
        try {
            const entrega = modalFalha;
            const tentativas = (entrega.tentativas || 0) + 1;

            // 1. Atualizar no banco
            await updateEntrega.mutateAsync({
                id: entrega.id,
                data: {
                    status: 'Pendente',
                    data_agendada: null,
                    turno: null,
                    caminhao_id: null,
                    tentativas,
                    observacoes_entrega: `[TENTATIVA ${tentativas}] ${observacaoFalha}`,
                    foto_tentativa_url: fotoFalha
                }
            });

            // 2. Notificar cliente via bot/service se módulo WhatsApp ativo
            if (entrega.cliente_telefone && isPaidModuleActive('whatsapp')) {
                await whatsappService.sendDeliveryFailure(
                    entrega.cliente_telefone,
                    entrega.cliente_nome,
                    observacaoFalha
                );
            }

            setModalFalha(null);
            toast.success("Entrega retornada para triagem. Cliente notificado.");
            refetch();
        } catch (error) {
            toast.error("Erro ao registrar falha.");
            console.error(error);
        } finally {
            setEnviando(false);
        }
    };

    // Concluir assistência técnica
    const concluirAssistencia = async () => {
        if (!modalConcluirAssistencia) return;

        setEnviando(true);
        try {
            const assistencia = modalConcluirAssistencia;
            const hoje = new Date().toISOString().split('T')[0];

            await updateAssistencia.mutateAsync({
                id: assistencia.id,
                data: {
                    status: 'Concluída',
                    data_resolucao: hoje,
                    solucao_aplicada: observacaoAssistencia || 'Atendimento realizado pelo entregador',
                    historico: [
                        ...(assistencia.historico || []),
                        {
                            status_anterior: assistencia.status,
                            status_novo: 'Concluída',
                            data: new Date().toISOString(),
                            usuario: user?.full_name || 'Entregador'
                        }
                    ]
                }
            });

            setModalConcluirAssistencia(null);
            setObservacaoAssistencia("");
            toast.success("Assistência concluída com sucesso!");
            refetchAssistencias();
        } catch (error) {
            toast.error("Erro ao concluir assistência.");
            console.error(error);
        } finally {
            setEnviando(false);
        }
    };

    const formatarData = (dataStr) => {
        const data = new Date(dataStr + 'T12:00:00');
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const amanha = new Date(hoje);
        amanha.setDate(amanha.getDate() + 1);
        const dataNorm = new Date(data);
        dataNorm.setHours(0, 0, 0, 0);

        if (dataNorm.getTime() === hoje.getTime()) return 'Hoje';
        if (dataNorm.getTime() === amanha.getTime()) return 'Amanhã';
        return data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    };

    const itensBloqueadosChecklist = itensChecklist.filter(item => item.bloqueado_montagem).length;
    const itensSelecionaveisChecklist = itensChecklist.filter(item => !item.bloqueado_montagem);
    const conferidosSelecionaveisChecklist = itensSelecionaveisChecklist.filter(item => itensConferidos.has(item.id)).length;
    const podeIniciarChecklist = itensBloqueadosChecklist === 0 && conferidosSelecionaveisChecklist === itensSelecionaveisChecklist.length;


    // Verificar se é admin ou tem cargo de entregador
    const isAdmin = user?.cargo === 'Administrador';
    const isEntregador = user?.cargo === 'Entregador';
    const isPendente = user?.status_aprovacao === 'Pendente' && user?.cargo === 'Entregador';

    // ===== TELA DE SELEÇÃO DE ROTA =====
    if (etapa === 'selecao') {
        return (
            <div className="max-w-lg mx-auto p-4 space-y-6 min-h-screen bg-gray-50">
                {/* Header com Branding */}
                <div className="bg-gradient-to-r from-green-600 to-green-700 rounded-xl shadow-lg p-5 text-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {brandLogo ? (
                                <img
                                    src={brandLogo}
                                    alt={brandName}
                                    className="h-[52px] w-auto rounded-xl object-contain"
                                />
                            ) : (
                                <div className="w-[52px] h-[52px] bg-white rounded-xl flex items-center justify-center">
                                    <Truck className="w-8 h-8 text-green-600" />
                                </div>
                            )}
                            <div>
                                <h1 className="text-xl font-bold">Olá, {user?.full_name?.split(' ')[0] || 'Entregador'}!</h1>
                                <p className="text-sm text-green-100">Entregador</p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-white hover:bg-white/20"
                            onClick={() => {
                                base44.auth.signOut();
                                window.location.href = '/';
                            }}
                        >
                            <LogOut className="w-5 h-5" />
                        </Button>
                    </div>
                </div>

                {/* Card de Seleções */}
                <div className="bg-white rounded-xl shadow-sm border p-5">
                    {/* Seleção de Data */}
                    <div className="mb-4">
                        <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Data</label>
                        <input
                            type="date" lang="pt-BR"
                            value={dataSelecionada}
                            onChange={(e) => setDataSelecionada(e.target.value)}
                            className="w-full border rounded-lg px-3 py-2 text-sm"
                        />
                    </div>

                    {/* Seleção de Caminhão */}
                    <div className="mb-4">
                        <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Caminhão</label>
                        <Select value={caminhaoSelecionado?.toString()} onValueChange={(v) => setCaminhaoSelecionado(Number(v))}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione o caminhão..." />
                            </SelectTrigger>
                            <SelectContent>
                                {caminhoes.map(c => (
                                    <SelectItem key={c.id} value={c.id.toString()}>
                                        🚚 {c.nome} {c.placa ? `(${c.placa})` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Seleção de Turno */}
                    <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Turno</label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { id: 'Manhã', icon: Sun, label: 'Manhã', bgLight: 'bg-amber-50/50', bgSolid: 'bg-amber-500', borderColor: 'border-amber-300', textColor: 'text-amber-600', textSelected: 'text-white' },
                                { id: 'Tarde', icon: Sunset, label: 'Tarde', bgLight: 'bg-orange-50/50', bgSolid: 'bg-orange-500', borderColor: 'border-orange-300', textColor: 'text-orange-600', textSelected: 'text-white' },
                                { id: 'Comercial', icon: Briefcase, label: 'Comercial', bgLight: 'bg-blue-50/50', bgSolid: 'bg-blue-500', borderColor: 'border-blue-300', textColor: 'text-blue-600', textSelected: 'text-white' }
                            ].map(turno => (
                                <button
                                    key={turno.id}
                                    onClick={() => setTurnoSelecionado(turno.id)}
                                    className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${turnoSelecionado === turno.id
                                        ? `${turno.bgSolid} border-transparent ${turno.textSelected} shadow-lg scale-105`
                                        : `${turno.bgLight} ${turno.borderColor} ${turno.textColor} hover:scale-102`
                                        }`}
                                >
                                    <turno.icon className={`w-6 h-6 ${turnoSelecionado === turno.id ? 'animate-pulse' : ''}`} />
                                    <span className="text-sm font-bold">{turno.label}</span>
                                    <Badge
                                        variant="secondary"
                                        className={`text-xs ${turnoSelecionado === turno.id ? 'bg-white/20 text-white' : ''}`}
                                    >
                                        {entregasPorTurno[turno.id]?.length || 0} entregas
                                    </Badge>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Alerta de Pagamento */}
                {
                    turnoSelecionado && pedidosAReceber.length > 0 && (
                        <Card className="border-2 border-amber-400 bg-amber-50">
                            <CardContent className="p-4">
                                <div className="flex items-start gap-3">
                                    <div className="p-2 rounded-full bg-amber-200">
                                        <DollarSign className="w-5 h-5 text-amber-700" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-amber-800">
                                            {pedidosAReceber.length} pedido(s) a RECEBER
                                        </p>
                                        <p className="text-sm text-amber-700">
                                            Total: R$ {pedidosAReceber.reduce((s, p) => s + (p.valor_a_receber || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </p>
                                        <div className="text-xs text-amber-800 mt-1 font-medium">
                                            {(() => {
                                                const formas = [...new Set(pedidosAReceber.map(p => p.forma_pagamento_entrega || p.forma_pagamento).filter(Boolean))];
                                                return (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span>📝 {formas.join(', ')}</span>
                                                        {formas.some(f => f.toLowerCase().includes('dinheiro')) && <span>💵 Leve troco (confira os valores)</span>}
                                                        {formas.some(f => f.toLowerCase().includes('cartão')) && <span>💳 Verifique a bateria da máquina</span>}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )
                }

                {/* Preview das Entregas */}
                {
                    turnoSelecionado && (
                        <Card className="border-0 shadow-sm">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Package className="w-4 h-4" />
                                    Entregas do turno ({entregasRota.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {entregasRota.slice(0, 5).map((e, i) => (
                                    <div key={e.id} className="flex items-center gap-2 text-sm p-2 bg-gray-50 rounded">
                                        <Badge variant="outline" className="text-xs">{i + 1}</Badge>
                                        <span className="font-medium truncate flex-1">{e.endereco_entrega?.split(',')[0]}</span>
                                        {(e.pagamento_na_entrega || e.valor_a_receber > 0) && (
                                            <Badge className="bg-amber-500 text-white text-[10px] flex gap-1 items-center">
                                                💰 R$ {(e.valor_a_receber || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                {e.forma_pagamento_entrega && <span className="opacity-75">({e.forma_pagamento_entrega})</span>}
                                            </Badge>
                                        )}
                                    </div>
                                ))}
                                {entregasRota.length > 5 && (
                                    <p className="text-xs text-gray-400 text-center">+ {entregasRota.length - 5} mais...</p>
                                )}
                            </CardContent>
                        </Card>
                    )
                }

                <Button
                    onClick={prepararChecklist}
                    disabled={!caminhaoSelecionado || !turnoSelecionado || entregasRota.length === 0 || enviando}
                    className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {enviando ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                            CARREGANDO...
                        </>
                    ) : (
                        <>
                            <Package className="w-5 h-5 mr-2" />
                            CONFERIR CARGA ({entregasRota.length} entregas)
                        </>
                    )}
                </Button>

                {/* Modal de Checklist de Carregamento (Cópia para view de seleção) */}
                <Dialog open={modalChecklist} onOpenChange={setModalChecklist}>
                    <DialogContent className="max-w-md max-h-[90vh] overflow-hidden flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Package className="w-5 h-5 text-blue-600" />
                                Checklist de Carregamento
                            </DialogTitle>
                        </DialogHeader>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                            {(() => {
                                const grupos = {};
                                itensChecklist.forEach((item, idx) => {
                                    const chave = String(item.pedido);
                                    if (!grupos[chave]) grupos[chave] = { pedido: item.pedido, cliente: item.cliente, itens: [] };
                                    grupos[chave].itens.push({ ...item, _idx: idx });
                                });
                                return Object.values(grupos).map((grupo) => {
                                    const selecionaveis = grupo.itens.filter(i => !i.bloqueado_montagem);
                                    const todosConferidos = selecionaveis.length > 0 && selecionaveis.every(i => itensConferidos.has(i.id));
                                    const algumBloqueado = grupo.itens.some(i => i.bloqueado_montagem);
                                    return (
                                        <div key={grupo.pedido} className={`rounded-lg border-2 overflow-hidden transition-all ${todosConferidos ? 'border-green-400' : algumBloqueado ? 'border-gray-300' : 'border-gray-200'}`}>
                                            <div className={`px-3 py-2 flex items-center gap-2 ${todosConferidos ? 'bg-green-50' : algumBloqueado ? 'bg-gray-100' : 'bg-blue-50'}`}>
                                                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-semibold text-xs">Ped #{grupo.pedido}</span>
                                                <span className="text-sm font-medium text-gray-800 truncate">{grupo.cliente}</span>
                                            </div>
                                            <div className="divide-y divide-gray-100">
                                                {grupo.itens.map((item) => {
                                                    const conferido = itensConferidos.has(item.id);
                                                    const bloqueadoMontagem = item.bloqueado_montagem;
                                                    return (
                                                        <div
                                                            key={item.id}
                                                            onClick={() => {
                                                                if (bloqueadoMontagem) return;
                                                                toggleItemConferido(item.id);
                                                            }}
                                                            className={`p-3 flex items-start gap-3 transition-all ${bloqueadoMontagem
                                                                ? 'bg-gray-100 opacity-60 cursor-not-allowed'
                                                                : conferido
                                                                    ? 'bg-green-50 cursor-pointer'
                                                                    : 'bg-white hover:bg-blue-50 cursor-pointer'
                                                                }`}
                                                        >
                                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${bloqueadoMontagem
                                                                ? 'bg-gray-300 text-gray-600'
                                                                : conferido ? 'bg-green-500 text-white' : 'bg-gray-200'
                                                                }`}>
                                                                {bloqueadoMontagem
                                                                    ? <AlertTriangle className="w-4 h-4" />
                                                                    : conferido ? <Check className="w-4 h-4" /> : <span className="text-xs text-gray-500">{item._idx + 1}</span>}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className={`font-medium leading-tight ${bloqueadoMontagem ? 'text-gray-500' : 'text-gray-900'}`}>{item.produto}</p>
                                                                <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                                                                    <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-medium">Qtd: {item.quantidade}</span>
                                                                    {item.cor && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">{item.cor}</span>}
                                                                    {item.codigo && <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">Cód: {item.codigo}</span>}
                                                                </div>
                                                                {bloqueadoMontagem && (
                                                                    <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded px-2 py-1 font-medium">
                                                                        Item bloqueado: montagem interna pendente.
                                                                    </p>
                                                                )}
                                                                {item.detalhes && (
                                                                    <p className="text-xs text-gray-600 mt-2 bg-gray-50 p-2 rounded border border-gray-100 italic">{item.detalhes}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                        <div className="pt-4 border-t space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-500">Conferidos:</span>
                                <span className={`font-bold ${podeIniciarChecklist ? 'text-green-600' : 'text-gray-700'}`}>
                                    {conferidosSelecionaveisChecklist} / {itensSelecionaveisChecklist.length}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setModalChecklist(false)}
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    onClick={() => {
                                        setModalChecklist(false);
                                        iniciarRota();
                                    }}
                                    disabled={!podeIniciarChecklist}
                                    className="bg-green-600 hover:bg-green-700"
                                >
                                    <Navigation className="w-4 h-4 mr-1" />
                                    Iniciar Rota
                                </Button>
                            </div>
                            {!podeIniciarChecklist && (
                                <p className="text-xs text-center text-amber-600">
                                    {itensBloqueadosChecklist > 0
                                        ? `Há ${itensBloqueadosChecklist} item(ns) bloqueado(s) por montagem pendente.`
                                        : 'Confira todos os itens para iniciar'}
                                </p>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            </div >
        );
    }
    // ===== TELA DE EXECUÇÃO DA ROTA =====
    return (
        <div className="max-w-lg mx-auto p-4 space-y-4 pb-24 bg-gray-50 min-h-screen">
            {/* Header com Status */}
            <div className="bg-white rounded-xl shadow-sm border p-4 sticky top-2 z-10">
                <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={finalizarRota}>
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div>
                            <h1 className="font-bold text-gray-900">Rota {turnoSelecionado}</h1>
                            <p className="text-xs text-gray-500">{formatarData(dataSelecionada)} • {entregasRota.filter(e => e.status !== 'Entregue').length} pendentes</p>
                        </div>
                    </div>
                    <div className={`p-2 rounded-full ${rotaIniciada ? 'bg-green-100 text-green-700 animate-pulse' : 'bg-gray-100'}`}>
                        <Radio className="w-5 h-5" />
                    </div>
                </div>

                {rotaIniciada && (
                    <div className="flex items-center justify-center gap-2 p-2 bg-green-50 text-green-800 rounded text-xs font-medium">
                        <span className="w-2 h-2 bg-green-600 rounded-full animate-ping" />
                        GPS ativo • Atualizando a cada 5s
                    </div>
                )}

                <div className="mt-3">
                    <Button
                        size="sm"
                        variant={modoReorganizarParadas ? 'default' : 'outline'}
                        className="w-full gap-2"
                        onClick={() => {
                            setModoReorganizarParadas((prev) => {
                                if (prev) setDragEntregaId(null);
                                return !prev;
                            });
                        }}
                    >
                        <GripVertical className="w-4 h-4" />
                        {modoReorganizarParadas ? 'Concluir reorganização' : 'Reorganizar paradas'}
                    </Button>
                </div>
            </div>

            {/* Lista de Entregas */}
            <div className="space-y-3">
                {modoReorganizarParadas && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs font-medium">
                        Modo reorganização ativo: arraste cada parada pelas 3 barras para cima ou para baixo.
                    </div>
                )}
                {entregasRota.map((entrega, index) => {
                    const temPagamento = entrega.pagamento_na_entrega || entrega.valor_a_receber > 0;
                    const isProxima = entrega.id === primeiraPendenteId;
                    const venda = vendasMapEntregador[entrega.venda_id] || null;
                    const cliente = clientesMapEntregador[venda?.cliente_id] || null;
                    const itensVenda = Array.isArray(venda?.itens)
                        ? venda.itens
                        : (typeof venda?.itens === 'string' ? (() => { try { return JSON.parse(venda.itens); } catch { return []; } })() : []);
                    const contatosExtras = Array.isArray(cliente?.contatos) ? cliente.contatos : [];
                    const telDigits = (entrega.cliente_telefone || '').replace(/\D/g, '');

                    return (
                        <Card
                            key={entrega.id}
                            draggable={modoReorganizarParadas}
                            onDragStart={(e) => iniciarDragParada(e, entrega.id)}
                            onDragOver={permitirDropParada}
                            onDrop={(e) => finalizarDropParada(e, entrega.id)}
                            onDragEnd={() => setDragEntregaId(null)}
                            className={`border-0 shadow-sm ${isProxima ? 'ring-2 ring-blue-500' : ''} ${entrega.status === 'Entregue' ? 'opacity-50' : ''} ${dragEntregaId === entrega.id ? 'ring-2 ring-amber-400' : ''}`}
                        >
                            {isProxima && (
                                <div className="bg-blue-600 text-white text-[10px] font-bold px-3 py-1 text-center">
                                    PRÓXIMA PARADA
                                </div>
                            )}
                            {entrega.status === 'Entregue' && (
                                <div className="bg-green-600 text-white text-[10px] font-bold px-3 py-1 text-center">
                                    ENTREGUE
                                </div>
                            )}

                            {/* Badge de pagamento */}
                            {temPagamento && entrega.status !== 'Entregue' && (
                                <div className="bg-amber-500 text-white text-[10px] font-bold px-3 py-1 text-center flex items-center justify-center gap-1">
                                    <DollarSign className="w-3 h-3" />
                                    RECEBER: R$ {(entrega.valor_a_receber || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    {entrega.forma_pagamento_entrega && ` (${entrega.forma_pagamento_entrega})`}
                                </div>
                            )}

                            <CardContent className="p-4 space-y-3">
                                {/* Header: posição + pedido */}
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        {modoReorganizarParadas && (
                                            <span
                                                data-drag-handle="true"
                                                className="p-1.5 rounded-md border border-dashed border-gray-300 text-gray-400 cursor-grab active:cursor-grabbing"
                                                title="Arraste para reorganizar"
                                            >
                                                <GripVertical className="w-4 h-4" />
                                            </span>
                                        )}
                                        <Badge variant="outline" className="text-sm font-bold">
                                            #{ordemCongelada.length > 0 ? ordemCongelada.indexOf(entrega.id) + 1 : index + 1}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-400">Pedido</span>
                                        <span className="font-bold text-sm">#{entrega.numero_pedido}</span>
                                    </div>
                                </div>

                                {/* Cliente + telefones */}
                                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 space-y-1.5">
                                    <p className="font-bold text-gray-900">{entrega.cliente_nome}</p>
                                    {telDigits && (
                                        <a
                                            href={modoReorganizarParadas ? '#' : `https://wa.me/55${telDigits}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => {
                                                if (modoReorganizarParadas) e.preventDefault();
                                            }}
                                            className={`flex items-center gap-1.5 text-sm font-medium ${modoReorganizarParadas ? 'text-gray-400 cursor-not-allowed' : 'text-green-700'}`}
                                        >
                                            <MessageCircle className="w-4 h-4 flex-shrink-0" />
                                            {entrega.cliente_telefone}
                                        </a>
                                    )}
                                    {cliente?.telefone_alternativo && (
                                        <a
                                            href={modoReorganizarParadas ? '#' : `https://wa.me/55${cliente.telefone_alternativo.replace(/\D/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => {
                                                if (modoReorganizarParadas) e.preventDefault();
                                            }}
                                            className={`flex items-center gap-1.5 text-sm ${modoReorganizarParadas ? 'text-gray-400 cursor-not-allowed' : 'text-green-700'}`}
                                        >
                                            <MessageCircle className="w-4 h-4 flex-shrink-0" />
                                            {cliente.telefone_alternativo}
                                            <span className="text-xs text-gray-400">(alternativo)</span>
                                        </a>
                                    )}
                                    {contatosExtras.map((c, i) => c.telefone && (
                                        <a
                                            key={i}
                                            href={modoReorganizarParadas ? '#' : `https://wa.me/55${c.telefone.replace(/\D/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => {
                                                if (modoReorganizarParadas) e.preventDefault();
                                            }}
                                            className={`flex items-center gap-1.5 text-sm ${modoReorganizarParadas ? 'text-gray-400 cursor-not-allowed' : 'text-green-700'}`}
                                        >
                                            <MessageCircle className="w-4 h-4 flex-shrink-0" />
                                            {c.telefone}
                                            {c.nome && <span className="text-xs text-gray-400">({c.nome})</span>}
                                        </a>
                                    ))}
                                </div>

                                {/* Endereço + Ponto de referência */}
                                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                    <div className="flex items-start gap-2">
                                        <MapPin className="w-5 h-5 mt-0.5 text-red-500 flex-shrink-0" />
                                        <div className="flex-1">
                                            <p className="font-bold text-gray-800 leading-tight">{entrega.endereco_entrega}</p>
                                            {entrega.endereco_entrega_ponto_referencia && (
                                                <p className="text-xs text-amber-800 mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                                    Ref: {entrega.endereco_entrega_ponto_referencia}
                                                </p>
                                            )}
                                            <a
                                                href={modoReorganizarParadas ? '#' : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entrega.endereco_entrega || '')}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => {
                                                    if (modoReorganizarParadas) e.preventDefault();
                                                }}
                                                className={`text-xs mt-1 inline-block ${modoReorganizarParadas ? 'text-gray-400 cursor-not-allowed' : 'text-blue-600 hover:underline'}`}
                                            >
                                                Abrir no Maps →
                                            </a>
                                        </div>
                                    </div>
                                </div>

                                {/* Itens do pedido */}
                                {itensVenda.length > 0 && (
                                    <div className="rounded-lg border border-gray-100 overflow-hidden">
                                        <div className="bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-1">
                                            <Package className="w-3 h-3" /> Itens ({itensVenda.length})
                                        </div>
                                        <div className="divide-y divide-gray-50">
                                            {itensVenda.map((item, i) => (
                                                <div key={i} className="px-3 py-2 flex justify-between items-start text-sm">
                                                    <span className="text-gray-800 flex-1 pr-2">
                                                        {item.nome || item.produto_nome || item.descricao || `Item ${i + 1}`}
                                                        {item.cor && <span className="text-xs text-gray-400 ml-1">· {item.cor}</span>}
                                                    </span>
                                                    <span className="text-gray-500 flex-shrink-0 text-xs font-medium">
                                                        {item.quantidade > 1 ? `${item.quantidade}x` : '1x'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Observações */}
                                {(entrega.observacoes || venda?.observacoes) && (
                                    <div className="space-y-1">
                                        {entrega.observacoes && (
                                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-xs text-yellow-900">
                                                <span className="font-semibold">Obs. entrega: </span>{entrega.observacoes}
                                            </div>
                                        )}
                                        {venda?.observacoes && (
                                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs text-blue-900">
                                                <span className="font-semibold">Obs. pedido: </span>{venda.observacoes}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Montagem */}
                                {entrega.tipo_montagem && entrega.tipo_montagem !== 'sem_montagem' && entrega.tipo_montagem !== '' && (
                                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 text-xs text-purple-900 flex items-center gap-2">
                                        <Wrench className="w-4 h-4 flex-shrink-0 text-purple-600" />
                                        <span>
                                            <span className="font-semibold">Montagem: </span>{entrega.tipo_montagem}
                                            {entrega.montagem_status && ` · ${entrega.montagem_status}`}
                                        </span>
                                    </div>
                                )}

                                {/* Tentativas anteriores */}
                                {entrega.tentativas > 0 && (
                                    <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">
                                        ⚠️ Tentativa {entrega.tentativas + 1} - {entrega.observacoes_entrega}
                                    </div>
                                )}

                                {!modoReorganizarParadas && entrega.status !== 'Entregue' && (
                                    <div className="space-y-2">
                                        {/* Aviso de Montagem Pendente */}
                                        {temMontagemPendente(entrega) && (
                                            <div className="bg-amber-50 border border-amber-300 rounded p-2 text-xs text-amber-700 flex items-start gap-2">
                                                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                <span><strong>Montagem Pendente:</strong> Conclua a montagem interna antes de entregar.</span>
                                            </div>
                                        )}
                                        {/* Botões principais */}
                                        <div className="grid grid-cols-1 gap-2">
                                            <Button
                                                size="sm"
                                                disabled={temMontagemPendente(entrega)}
                                                className={`${temMontagemPendente(entrega) ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                                                onClick={() => iniciarFinalizacao(entrega)}
                                                title={temMontagemPendente(entrega) ? 'Montagem interna pendente' : 'Entregar pedido'}
                                            >
                                                <PenTool className="w-4 h-4 mr-1" /> Entregar
                                            </Button>
                                        </div>

                                        {/* Botão de falha */}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full border-red-300 text-red-600 hover:bg-red-50"
                                            onClick={() => iniciarFalhaEntrega(entrega)}
                                        >
                                            <X className="w-4 h-4 mr-1" /> Não consegui entregar
                                        </Button>

                                        {/* Botão de confirmar pagamento (simplificado) */}
                                        {temPagamento && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full border-amber-400 text-amber-700 hover:bg-amber-50"
                                                onClick={() => abrirModalConfirmacaoPagamento(entrega, 'manual')}
                                            >
                                                <DollarSign className="w-4 h-4 mr-1" /> Confirmar Pagamento
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}

                {/* Assistências Técnicas */}
                {todasAssistencias.length > 0 && (
                    <>
                        <div className="flex items-center gap-2 mt-4 mb-2">
                            <div className="flex-1 h-px bg-purple-200" />
                            <span className="text-xs font-bold text-purple-600 uppercase flex items-center gap-1">
                                <Wrench className="w-3.5 h-3.5" />
                                Assistências Técnicas ({todasAssistencias.length})
                            </span>
                            <div className="flex-1 h-px bg-purple-200" />
                        </div>

                        {todasAssistencias.map((assistencia) => (
                            <Card key={`at-${assistencia.id}`} className="border-0 shadow-sm ring-2 ring-purple-200 bg-gradient-to-r from-purple-50 to-white">
                                <div className="bg-purple-600 text-white text-[10px] font-bold px-3 py-1 text-center flex items-center justify-center gap-1">
                                    <Wrench className="w-3 h-3" />
                                    {assistencia.tipo.toUpperCase()}
                                </div>

                                <CardContent className="p-4">
                                    {/* Header */}
                                    <div className="flex justify-between items-center mb-2">
                                        <Badge variant="outline" className="text-sm font-bold border-purple-300 text-purple-700">
                                            AT #{assistencia.numero_pedido}
                                        </Badge>
                                        <Badge className={`text-[10px] ${assistencia.prioridade === 'Urgente' ? 'bg-red-500' :
                                            assistencia.prioridade === 'Alta' ? 'bg-orange-500' : 'bg-purple-500'
                                            }`}>
                                            {assistencia.prioridade}
                                        </Badge>
                                    </div>

                                    {/* Cliente */}
                                    <p className="font-bold text-gray-800 mb-1">{assistencia.cliente_nome}</p>

                                    {/* Problema */}
                                    <div className="bg-purple-50 rounded-lg p-2 mb-3 border border-purple-100">
                                        <p className="text-xs text-purple-800 font-medium">Problema:</p>
                                        <p className="text-sm text-gray-700">{assistencia.descricao_problema}</p>
                                    </div>

                                    {/* Itens */}
                                    {assistencia.itens_envolvidos?.length > 0 && (
                                        <p className="text-xs text-gray-500 mb-3">
                                            <strong>Itens:</strong> {assistencia.itens_envolvidos.map(i => i.produto_nome).join(', ')}
                                        </p>
                                    )}

                                    {/* Botões */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={modoReorganizarParadas}
                                            onClick={() => {
                                                const tel = assistencia.cliente_telefone?.replace(/\D/g, '');
                                                if (tel) window.open(`https://wa.me/55${tel}`, '_blank');
                                                else toast.error("Telefone não cadastrado");
                                            }}
                                        >
                                            <Send className="w-4 h-4 mr-1" /> Contato
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="bg-purple-600 hover:bg-purple-700"
                                            disabled={modoReorganizarParadas}
                                            onClick={() => {
                                                setModalConcluirAssistencia(assistencia);
                                                setObservacaoAssistencia("");
                                            }}
                                        >
                                            <CheckCircle className="w-4 h-4 mr-1" /> Concluir
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </>
                )}

                {sessaoVerificada && entregasRota.filter(e => e.status !== 'Entregue').length === 0 && todasAssistencias.length === 0 && (
                    <div className="text-center py-10 text-gray-400">
                        <CheckCircle className="w-16 h-16 mx-auto mb-3 opacity-20" />
                        <p className="font-medium">Todas as tarefas concluídas!</p>
                        <Button variant="outline" className="mt-4" onClick={finalizarRota}>
                            Finalizar Rota
                        </Button>
                    </div>
                )}
            </div>

            {/* Modal de Assinatura */}
            <Dialog open={!!modalAssinatura} onOpenChange={() => setModalAssinatura(null)}>
                <DialogContent className="w-[95vw] max-w-lg h-[90vh] flex flex-col p-4">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <PenTool className="w-5 h-5" />
                            Assinatura do Cliente
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 flex flex-col py-2 min-h-0">
                        <p className="text-sm text-gray-500 mb-2 text-center">
                            Peça ao cliente para assinar abaixo confirmando o recebimento
                        </p>
                        <AssinaturaCanvas
                            onSave={salvarAssinatura}
                            onCancel={() => setModalAssinatura(null)}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal de Comprovante de Pagamento */}
            <Dialog open={!!modalComprovante} onOpenChange={() => setModalComprovante(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Camera className="w-5 h-5" />
                            Comprovante de Pagamento
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        {(() => {
                            const pagamentosComprovante = modalComprovante?.pagamentoPayload?.pagamentos || [];
                            const valorRecebidoComprovante = pagamentosComprovante.length > 0
                                ? pagamentosComprovante.reduce((sum, pagamento) => sum + toMoneyNumber(pagamento.valor), 0)
                                : toMoneyNumber(modalComprovante?.pagamentoPayload?.valorRecebido || modalComprovante?.valor_a_receber || 0);

                            return (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                            <p className="text-sm font-medium text-amber-800">
                                Valor recebido: R$ {valorRecebidoComprovante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                            {pagamentosComprovante.length > 0 ? (
                                pagamentosComprovante.map((pagamento, index) => (
                                    <p key={`${pagamento.forma_pagamento}-${index}`} className="text-xs text-amber-600">
                                        {pagamento.forma_pagamento}{pagamento.parcelas > 1 ? ` (${pagamento.parcelas}x)` : ''}: R$ {formatMoney(pagamento.valor)}
                                    </p>
                                ))
                            ) : modalComprovante?.pagamentoPayload?.formaPagamento ? (
                                <p className="text-xs text-amber-600">Forma: {modalComprovante.pagamentoPayload.formaPagamento}</p>
                            ) : null}
                        </div>
                            );
                        })()}
                        <CameraCapture
                            titulo="Foto do Comprovante"
                            onCapture={salvarComprovante}
                            onCancel={() => {
                                const entrega = modalComprovante;
                                setModalComprovante(null);

                                    if (!entrega) return;

                                    if (entrega.contexto === 'finalizacao') {
                                        finalizarEntrega(entrega, entrega.assinatura_url, null, entrega.pagamentoPayload || null);
                                        return;
                                    }

                                    setEnviando(true);
                                    applyDeliveryPayment({
                                        entrega,
                                        ...(entrega.pagamentoPayload || {}),
                                        comprovanteUrl: null,
                                    })
                                        .then(() => {
                                            toast.success('Pagamento confirmado!');
                                            queryClient.invalidateQueries({ queryKey: ['entregas-dia'] });
                                            queryClient.invalidateQueries({ queryKey: ['entregas'] });
                                            queryClient.invalidateQueries({ queryKey: ['vendas'] });
                                            queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
                                        })
                                        .catch((error) => {
                                            console.error('Erro ao registrar pagamento sem comprovante:', error);
                                            toast.error(error.message || 'Erro ao registrar pagamento');
                                        })
                                        .finally(() => {
                                            setEnviando(false);
                                        });
                            }}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            {/* NOVO: Modal de Foto dos Móveis Entregues */}
            <Dialog open={!!modalFotoEntrega} onOpenChange={() => { }}>
                <DialogContent className="max-w-md mx-4">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-green-600">
                            <Camera className="w-5 h-5" />
                            Foto dos Móveis (Obrigatório)
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-2">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                            <p className="text-sm text-green-700 text-center">
                                📸 Tire foto dos móveis entregues ao cliente
                            </p>
                            <p className="text-xs text-green-600 text-center mt-1">
                                Esta foto serve como comprovante de entrega
                            </p>
                        </div>
                        <FotoEntregaCapture
                            entregaId={modalFotoEntrega?.id}
                            numeroPedido={modalFotoEntrega?.numero_pedido}
                            minFotos={1}
                            maxFotos={3}
                            onComplete={salvarFotosEntrega}
                            onCancel={() => {
                                // Foto é obrigatória: voltar não deve avançar entrega sem confirmação.
                                setModalFotoEntrega(null);
                                toast.info('Capture e confirme ao menos 1 foto para finalizar a entrega.');
                            }}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal de Falha na Entrega */}
            <Dialog open={!!modalFalha} onOpenChange={() => setModalFalha(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="w-5 h-5" />
                            Não foi possível entregar
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        {etapaFalha === 'foto' ? (
                            <>
                                <p className="text-sm text-gray-500 mb-4 text-center">
                                    📸 Tire uma foto da FRENTE DA CASA/LOCAL do cliente
                                </p>
                                <CameraCapture
                                    titulo="Foto do Local (Obrigatório)"
                                    onCapture={salvarFotoFalha}
                                    onCancel={() => setModalFalha(null)}
                                />
                            </>
                        ) : (
                            <div className="space-y-4">
                                <div className="bg-gray-100 rounded-lg p-2">
                                    <img src={fotoFalha} alt="Foto do local" className="w-full h-32 object-cover rounded" />
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-gray-700 block mb-2">
                                        Motivo (obrigatório):
                                    </label>
                                    <Textarea
                                        value={observacaoFalha}
                                        onChange={(e) => setObservacaoFalha(e.target.value)}
                                        placeholder="Ex: Cliente não estava em casa, endereço incorreto, recusa de recebimento..."
                                        rows={3}
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => setEtapaFalha('foto')}
                                        className="flex-1"
                                    >
                                        Refazer Foto
                                    </Button>
                                    <Button
                                        onClick={confirmarFalhaEntrega}
                                        disabled={!observacaoFalha.trim() || enviando}
                                        className="flex-1 bg-red-600 hover:bg-red-700"
                                    >
                                        Confirmar
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal de Conclusão de Assistência */}
            <Dialog open={!!modalConcluirAssistencia} onOpenChange={() => setModalConcluirAssistencia(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-purple-700">
                            <Wrench className="w-5 h-5" />
                            Concluir Assistência
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        {modalConcluirAssistencia && (
                            <>
                                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                                    <p className="text-xs text-purple-600 font-bold uppercase mb-1">{modalConcluirAssistencia.tipo}</p>
                                    <p className="font-bold text-gray-800">{modalConcluirAssistencia.cliente_nome}</p>
                                    <p className="text-sm text-gray-600">Pedido #{modalConcluirAssistencia.numero_pedido}</p>
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-gray-700 block mb-2">
                                        Observação / Solução Aplicada (opcional):
                                    </label>
                                    <Textarea
                                        value={observacaoAssistencia}
                                        onChange={(e) => setObservacaoAssistencia(e.target.value)}
                                        placeholder="Ex: Peça entregue ao cliente, troca realizada, problema resolvido..."
                                        rows={3}
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => setModalConcluirAssistencia(null)}
                                        className="flex-1"
                                    >
                                        Cancelar
                                    </Button>
                                    <Button
                                        onClick={concluirAssistencia}
                                        disabled={enviando}
                                        className="flex-1 bg-purple-600 hover:bg-purple-700"
                                    >
                                        {enviando ? "Salvando..." : "Marcar Concluída"}
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            

            {/* Modal de Confirmação de Pagamento Simplificado */}
            <Dialog open={!!modalConfirmaPagamento} onOpenChange={fecharModalConfirmacaoPagamento}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <DollarSign className="w-5 h-5 text-amber-600" />
                            Confirmar Pagamento
                        </DialogTitle>
                    </DialogHeader>
                    {modalConfirmaPagamento && (
                        <div className="space-y-4">
                            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                                <p className="text-sm text-amber-800 font-medium">Pedido foi pago?</p>
                                <p className="text-2xl font-bold text-amber-900">
                                    R$ {formatMoney(modalConfirmaPagamento.valor_a_receber || 0)}
                                </p>
                                {modalConfirmaPagamento.forma_pagamento_entrega && (
                                    <p className="text-xs text-amber-600 mt-1">
                                        Forma: {modalConfirmaPagamento.forma_pagamento_entrega}
                                    </p>
                                )}
                            </div>

                            {/* Opções Pago/Pendente */}
                            <div className="grid grid-cols-2 gap-3">
                                <Button
                                    variant={pagamentoStatus === 'pago' ? 'default' : 'outline'}
                                    onClick={() => setPagamentoStatus('pago')}
                                    className={pagamentoStatus === 'pago' ? 'bg-green-600 hover:bg-green-700' : ''}
                                >
                                    <Check className="w-4 h-4 mr-1" /> Pago
                                </Button>
                                <Button
                                    variant={pagamentoStatus === 'pendente' ? 'default' : 'outline'}
                                    onClick={() => setPagamentoStatus('pendente')}
                                    className={pagamentoStatus === 'pendente' ? 'bg-red-600 hover:bg-red-700' : ''}
                                >
                                    <X className="w-4 h-4 mr-1" /> Não Pago
                                </Button>
                            </div>

                            {pagamentoStatus === 'pago' && (
                                <div className="space-y-3">
                                    <div className="rounded-lg border p-3 space-y-3">
                                        <div className="space-y-2">
                                            <p className="text-sm font-medium text-gray-700">Forma de pagamento</p>
                                            <Select
                                                value={novoPagamentoConfirmacao.forma_pagamento}
                                                onValueChange={(value) => setNovoPagamentoConfirmacao((prev) => ({ ...prev, forma_pagamento: value, parcelas: 1 }))}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione a forma" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {PAYMENT_METHOD_OPTIONS.map((forma) => (
                                                        <SelectItem key={forma} value={forma}>
                                                            {forma}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2">
                                            <p className="text-sm font-medium text-gray-700">Valor recebido</p>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={novoPagamentoConfirmacao.valor}
                                                onChange={(e) => setNovoPagamentoConfirmacao((prev) => ({ ...prev, valor: e.target.value }))}
                                                placeholder="0,00"
                                            />
                                        </div>

                                        {isInstallmentPaymentMethod(novoPagamentoConfirmacao.forma_pagamento) && (
                                            <div className="space-y-2">
                                                <p className="text-sm font-medium text-gray-700">Parcelas</p>
                                                <Select
                                                    value={String(novoPagamentoConfirmacao.parcelas || 1)}
                                                    onValueChange={(value) => setNovoPagamentoConfirmacao((prev) => ({ ...prev, parcelas: Number(value) }))}
                                                >
                                                    <SelectTrigger>
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

                                        <Button type="button" className="w-full" onClick={adicionarPagamentoConfirmacao}>
                                            Adicionar forma
                                        </Button>
                                    </div>

                                    <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between gap-3">
                                        <span>Total informado: <strong>R$ {formatMoney(totalPagamentoConfirmacao)}</strong></span>
                                        <span>Saldo restante: <strong>R$ {formatMoney(saldoPagamentoConfirmacao)}</strong></span>
                                    </div>

                                    <p className="text-xs text-gray-500">
                                        Informe o valor efetivamente recebido. Se houver saldo restante, o pedido continua pendente.
                                    </p>

                                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                        {pagamentosConfirmacao.length === 0 ? (
                                            <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground text-center">
                                                Nenhuma forma adicionada ainda.
                                            </div>
                                        ) : pagamentosConfirmacao.map((pagamento, index) => (
                                            <div key={`${pagamento.forma_pagamento}-${index}`} className="flex items-center justify-between rounded-md border px-3 py-2 gap-3">
                                                <div>
                                                    <p className="text-sm font-medium">{pagamento.forma_pagamento}{pagamento.parcelas > 1 ? ` (${pagamento.parcelas}x)` : ''}</p>
                                                    <p className="text-xs text-muted-foreground">R$ {formatMoney(pagamento.valor)}</p>
                                                </div>
                                                <Button type="button" variant="ghost" size="sm" onClick={() => removerPagamentoConfirmacao(index)}>
                                                    Remover
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Motivo se Pendente */}
                            {pagamentoStatus === 'pendente' && (
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-gray-700">Motivo:</p>
                                    <div className="grid grid-cols-1 gap-2">
                                        {['Sem dinheiro', 'Cartão recusado', 'Máquina sem sinal', 'PIX não caiu', 'Vai pagar depois'].map(motivo => (
                                            <Button
                                                key={motivo}
                                                variant={motivoPendente === motivo ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => setMotivoPendente(motivo)}
                                                className={motivoPendente === motivo ? 'bg-red-500' : ''}
                                            >
                                                {motivo}
                                            </Button>
                                        ))}
                                    </div>
                                    <Textarea
                                        placeholder="Outro motivo..."
                                        value={motivoPendente.startsWith('Sem dinheiro') || motivoPendente.startsWith('Cartão') || motivoPendente.startsWith('Máquina') || motivoPendente.startsWith('PIX') || motivoPendente.startsWith('Vai pagar') ? '' : motivoPendente}
                                        onChange={(e) => setMotivoPendente(e.target.value)}
                                        className="h-16"
                                    />
                                </div>
                            )}

                            {/* Botão Confirmar */}
                            <Button
                                className={`w-full ${pagamentoStatus === 'pago' ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'}`}
                                onClick={confirmarPagamentoNoModal}
                                disabled={enviando || (pagamentoStatus === 'pendente' && !motivoPendente.trim()) || (pagamentoStatus === 'pago' && !pagamentosConfirmacao.length)}
                            >
                                {pagamentoStatus === 'pago' ? (
                                    <><Check className="w-4 h-4 mr-1" /> Confirmar e anexar comprovante</>
                                ) : (
                                    <><AlertTriangle className="w-4 h-4 mr-1" /> Finalizar com pendência</>
                                )}
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Modal de Checklist de Carregamento */}
            <Dialog open={modalChecklist} onOpenChange={setModalChecklist}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Package className="w-5 h-5 text-blue-600" />
                            Checklist de Carregamento
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                        {(() => {
                            const grupos = {};
                            itensChecklist.forEach((item, idx) => {
                                const chave = String(item.pedido);
                                if (!grupos[chave]) grupos[chave] = { pedido: item.pedido, cliente: item.cliente, itens: [] };
                                grupos[chave].itens.push({ ...item, _idx: idx });
                            });
                            return Object.values(grupos).map((grupo) => {
                                const selecionaveis = grupo.itens.filter(i => !i.bloqueado_montagem);
                                const todosConferidos = selecionaveis.length > 0 && selecionaveis.every(i => itensConferidos.has(i.id));
                                const algumBloqueado = grupo.itens.some(i => i.bloqueado_montagem);
                                return (
                                    <div key={grupo.pedido} className={`rounded-lg border-2 overflow-hidden transition-all ${todosConferidos ? 'border-green-400' : algumBloqueado ? 'border-gray-300' : 'border-gray-200'}`}>
                                        <div className={`px-3 py-2 flex items-center gap-2 ${todosConferidos ? 'bg-green-50' : algumBloqueado ? 'bg-gray-100' : 'bg-blue-50'}`}>
                                            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-semibold text-xs">Ped #{grupo.pedido}</span>
                                            <span className="text-sm font-medium text-gray-800 truncate">{grupo.cliente}</span>
                                        </div>
                                        <div className="divide-y divide-gray-100">
                                            {grupo.itens.map((item) => {
                                                const conferido = itensConferidos.has(item.id);
                                                const bloqueadoMontagem = item.bloqueado_montagem;
                                                return (
                                                    <div
                                                        key={item.id}
                                                        onClick={() => {
                                                            if (bloqueadoMontagem) return;
                                                            toggleItemConferido(item.id);
                                                        }}
                                                        className={`p-3 flex items-start gap-3 transition-all ${bloqueadoMontagem
                                                            ? 'bg-gray-100 opacity-60 cursor-not-allowed'
                                                            : conferido
                                                                ? 'bg-green-50 cursor-pointer'
                                                                : 'bg-white hover:bg-blue-50 cursor-pointer'
                                                            }`}
                                                    >
                                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${bloqueadoMontagem
                                                            ? 'bg-gray-300 text-gray-600'
                                                            : conferido ? 'bg-green-500 text-white' : 'bg-gray-200'
                                                            }`}>
                                                            {bloqueadoMontagem
                                                                ? <AlertTriangle className="w-4 h-4" />
                                                                : conferido ? <Check className="w-4 h-4" /> : <span className="text-xs text-gray-500">{item._idx + 1}</span>}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className={`font-medium leading-tight ${bloqueadoMontagem ? 'text-gray-500' : 'text-gray-900'}`}>{item.produto}</p>
                                                            <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                                                                <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-medium">Qtd: {item.quantidade}</span>
                                                                {item.cor && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">{item.cor}</span>}
                                                            </div>
                                                            {bloqueadoMontagem && (
                                                                <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded px-2 py-1 font-medium">
                                                                    Item bloqueado: montagem interna pendente.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                    <div className="pt-4 border-t space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Conferidos:</span>
                            <span className={`font-bold ${podeIniciarChecklist ? 'text-green-600' : 'text-gray-700'}`}>
                                {conferidosSelecionaveisChecklist} / {itensSelecionaveisChecklist.length}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setModalChecklist(false)}
                            >
                                Cancelar
                            </Button>
                            <Button
                                onClick={() => {
                                    setModalChecklist(false);
                                    iniciarRota();
                                }}
                                disabled={!podeIniciarChecklist}
                                className="bg-green-600 hover:bg-green-700"
                            >
                                <Navigation className="w-4 h-4 mr-1" />
                                Iniciar Rota
                            </Button>
                        </div>
                        {!podeIniciarChecklist && (
                            <p className="text-xs text-center text-amber-600">
                                {itensBloqueadosChecklist > 0
                                    ? `Há ${itensBloqueadosChecklist} item(ns) bloqueado(s) por montagem pendente.`
                                    : 'Confira todos os itens para iniciar'}
                            </p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
