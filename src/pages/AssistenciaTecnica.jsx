import React, { useState, useMemo } from "react";
import { base44, supabase } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
    Plus, Search, Trash2, Edit, Loader2, Wrench,
    AlertCircle, Clock, CheckCircle, Package, Filter, Link as LinkIcon, FileText
} from "lucide-react";
import AssistenciaTecnicaModal from "../components/assistencia/AssistenciaTecnicaModal";
import SelecionarLojaReposicaoModal from "../components/assistencia/SelecionarLojaReposicaoModal";
import { abrirAssistenciaTecnicaPDF } from "../components/assistencia/AssistenciaTecnicaPDF";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import DevolucaoModal from "../components/devolucoes/DevolucaoModal";
import { createOperationalFinancialEntry } from '@/services/financialOperations';

const TIPOS_COM_REPOSICAO = ['Troca', 'Peça Faltante'];

const TIPOS_ASSISTENCIA = [
    { value: "Devolução", label: "Devolução", color: "bg-red-100 text-red-800 border-red-200" },
    { value: "Troca", label: "Troca", color: "bg-orange-100 text-orange-800 border-orange-200" },
    { value: "Peça Faltante", label: "Peça Faltante", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    { value: "Conserto", label: "Conserto", color: "bg-blue-100 text-blue-800 border-blue-200" },
    { value: "Visita Técnica", label: "Visita Técnica", color: "bg-purple-100 text-purple-800 border-purple-200" },
    { value: "Outros", label: "Outros", color: "bg-gray-100 text-gray-800 border-gray-200" }
];

const STATUS_OPTIONS = [
    { value: "Aberta", label: "Aberta", color: "bg-blue-100 text-blue-800 border-blue-200" },
    { value: "Em Andamento", label: "Em Andamento", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    { value: "Aguardando Peça", label: "Aguardando Peça", color: "bg-orange-100 text-orange-800 border-orange-200" },
    { value: "Aguardando Cliente", label: "Aguardando Cliente", color: "bg-purple-100 text-purple-800 border-purple-200" },
    { value: "Concluída", label: "Concluída", color: "bg-green-100 text-green-800 border-green-200" },
    { value: "Cancelada", label: "Cancelada", color: "bg-red-100 text-red-800 border-red-200" }
];

const PRIORIDADE_OPTIONS = [
    { value: "Baixa", label: "Baixa", color: "bg-gray-100 text-gray-600 border-gray-200" },
    { value: "Normal", label: "Normal", color: "bg-blue-100 text-blue-700 border-blue-200" },
    { value: "Alta", label: "Alta", color: "bg-orange-100 text-orange-700 border-orange-200" },
    { value: "Urgente", label: "Urgente", color: "bg-red-100 text-red-700 border-red-200" }
];

export default function AssistenciaTecnica() {
    const [searchTerm, setSearchTerm] = useState("");
    const [filterTipo, setFilterTipo] = useState("todos");
    const [filterStatus, setFilterStatus] = useState("todos");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAssistencia, setEditingAssistencia] = useState(null);
    const [saving, setSaving] = useState(false);
    const [reposicaoPendente, setReposicaoPendente] = useState(null);
    const [isReposicaoModalOpen, setIsReposicaoModalOpen] = useState(false);
    const { user } = useAuth();
    const { brandName } = useTenant();
    const queryClient = useQueryClient();

    // Queries
    // Devolution module states
    const [isDevolucaoModalOpen, setIsDevolucaoModalOpen] = useState(false);
    const [editingDevolucao, setEditingDevolucao] = useState(null);
    const [savingDevolucao, setSavingDevolucao] = useState(false);

    // Queries
    const { data: assistencias = [], isLoading: isLoadingAssistencias } = useQuery({
        queryKey: ['assistencias'],
        queryFn: () => base44.entities.AssistenciaTecnica.list('-created_at')
    });

    const { data: devolucoes = [], isLoading: isLoadingDevolucoes } = useQuery({
        queryKey: ['devolucoes'],
        queryFn: () => base44.entities.Devolucao.list('-created_date')
    });

    const { data: vendas = [] } = useQuery({
        queryKey: ['vendas'],
        queryFn: () => base44.entities.Venda.list('-data_venda')
    });

    const { data: lojas = [] } = useQuery({
        queryKey: ['lojas'],
        queryFn: () => base44.entities.Loja.list('nome')
    });

    const { data: clientes = [] } = useQuery({
        queryKey: ['clientes'],
        queryFn: () => base44.entities.Cliente.list()
    });

    const { data: fornecedores = [] } = useQuery({
        queryKey: ['fornecedores'],
        queryFn: () => base44.entities.Fornecedor.list()
    });

    const { data: produtos = [] } = useQuery({
        queryKey: ['produtos'],
        queryFn: () => base44.entities.Produto.list('nome'),
        enabled: isModalOpen
    });

    const isLoading = isLoadingAssistencias || isLoadingDevolucoes;

    // ==============================================
    // FUNÇÃO PRINCIPAL DE SAVE COM INTEGRAÇÕES
    // ==============================================
    const handleSave = async (formData) => {
        const isEditing = !!editingAssistencia;
        const statusAnterior = editingAssistencia?.status;
        const mudouParaConcluida = formData.status === 'Concluída' && statusAnterior !== 'Concluída';
        const exigeReposicao =
            mudouParaConcluida &&
            TIPOS_COM_REPOSICAO.includes(formData.tipo) &&
            (formData.itens_envolvidos?.length ?? 0) > 0;

        // Se exige reposição, interceptar e abrir modal de seleção de loja antes de salvar
        if (exigeReposicao) {
            setReposicaoPendente({ formData, isEditing, statusAnterior, mudouParaConcluida });
            setIsReposicaoModalOpen(true);
            return;
        }

        await _executarSave({ formData, isEditing, statusAnterior, mudouParaConcluida, selecaoLojas: null });
    };

    // Chamado pelo SelecionarLojaReposicaoModal ao confirmar seleção de lojas
    const handleConfirmarReposicao = async (selecaoLojas) => {
        setIsReposicaoModalOpen(false);
        if (!reposicaoPendente) return;
        const { formData, isEditing, statusAnterior, mudouParaConcluida } = reposicaoPendente;
        setReposicaoPendente(null);
        await _executarSave({ formData, isEditing, statusAnterior, mudouParaConcluida, selecaoLojas });
    };

    const handleCancelarReposicao = () => {
        setIsReposicaoModalOpen(false);
        setReposicaoPendente(null);
    };

    const _executarSave = async ({ formData, isEditing, statusAnterior, mudouParaConcluida, selecaoLojas }) => {
        setSaving(true);
        const hoje = new Date().toISOString().split('T')[0];

        try {
            // 1. Adicionar histórico de mudança de status
            const novoHistorico = formData.historico || [];
            if (isEditing && formData.status !== statusAnterior) {
                novoHistorico.push({
                    status_anterior: statusAnterior,
                    status_novo: formData.status,
                    data: new Date().toISOString(),
                    usuario: user?.full_name || user?.email || 'Sistema'
                });
            }
            formData.historico = novoHistorico;

            // 2. Se concluiu, preencher data_resolucao automaticamente
            if (mudouParaConcluida && !formData.data_resolucao) {
                formData.data_resolucao = hoje;
            }

            // 3. Salvar a assistência
            let assistenciaSalva;
            if (isEditing) {
                assistenciaSalva = await base44.entities.AssistenciaTecnica.update(editingAssistencia.id, formData);
            } else {
                // Ao criar, já adicionar o primeiro registro no histórico
                formData.historico = [{
                    status_anterior: null,
                    status_novo: formData.status,
                    data: new Date().toISOString(),
                    usuario: user?.full_name || user?.email || 'Sistema'
                }];
                assistenciaSalva = await base44.entities.AssistenciaTecnica.create(formData);
            }

            // 4. INTEGRAÇÃO FINANCEIRA - Executar quando concluída com valores
            if (mudouParaConcluida) {
                // Se houver valor devolvido, criar lançamento de saída
                if (formData.valor_devolvido > 0) {
                    try {
                        await createOperationalFinancialEntry({
                            sourceType: 'assistencia',
                            sourceId: assistenciaSalva.id,
                            operationKey: `assistencia:${assistenciaSalva.id}:devolucao`,
                            entry: {
                            descricao: `Devolução #${formData.numero_pedido} - ${formData.cliente_nome} (${formData.tipo})`,
                            valor: -formData.valor_devolvido,
                            tipo: 'despesa',
                            data_vencimento: hoje,
                            data_lancamento: hoje,
                            pago: true,
                            categoria_nome: 'Devoluções/Assistência',
                            status: 'Pago',
                            observacao: `Assistência técnica: ${formData.descricao_problema?.substring(0, 100)}...`
                            },
                        });
                        console.log('✅ Lançamento de devolução criado:', formData.valor_devolvido);
                    } catch (err) {
                        await base44.entities.AssistenciaTecnica.update(assistenciaSalva.id, {
                            status: statusAnterior,
                            data_resolucao: null,
                        });
                        throw new Error(`Assistência salva, mas o lançamento da devolução falhou: ${err.message}`);
                    }
                }

                // Se houver valor cobrado, criar lançamento de entrada
                if (formData.valor_cobrado > 0) {
                    try {
                        await createOperationalFinancialEntry({
                            sourceType: 'assistencia',
                            sourceId: assistenciaSalva.id,
                            operationKey: `assistencia:${assistenciaSalva.id}:cobranca`,
                            entry: {
                            descricao: `Serviço AT #${formData.numero_pedido} - ${formData.cliente_nome} (${formData.tipo})`,
                            valor: formData.valor_cobrado,
                            tipo: 'receita',
                            data_vencimento: hoje,
                            data_lancamento: hoje,
                            pago: true,
                            categoria_nome: 'Serviços/Assistência',
                            status: 'Pago',
                            observacao: `Assistência técnica: ${formData.solucao_aplicada?.substring(0, 100) || 'N/A'}`
                            },
                        });
                        console.log('✅ Lançamento de serviço criado:', formData.valor_cobrado);
                    } catch (err) {
                        await base44.entities.AssistenciaTecnica.update(assistenciaSalva.id, {
                            status: statusAnterior,
                            data_resolucao: null,
                        });
                        throw new Error(`Assistência salva, mas o lançamento do serviço falhou: ${err.message}`);
                    }
                }

                // 5. INTEGRAÇÃO ESTOQUE - Devolver itens ao estoque quando for Devolução
                if (formData.tipo === 'Devolução' && formData.itens_envolvidos?.length > 0) {
                    for (const item of formData.itens_envolvidos) {
                        try {
                            const { data: produto, error } = await supabase
                                .from('produtos')
                                .select('*')
                                .eq('id', item.produto_id)
                                .single();

                            if (error) throw error;

                            if (produto) {
                                // Sincronização Global (PDV)
                                await base44.entities.Produto.update(produto.id, {
                                    quantidade_estoque: (produto.quantidade_estoque || 0) + item.quantidade,
                                    quantidade_reservada: Math.max(0, (produto.quantidade_reservada || 0) - item.quantidade)
                                });

                                // Sincronização Local (Scanner/Estoque Loja)
                                const tenantId = user?.loja || 'CD';
                                await supabase.from('estoque_loja').insert({
                                    gtin: produto.gtin,
                                    tenant_id: tenantId,
                                    quantidade: item.quantidade,
                                    volumes_recebidos: Array.from({ length: produto.volumes || 1 }, (_, i) => i + 1)
                                });

                                console.log('✅ Estoque sincronizado (Global + Local):', item.produto_nome, '+', item.quantidade);
                            }
                        } catch (err) {
                            console.error('Erro ao atualizar estoque sincronizado:', err);
                        }
                    }
                }

                // 6. INTEGRAÇÃO REPOSIÇÃO - Descontar estoque e criar solicitação de reposição para Troca / Peça Faltante
                if (selecaoLojas && TIPOS_COM_REPOSICAO.includes(formData.tipo) && formData.itens_envolvidos?.length > 0) {
                    const assistenciaSalva = await base44.entities.AssistenciaTecnica.list(
                        '-created_at'
                    ).then(list => list.find(a => a.numero_pedido === formData.numero_pedido));

                    for (const item of formData.itens_envolvidos) {
                        const prodSaiId = item.produto_sai_id || item.produto_id;
                        const prodSaiNome = item.produto_sai_nome || item.produto_nome;
                        const prodSaiQtd = item.produto_sai_quantidade || item.quantidade;

                        const lojaInfo = selecaoLojas[prodSaiId] || selecaoLojas[item.produto_id];
                        if (!lojaInfo) continue;

                        try {
                            // a) Buscar estoque atual da loja selecionada
                            const { data: estoqueRows } = await supabase
                                .from('estoque_loja')
                                .select('id, quantidade')
                                .eq('produto_id', prodSaiId)
                                .eq('loja_id', lojaInfo.loja_id)
                                .maybeSingle();

                            const qtdAtual = estoqueRows?.quantidade ?? 0;
                            const qtdNova = Math.max(0, qtdAtual - prodSaiQtd);

                            if (estoqueRows?.id) {
                                // b) Decrementar estoque_loja
                                await supabase
                                    .from('estoque_loja')
                                    .update({ quantidade: qtdNova, updated_at: new Date().toISOString() })
                                    .eq('id', estoqueRows.id);
                            }

                            // c) Recalcular produtos.quantidade_estoque (soma de todas as lojas)
                            const { data: todasLojas } = await supabase
                                .from('estoque_loja')
                                .select('quantidade')
                                .eq('produto_id', prodSaiId);

                            const totalEstoque = (todasLojas || []).reduce(
                                (sum, row) => sum + (row.quantidade || 0), 0
                            );

                            await supabase
                                .from('produtos')
                                .update({ quantidade_estoque: totalEstoque })
                                .eq('id', prodSaiId);

                            // d) Registrar movimentação de auditoria
                            await supabase.from('movimentacoes_estoque').insert({
                                produto_id: prodSaiId,
                                evento_tipo: 'assistencia_troca',
                                modulo_origem: 'assistencia',
                                quantidade: prodSaiQtd,
                                estoque_antes_total: qtdAtual,
                                estoque_depois_total: qtdNova,
                                loja_origem: lojaInfo.loja_nome,
                                referencia_numero: formData.numero_pedido,
                                usuario_id: user?.id,
                                usuario_nome: user?.full_name || user?.email || 'Sistema',
                                organization_id: user?.organization_id
                            });

                            // e) Criar solicitação de reposição para o setor de compras
                            await base44.entities.SolicitacaoReposicao.create({
                                assistencia_id: assistenciaSalva?.id || null,
                                numero_assistencia: formData.numero_pedido,
                                produto_id: prodSaiId,
                                produto_nome: prodSaiNome,
                                quantidade: prodSaiQtd,
                                loja_id: lojaInfo.loja_id,
                                loja_nome: lojaInfo.loja_nome,
                                status: 'Pendente',
                                observacoes: `Gerado ao concluir assistência #${formData.numero_pedido} - ${formData.tipo} - ${formData.cliente_nome}`,
                                tenant_id: user?.organization_id
                            });

                            console.log('✅ Reposição criada e estoque decrementado:', prodSaiNome, 'loja:', lojaInfo.loja_nome);
                        } catch (err) {
                            console.error('Erro ao processar reposição para item:', prodSaiNome, err);
                        }
                    }

                    queryClient.invalidateQueries({ queryKey: ['solicitacoes-reposicao'] });
                }
            }

            // Invalidar queries para atualizar a lista
            queryClient.invalidateQueries({ queryKey: ['assistencias'] });
            queryClient.invalidateQueries({ queryKey: ['produtos'] });
            queryClient.invalidateQueries({ queryKey: ['lancamentos'] });

            setIsModalOpen(false);
            setEditingAssistencia(null);
            toast.success(isEditing ? "Assistência atualizada!" : "Assistência criada!");

        } catch (error) {
            console.error('Erro ao salvar assistência:', error);
            toast.error("Erro ao salvar assistência");
        } finally {
            setSaving(false);
        }
    };

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.AssistenciaTecnica.delete(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assistencias'] })
    });

    // Devolution mutations
    const createDevolucaoMutation = useMutation({
        mutationFn: (data) => base44.entities.Devolucao.create(data),
        onSuccess: async () => {
            await invalidateRelatedData();
            setIsModalOpen(false);
            setEditingAssistencia(null);
            toast.success("Devolução/Troca criada com sucesso!");
        }
    });

    const updateDevolucaoMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.Devolucao.update(id, data),
        onSuccess: async () => {
            await invalidateRelatedData();
            setIsModalOpen(false);
            setEditingAssistencia(null);
            toast.success("Devolução/Troca atualizada com sucesso!");
        }
    });

    const deleteDevolucaoMutation = useMutation({
        mutationFn: (id) => base44.entities.Devolucao.delete(id),
        onSuccess: async () => {
            await invalidateRelatedData();
            toast.success("Devolução/Troca excluída com sucesso!");
        }
    });

    const invalidateRelatedData = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['devolucoes'] }),
            queryClient.invalidateQueries({ queryKey: ['produtos'] }),
            queryClient.invalidateQueries({ queryKey: ['vendas'] }),
            queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] }),
            queryClient.invalidateQueries({ queryKey: ['movimentacoes-estoque'] }),
            queryClient.invalidateQueries({ queryKey: ['assistencias'] })
        ]);
    };

    const handleSaveDevolucao = async (data) => {
        setSavingDevolucao(true);
        const performSave = async (payload) => {
            if (editingAssistencia && editingAssistencia.id) {
                return updateDevolucaoMutation.mutateAsync({ id: editingAssistencia.id, data: payload });
            }
            return createDevolucaoMutation.mutateAsync(payload);
        };

        try {
            await performSave(data);
        } catch (error) {
            const msg = String(error?.message || '').toLowerCase();
            if (!msg.includes('column') || !msg.includes('does not exist')) {
                toast.error("Erro ao salvar devolução");
                throw error;
            }

            const payloadCompat = { ...data };
            delete payloadCompat.financeiro_tipo;
            delete payloadCompat.justificativa_financeira;
            delete payloadCompat.destino_estoque;
            delete payloadCompat.cliente_nome;
            delete payloadCompat.financeiro_lancamento_id;
            delete payloadCompat.financeiro_lancamentos_ids;
            delete payloadCompat.processado_por;
            delete payloadCompat.data_processamento;
            delete payloadCompat.organization_id;

            await performSave(payloadCompat);
        } finally {
            setSavingDevolucao(false);
        }
    };

    const handleDeleteDevolucao = (id) => {
        if (window.confirm("Tem certeza que deseja excluir esta devolução/troca? Esta ação não pode ser desfeita.")) {
            deleteDevolucaoMutation.mutate(id);
        }
    };

    // Combine lists into a unifiedList
    const unifiedList = useMemo(() => {
        const mappedAssistencias = assistencias.map(a => ({
            ...a,
            itemType: 'assistencia',
            dateForSort: new Date(a.data_abertura || a.created_at)
        }));

        const mappedDevolucoes = devolucoes.map(d => ({
            ...d,
            itemType: 'devolucao',
            descricao_problema: d.observacoes || `Itens: ${(d.itens_devolvidos || []).map(i => i.produto_nome).join(', ')}`,
            prioridade: 'Normal',
            data_abertura: d.data_devolucao,
            dateForSort: new Date(d.data_devolucao || d.created_at)
        }));

        return [...mappedAssistencias, ...mappedDevolucoes].sort((a, b) => b.dateForSort - a.dateForSort);
    }, [assistencias, devolucoes]);

    // Filtering
    const filtered = useMemo(() => {
        return unifiedList.filter(item => {
            const matchesSearch =
                item.numero_pedido?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.cliente_nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.descricao_problema?.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesTipo = filterTipo === "todos" || item.tipo === filterTipo;
            const matchesStatus = filterStatus === "todos" || item.status === filterStatus;

            return matchesSearch && matchesTipo && matchesStatus;
        });
    }, [unifiedList, searchTerm, filterTipo, filterStatus]);

    // Statistics
    const stats = {
        abertas: assistencias.filter(a => a.status === 'Aberta').length,
        emAndamento: assistencias.filter(a => a.status === 'Em Andamento').length,
        aguardando: assistencias.filter(a => a.status === 'Aguardando Peça' || a.status === 'Aguardando Cliente').length,
        concluidas: assistencias.filter(a => a.status === 'Concluída').length,
        urgentes: assistencias.filter(a => a.prioridade === 'Urgente' && a.status !== 'Concluída' && a.status !== 'Cancelada').length
    };

    const handleDelete = async (id) => {
        const ok = window.confirm("Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.");
        if (ok) {
            deleteMutation.mutate(id);
        }
    };

    const getTipoBadge = (tipo, itemType) => {
        if (itemType === 'devolucao') {
            const color = tipo === 'Troca' ? 'bg-orange-100 text-orange-800 border-orange-200' : 'bg-red-100 text-red-800 border-red-200';
            return <Badge className={`${color} border px-2 py-0.5 text-[10px] uppercase tracking-wider`}>{tipo}</Badge>;
        }
        const config = TIPOS_ASSISTENCIA.find(t => t.value === tipo) || TIPOS_ASSISTENCIA[5];
        return <Badge className={`${config.color} border px-2 py-0.5 text-[10px] uppercase tracking-wider`}>{tipo}</Badge>;
    };

    const getStatusBadge = (status, itemType) => {
        if (itemType === 'devolucao') {
            const styles = {
                "Aprovada": "bg-green-100 text-green-800 border-green-200",
                "Pendente": "bg-yellow-100 text-yellow-800 border-yellow-200",
                "Rejeitada": "bg-red-100 text-red-800 border-red-200",
                "Processada": "bg-blue-100 text-blue-800 border-blue-200"
            };
            return <Badge className={`${styles[status] || "bg-gray-100 text-gray-800"} border px-2 py-0.5 text-[10px] uppercase tracking-wider`}>{status}</Badge>;
        }
        const config = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
        return <Badge className={`${config.color} border px-2 py-0.5 text-[10px] uppercase tracking-wider`}>{status}</Badge>;
    };

    const getPrioridadeBadge = (prioridade) => {
        const config = PRIORIDADE_OPTIONS.find(p => p.value === prioridade) || PRIORIDADE_OPTIONS[1];
        return <Badge className={`${config.color} border px-2 py-0.5 text-[10px] uppercase tracking-wider`}>{prioridade}</Badge>;
    };

    const handleImprimir = async (assistencia) => {
        const venda = vendas.find(v => String(v.id) === String(assistencia.venda_id)) || null;
        const clienteCompleto = venda
            ? (clientes.find(c => c.id === venda.cliente_id) || {
                nome_completo: assistencia.cliente_nome,
                telefone: assistencia.cliente_telefone
            })
            : {
                nome_completo: assistencia.cliente_nome,
                telefone: assistencia.cliente_telefone
            };
        const lojaInfo = venda
            ? lojas.find(l => String(l.nome).trim().toLowerCase() === String(venda.loja || '').trim().toLowerCase()) || null
            : null;

        // Fetch only the specific products involved in this assistance request
        const productIds = [
            ...new Set(
                (assistencia.itens_envolvidos || []).flatMap(i => [i.produto_id, i.produto_sai_id].filter(Boolean))
            )
        ];

        let involvedProducts = [];
        if (productIds.length > 0) {
            try {
                const { data } = await supabase
                    .from('produtos')
                    .select('*')
                    .in('id', productIds);
                involvedProducts = data || [];
            } catch (err) {
                console.error("Erro ao carregar produtos envolvidos para o PDF:", err);
            }
        }

        abrirAssistenciaTecnicaPDF(assistencia, venda, clienteCompleto, lojaInfo ? { ...lojaInfo, empresa_nome: brandName } : null, involvedProducts);
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">

            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Wrench className="w-6 h-6 text-green-700" />
                        Assistência Técnica
                    </h1>
                    <p className="text-sm text-gray-500">Gestão de devoluções, trocas, consertos e suporte pós-venda</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={() => {
                            const origin = window.location.hostname === 'localhost' ? 'https://moveispedro2.com.br' : window.location.origin;
                            const link = `${origin}/assistencia/auto`;
                            navigator.clipboard.writeText(link);
                            toast.success("Link copiado para a área de transferência!");
                        }}
                    >
                        <LinkIcon className="w-4 h-4 mr-2" />
                        Link Autoatendimento
                    </Button>
                    <Button
                        onClick={() => { setEditingAssistencia(null); setIsModalOpen(true); }}
                        className="bg-green-700 hover:bg-green-800 text-white"
                    >
                        <Plus className="w-4 h-4 mr-2" /> Nova Assistência
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card className="border-l-4 border-l-blue-500">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-2xl font-bold text-blue-600">{stats.abertas}</p>
                                <p className="text-xs text-gray-500">Abertas</p>
                            </div>
                            <AlertCircle className="w-8 h-8 text-blue-200" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-yellow-500">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-2xl font-bold text-yellow-600">{stats.emAndamento}</p>
                                <p className="text-xs text-gray-500">Em Andamento</p>
                            </div>
                            <Clock className="w-8 h-8 text-yellow-200" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-orange-500">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-2xl font-bold text-orange-600">{stats.aguardando}</p>
                                <p className="text-xs text-gray-500">Aguardando</p>
                            </div>
                            <Package className="w-8 h-8 text-orange-200" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-green-500">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-2xl font-bold text-green-600">{stats.concluidas}</p>
                                <p className="text-xs text-gray-500">Concluídas</p>
                            </div>
                            <CheckCircle className="w-8 h-8 text-green-200" />
                        </div>
                    </CardContent>
                </Card>
                <Card className={`border-l-4 ${stats.urgentes > 0 ? 'border-l-red-500 bg-red-50' : 'border-l-gray-300'}`}>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className={`text-2xl font-bold ${stats.urgentes > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                    {stats.urgentes}
                                </p>
                                <p className="text-xs text-gray-500">Urgentes</p>
                            </div>
                            <AlertCircle className={`w-8 h-8 ${stats.urgentes > 0 ? 'text-red-300' : 'text-gray-200'}`} />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800">
                <div className="flex flex-wrap gap-4 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Buscar por pedido, cliente ou descrição..."
                            className="pl-9 border-gray-200 dark:border-neutral-700"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-gray-400" />
                        <Select value={filterTipo} onValueChange={setFilterTipo}>
                            <SelectTrigger className="w-[150px]">
                                <SelectValue placeholder="Tipo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos">Todos os Tipos</SelectItem>
                                {TIPOS_ASSISTENCIA.map(t => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={filterStatus} onValueChange={setFilterStatus}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos">Todos os Status</SelectItem>
                                {STATUS_OPTIONS.map(s => (
                                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800 overflow-hidden">
                <Table>
                    <TableHeader className="bg-gray-50 dark:bg-neutral-950">
                        <TableRow>
                            <TableHead>Pedido</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Problema</TableHead>
                            <TableHead>Prioridade</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Data</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center py-8">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                                </TableCell>
                            </TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                                    Nenhuma assistência encontrada.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map(a => (
                                <TableRow key={`${a.itemType}-${a.id}`} className={a.prioridade === 'Urgente' && a.status !== 'Concluída' ? 'bg-red-50' : ''}>
                                    <TableCell className="font-medium">#{a.numero_pedido}</TableCell>
                                    <TableCell>{a.cliente_nome}</TableCell>
                                    <TableCell>{getTipoBadge(a.tipo, a.itemType)}</TableCell>
                                    <TableCell className="max-w-[200px] truncate text-sm text-gray-600">
                                        {a.descricao_problema}
                                    </TableCell>
                                    <TableCell>{a.itemType === 'devolucao' ? '-' : getPrioridadeBadge(a.prioridade)}</TableCell>
                                    <TableCell>{getStatusBadge(a.status, a.itemType)}</TableCell>
                                    <TableCell className="text-sm text-gray-500">
                                        {new Date(a.itemType === 'devolucao' ? a.data_devolucao : a.data_abertura).toLocaleDateString('pt-BR')}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {a.itemType === 'assistencia' ? (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleImprimir(a)}
                                                        title="Imprimir assistência"
                                                    >
                                                        <FileText className="w-4 h-4 text-green-700" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => { setEditingAssistencia(a); setIsModalOpen(true); }}
                                                    >
                                                        <Edit className="w-4 h-4 text-blue-600" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDelete(a.id)}
                                                    >
                                                        <Trash2 className="w-4 h-4 text-red-600" />
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => { setEditingAssistencia(a); setIsModalOpen(true); }}
                                                    >
                                                        <Edit className="w-4 h-4 text-blue-600" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        disabled={a.status === 'Aprovada'}
                                                        onClick={() => handleDeleteDevolucao(a.id)}
                                                    >
                                                        <Trash2 className="w-4 h-4 text-red-600" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Modal principal */}
            <AssistenciaTecnicaModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setEditingAssistencia(null); }}
                onSave={handleSave}
                assistencia={editingAssistencia}
                vendas={vendas}
                produtos={produtos}
                fornecedores={fornecedores}
                devolucoes={devolucoes}
                onSaveDevolucao={handleSaveDevolucao}
                savingDevolucao={savingDevolucao}
                isLoading={saving}
            />

            {/* Modal de seleção de loja para reposição */}
            <SelecionarLojaReposicaoModal
                isOpen={isReposicaoModalOpen}
                onClose={handleCancelarReposicao}
                onConfirm={handleConfirmarReposicao}
                itens={(reposicaoPendente?.formData?.itens_envolvidos || []).map(item => ({
                    produto_id: item.produto_sai_id || item.produto_id,
                    produto_nome: item.produto_sai_nome || item.produto_nome,
                    quantidade: item.produto_sai_quantidade || item.quantidade
                }))}
                lojas={lojas}
            />
        </div>
    );
}
