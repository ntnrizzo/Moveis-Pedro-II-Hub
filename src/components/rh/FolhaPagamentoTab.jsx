import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { calcularFolhaCompleta } from "@/utils/calculosTrabalhistas";
import { createOperationalFinancialEntry } from '@/services/financialOperations';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DollarSign, FileDown, Calculator, Check, Clock,
    Calendar, Users, Loader2, Eye, Printer, Trash2, Plus
} from "lucide-react";
import { toast } from "sonner";

const MESES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const STATUS_FOLHA = ["Gerado", "Pago", "Cancelado"];

export default function FolhaPagamentoTab() {
    const queryClient = useQueryClient();
    const [mesReferencia, setMesReferencia] = useState(new Date().getMonth() + 1);
    const [anoReferencia, setAnoReferencia] = useState(new Date().getFullYear());
    const [modalGerar, setModalGerar] = useState(false);
    const [modalDetalhes, setModalDetalhes] = useState(false);
    const [folhaSelecionada, setFolhaSelecionada] = useState(null);
    const [gerando, setGerando] = useState(false);

    // States for payment confirmation
    const [modalConfirmarPagamento, setModalConfirmarPagamento] = useState(false);
    const [folhaParaPagar, setFolhaParaPagar] = useState(null);
    const [gerarLancamentoFinanceiro, setGerarLancamentoFinanceiro] = useState(true);

    // States for bulk payment
    const [selecionados, setSelecionados] = useState([]);
    const [diaSelecionado, setDiaSelecionado] = useState(5);
    const [pagandoEmMassa, setPagandoEmMassa] = useState(false);

    const { data: colaboradores = [] } = useQuery({
        queryKey: ['colaboradores'],
        queryFn: () => base44.entities.Colaborador.list(),
    });

    const { data: folhas = [], isLoading } = useQuery({
        queryKey: ['folhas_pagamento'],
        queryFn: () => base44.entities.FolhaPagamento.list('-created_at'),
    });

    const colaboradoresAtivos = colaboradores.filter(c => c.status === 'Ativo' && c.salario_base);

    // Filter folhas by selected period
    const folhasPeriodo = folhas.filter(f =>
        f.mes_referencia === mesReferencia && f.ano_referencia === anoReferencia
    );

    const diasDisponiveis = useMemo(() => {
        const dias = new Set([5, 20]); // Dias padrão
        colaboradores.forEach(c => {
            if (c.status === 'Ativo') {
                if (c.dia_pagamento) dias.add(Number(c.dia_pagamento));
                if (c.recebe_vale && c.dia_vale) dias.add(Number(c.dia_vale));
            }
        });
        return Array.from(dias).sort((a, b) => a - b);
    }, [colaboradores]);

    useEffect(() => {
        if (diasDisponiveis.length > 0 && !diasDisponiveis.includes(diaSelecionado)) {
            setDiaSelecionado(diasDisponiveis[0]);
        }
    }, [diasDisponiveis]);

    // List of payments for the selected day
    const pagamentosDoDia = useMemo(() => {
        if (folhasPeriodo.length === 0) return [];
        const lista = [];

        folhasPeriodo.forEach((folha) => {
            const colab = colaboradores.find(c => c.id === folha.colaborador_id);
            const recebeVale = colab?.recebe_vale === true;
            const valorDiaPagamento = Number(colab?.valor_dia_pagamento) || 0;
            const valorDiaVale = Number(colab?.valor_dia_vale) || 0;
            const temDistribuicao = recebeVale && (valorDiaPagamento + valorDiaVale) > 0;

            const diaPgto = colab?.dia_pagamento || 5;
            const diaVale = colab?.dia_vale || 20;

            if (temDistribuicao) {
                if (diaVale === diaSelecionado && valorDiaVale > 0) {
                    lista.push({
                        key: `${folha.id}-Vale`,
                        folha_id: folha.id,
                        colaborador_nome: folha.colaborador_nome || colab?.nome_completo,
                        tipo: "Vale",
                        valor: valorDiaVale,
                        pago: folha.vale_pago === true || folha.status === 'Pago',
                    });
                }
                if (diaPgto === diaSelecionado && valorDiaPagamento > 0) {
                    lista.push({
                        key: `${folha.id}-Salário`,
                        folha_id: folha.id,
                        colaborador_nome: folha.colaborador_nome || colab?.nome_completo,
                        tipo: "Salário",
                        valor: valorDiaPagamento,
                        pago: folha.salario_pago === true || folha.status === 'Pago',
                    });
                }
            } else {
                if (diaPgto === diaSelecionado) {
                    lista.push({
                        key: `${folha.id}-Salário`,
                        folha_id: folha.id,
                        colaborador_nome: folha.colaborador_nome || colab?.nome_completo,
                        tipo: "Salário",
                        valor: Number(folha.salario_liquido) || 0,
                        pago: folha.salario_pago === true || folha.status === 'Pago',
                    });
                }
            }
        });

        return lista;
    }, [folhasPeriodo, colaboradores, diaSelecionado]);

    const handleToggleSelecionado = (key) => {
        setSelecionados(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    };

    const handleSelectAll = () => {
        const pendentes = pagamentosDoDia.filter(p => !p.pago);
        if (selecionados.length === pendentes.length) {
            setSelecionados([]);
        } else {
            setSelecionados(pendentes.map(p => p.key));
        }
    };

    const pagarSelecionados = async () => {
        if (selecionados.length === 0) return;
        setPagandoEmMassa(true);
        try {
            const dataHoje = new Date().toISOString().slice(0, 10);
            const mesStr = `${MESES[mesReferencia - 1]}/${anoReferencia}`;

            for (const key of selecionados) {
                const item = pagamentosDoDia.find(p => p.key === key);
                if (!item) continue;

                const folha = folhasPeriodo.find(f => f.id === item.folha_id);
                if (!folha) continue;

                const colab = colaboradores.find(c => c.id === folha.colaborador_id);
                const recebeVale = colab?.recebe_vale === true;
                const valorDiaPagamento = Number(colab?.valor_dia_pagamento) || 0;
                const valorDiaVale = Number(colab?.valor_dia_vale) || 0;
                const temDistribuicao = recebeVale && (valorDiaPagamento + valorDiaVale) > 0;

                let updates = {};
                if (item.tipo === "Salário") {
                    updates = {
                        salario_pago: true,
                        data_pagamento_salario: dataHoje,
                    };
                    const valeJaPago = !temDistribuicao || folha.vale_pago === true;
                    if (valeJaPago) {
                        updates.status = "Pago";
                        updates.data_pagamento = dataHoje;
                    }
                } else if (item.tipo === "Vale") {
                    updates = {
                        vale_pago: true,
                        data_pagamento_vale: dataHoje,
                    };
                    const salarioJaPago = folha.salario_pago === true;
                    if (salarioJaPago) {
                        updates.status = "Pago";
                        updates.data_pagamento = dataHoje;
                    }
                }

                await createOperationalFinancialEntry({
                    sourceType: 'folha',
                    sourceId: folha.id,
                    operationKey: `folha:${folha.id}:${item.tipo.toLowerCase()}:${dataHoje}`,
                    entry: {
                    descricao: `${item.tipo} (Dia ${diaSelecionado}) - ${mesStr} - ${item.colaborador_nome}`,
                    valor: -item.valor,
                    tipo: "despesa",
                    categoria_nome: "Folha de Pagamento",
                    data_lancamento: dataHoje,
                    forma_pagamento: "Transferência",
                    status: "Pago",
                    },
                });
                await base44.entities.FolhaPagamento.update(folha.id, updates);
            }

            queryClient.invalidateQueries(["folhas_pagamento"]);
            toast.success(`${selecionados.length} pagamento(s) processado(s) e integrados ao Financeiro!`);
            setSelecionados([]);
        } catch (error) {
            toast.error("Erro ao processar pagamentos: " + error.message);
        } finally {
            setPagandoEmMassa(false);
        }
    };

    // Metrics
    const isFolhaPendente = (f) => {
        if (f.status === 'Pago' || f.status === 'Cancelado') return false;

        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        const diaHoje = new Date().getDate();

        // Se for de meses/anos anteriores, qualquer coisa não paga está pendente
        const isPastMonth = f.ano_referencia < currentYear || (f.ano_referencia === currentYear && f.mes_referencia < currentMonth);
        if (isPastMonth) return true;

        // Se for de meses futuros, nada está pendente ainda
        const isFutureMonth = f.ano_referencia > currentYear || (f.ano_referencia === currentYear && f.mes_referencia > currentMonth);
        if (isFutureMonth) return false;

        // Mês atual: verificar por datas
        const colab = colaboradores.find(c => c.id === f.colaborador_id || c.nome_completo === f.colaborador_nome);
        const recebeVale = colab?.recebe_vale === true;
        const valorDiaPagamento = Number(colab?.valor_dia_pagamento) || 0;
        const valorDiaVale = Number(colab?.valor_dia_vale) || 0;
        const temDistribuicao = recebeVale && (valorDiaPagamento + valorDiaVale) > 0;

        if (temDistribuicao) {
            const diaPgto = Number(colab.dia_pagamento) || 5;
            const diaV = Number(colab.dia_vale) || 20;

            const salPendente = f.salario_pago !== true && diaHoje >= diaPgto;
            const valePendente = f.vale_pago !== true && diaHoje >= diaV;

            return salPendente || valePendente;
        } else {
            const diaPgto = Number(colab?.dia_pagamento) || 5;
            return f.salario_pago !== true && diaHoje >= diaPgto;
        }
    };

    const totalBruto = folhasPeriodo.reduce((sum, f) => sum + (Number(f.salario_bruto) || 0), 0);
    const totalLiquido = folhasPeriodo.reduce((sum, f) => sum + (Number(f.salario_liquido) || 0), 0);
    const totalInss = folhasPeriodo.reduce((sum, f) => sum + (Number(f.inss) || 0), 0);
    const totalFgts = folhasPeriodo.reduce((sum, f) => sum + (Number(f.fgts) || 0), 0);
    const totalVT = folhasPeriodo.reduce((sum, f) => sum + (Number(f.vale_transporte) || 0), 0);
    const folhasPagas = folhasPeriodo.filter(f => f.status === 'Pago').length;
    const folhasPendentes = folhasPeriodo.filter(isFolhaPendente).length;

    const getStatusBadgeStyle = (status) => {
        switch (status) {
            case 'Pago':
                return { backgroundColor: '#D1FAE5', color: '#065F46' };
            case 'Gerado':
                return { backgroundColor: '#FEF3C7', color: '#92400E' };
            case 'Cancelado':
                return { backgroundColor: '#FEE2E2', color: '#991B1B' };
            default:
                return { backgroundColor: '#E5E7EB', color: '#374151' };
        }
    };


    const gerarFolhaMes = async () => {
        setGerando(true);
        try {
            const existentes = folhas.filter(f =>
                f.mes_referencia === mesReferencia && f.ano_referencia === anoReferencia
            );
            const colaboradoresJaGerados = existentes.map(f => f.colaborador_id);

            const colaboradoresParaGerar = colaboradoresAtivos.filter(
                c => !colaboradoresJaGerados.includes(c.id)
            );

            if (colaboradoresParaGerar.length === 0) {
                toast.info("Folha já gerada para todos os colaboradores neste período");
                setGerando(false);
                setModalGerar(false);
                return;
            }

            for (const colab of colaboradoresParaGerar) {
                const resultado = calcularFolhaCompleta(colab);

                try {
                    await base44.entities.FolhaPagamento.create({
                        colaborador_id: colab.id,
                        colaborador_nome: colab.nome_completo,
                        mes_referencia: mesReferencia,
                        ano_referencia: anoReferencia,
                        salario_bruto: resultado.salario_bruto,
                        inss: resultado.inss,
                        irrf: resultado.irrf,
                        fgts: resultado.fgts,
                        vale_transporte: resultado.vale_transporte,
                        adicional_noturno: resultado.adicional_noturno,
                        insalubridade: resultado.insalubridade,
                        periculosidade: resultado.periculosidade,
                        salario_familia: resultado.salario_familia,
                        horas_extras: 0,
                        valor_horas_extras: 0,
                        vale_refeicao: 0,
                        outros_descontos: 0,
                        outros_beneficios: 0,
                        salario_liquido: resultado.salario_liquido,
                        status: 'Gerado',
                        desconto_plano_saude: colab.desconto_plano_saude || 0,
                        desconto_adiantamento: colab.desconto_adiantamento || 0,
                        pensao_alimenticia: resultado.pensao_alimenticia || 0,
                        descontos_adicionais: [],
                    });
                } catch (err) {
                    if (err.code === '42703' || String(err.message).includes('column') || String(err.message).includes('does not exist')) {
                        // Fallback sem os novos campos se a migração ainda não tiver sido rodada
                        await base44.entities.FolhaPagamento.create({
                            colaborador_id: colab.id,
                            colaborador_nome: colab.nome_completo,
                            mes_referencia: mesReferencia,
                            ano_referencia: anoReferencia,
                            salario_bruto: resultado.salario_bruto,
                            inss: resultado.inss,
                            irrf: resultado.irrf,
                            fgts: resultado.fgts,
                            vale_transporte: resultado.vale_transporte,
                            adicional_noturno: resultado.adicional_noturno,
                            insalubridade: resultado.insalubridade,
                            periculosidade: resultado.periculosidade,
                            salario_familia: resultado.salario_familia,
                            horas_extras: 0,
                            valor_horas_extras: 0,
                            vale_refeicao: 0,
                            outros_descontos: (colab.desconto_plano_saude || 0) + (colab.desconto_adiantamento || 0) + (resultado.pensao_alimenticia || 0),
                            outros_beneficios: 0,
                            salario_liquido: resultado.salario_liquido,
                            status: 'Gerado',
                        });
                    } else {
                        throw err;
                    }
                }
            }

            queryClient.invalidateQueries(['folhas_pagamento']);
            toast.success(`Folha gerada para ${colaboradoresParaGerar.length} colaborador(es)!`);
            setModalGerar(false);
        } catch (error) {
            toast.error("Erro ao gerar folha: " + error.message);
        } finally {
            setGerando(false);
        }
    };

    const marcarComoPago = (folha) => {
        setFolhaParaPagar(folha);
        setGerarLancamentoFinanceiro(true);
        setModalConfirmarPagamento(true);
    };

    const confirmarPagamento = async () => {
        if (!folhaParaPagar) return;

        try {
            // Cria primeiro os lançamentos idempotentes. Assim, se a atualização
            // da folha falhar, a tentativa pode ser repetida sem duplicar valores.
            if (gerarLancamentoFinanceiro) {
                // Look up collaborator data to check vale distribution
                const colab = colaboradores.find(c => c.id === folhaParaPagar.colaborador_id);
                const recebeVale = colab?.recebe_vale === true;
                const valorDiaPagamento = Number(colab?.valor_dia_pagamento) || 0;
                const valorDiaVale = Number(colab?.valor_dia_vale) || 0;
                const temDistribuicao = recebeVale && (valorDiaPagamento + valorDiaVale) > 0;

                if (temDistribuicao) {
                    // Create separate entries for each payment date
                    const mesRef = folhaParaPagar.mes_referencia;
                    const anoRef = folhaParaPagar.ano_referencia;
                    const mesStr = `${MESES[mesRef - 1]}/${anoRef}`;
                    const nome = folhaParaPagar.colaborador_nome;

                    const buildDate = (dia) => {
                        const d = String(dia).padStart(2, '0');
                        const m = String(mesRef).padStart(2, '0');
                        return `${anoRef}-${m}-${d}`;
                    };

                    // Entry for Dia do Pagamento
                    if (valorDiaPagamento > 0) {
                        const diaPgto = colab?.dia_pagamento || 5;
                        await createOperationalFinancialEntry({
                            sourceType: 'folha', sourceId: folhaParaPagar.id,
                            operationKey: `folha:${folhaParaPagar.id}:salario`, entry: {
                            descricao: `Folha Pgto (Dia ${diaPgto}) - ${mesStr} - ${nome}`,
                            valor: -valorDiaPagamento,
                            tipo: 'despesa',
                            categoria_nome: 'Folha de Pagamento',
                            data_lancamento: buildDate(diaPgto),
                            forma_pagamento: 'Transferência',
                            status: 'Pago'
                            },
                        });
                    }

                    // Entry for Dia do Vale
                    if (valorDiaVale > 0) {
                        const diaVale = colab?.dia_vale || 20;
                        await createOperationalFinancialEntry({
                            sourceType: 'folha', sourceId: folhaParaPagar.id,
                            operationKey: `folha:${folhaParaPagar.id}:vale`, entry: {
                            descricao: `Vale (Dia ${diaVale}) - ${mesStr} - ${nome}`,
                            valor: -valorDiaVale,
                            tipo: 'despesa',
                            categoria_nome: 'Folha de Pagamento',
                            data_lancamento: buildDate(diaVale),
                            forma_pagamento: 'Transferência',
                            status: 'Pago'
                            },
                        });
                    }
                } else {
                    // Default: single salary entry
                    await createOperationalFinancialEntry({
                        sourceType: 'folha', sourceId: folhaParaPagar.id,
                        operationKey: `folha:${folhaParaPagar.id}:salario`, entry: {
                        descricao: `Pagamento Folha - ${MESES[folhaParaPagar.mes_referencia - 1]}/${folhaParaPagar.ano_referencia} - ${folhaParaPagar.colaborador_nome}`,
                        valor: -Number(folhaParaPagar.salario_liquido),
                        tipo: 'despesa',
                        categoria_nome: 'Salário / Folha',
                        data_lancamento: new Date().toISOString().slice(0, 10),
                        forma_pagamento: 'Transferência',
                        status: 'Pago'
                        },
                    });
                }

                // INSS entry (if > 0)
                if (Number(folhaParaPagar.inss) > 0) {
                    await createOperationalFinancialEntry({
                        sourceType: 'folha', sourceId: folhaParaPagar.id,
                        operationKey: `folha:${folhaParaPagar.id}:inss`, entry: {
                        descricao: `INSS Descontado - ${MESES[folhaParaPagar.mes_referencia - 1]}/${folhaParaPagar.ano_referencia} - ${folhaParaPagar.colaborador_nome}`,
                        valor: -Number(folhaParaPagar.inss),
                        tipo: 'despesa',
                        categoria_nome: 'INSS / Encargos',
                        data_lancamento: new Date().toISOString().slice(0, 10),
                        forma_pagamento: 'Transferência',
                        status: 'Pago'
                        },
                    });
                }

                // FGTS entry (if > 0)
                if (Number(folhaParaPagar.fgts) > 0) {
                    await createOperationalFinancialEntry({
                        sourceType: 'folha', sourceId: folhaParaPagar.id,
                        operationKey: `folha:${folhaParaPagar.id}:fgts`, entry: {
                        descricao: `FGTS Recolhido - ${MESES[folhaParaPagar.mes_referencia - 1]}/${folhaParaPagar.ano_referencia} - ${folhaParaPagar.colaborador_nome}`,
                        valor: -Number(folhaParaPagar.fgts),
                        tipo: 'despesa',
                        categoria_nome: 'FGTS / Encargos',
                        data_lancamento: new Date().toISOString().slice(0, 10),
                        forma_pagamento: 'Transferência',
                        status: 'Pago'
                        },
                    });
                }
            }

            await base44.entities.FolhaPagamento.update(folhaParaPagar.id, {
                status: 'Pago',
                data_pagamento: new Date().toISOString().slice(0, 10),
            });

            queryClient.invalidateQueries(['folhas_pagamento']);
            toast.success("Pagamento registrado com sucesso!");
            setModalConfirmarPagamento(false);
            setFolhaParaPagar(null);
        } catch (error) {
            toast.error("Erro ao registrar pagamento: " + error.message);
        }
    };

    const exportarCSV = () => {
        let csv = "Colaborador,Salário Bruto,INSS,Desc. VT,FGTS,Salário Líquido,Status\n";
        folhasPeriodo.forEach(f => {
            csv += `"${f.colaborador_nome}",${f.salario_bruto},${f.inss},${f.vale_transporte || 0},${f.fgts},${f.salario_liquido},${f.status}\n`;
        });
        csv += `\nTOTAIS,${totalBruto.toFixed(2)},${totalInss.toFixed(2)},${totalVT.toFixed(2)},${totalFgts.toFixed(2)},${totalLiquido.toFixed(2)},`;

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `folha_pagamento_${MESES[mesReferencia - 1]}_${anoReferencia}.csv`;
        a.click();
    };

    return (
        <div className="space-y-6">
            {/* Period Selector */}
            <Card className="border-0 shadow-lg">
                <CardContent className="p-4">
                    <div className="flex flex-wrap items-end gap-4">
                        <div>
                            <Label>Mês</Label>
                            <Select value={String(mesReferencia)} onValueChange={(v) => setMesReferencia(Number(v))}>
                                <SelectTrigger className="w-40">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MESES.map((m, i) => (
                                        <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Ano</Label>
                            <Select value={String(anoReferencia)} onValueChange={(v) => setAnoReferencia(Number(v))}>
                                <SelectTrigger className="w-28">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[2023, 2024, 2025, 2026].map(a => (
                                        <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            onClick={() => setModalGerar(true)}
                            style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
                        >
                            <Calculator className="w-4 h-4 mr-2" />
                            Gerar Folha do Mês
                        </Button>
                        <Button variant="outline" onClick={exportarCSV} disabled={folhasPeriodo.length === 0}>
                            <FileDown className="w-4 h-4 mr-2" />
                            Exportar CSV
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="border-0 shadow-lg">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-gray-500">Total Bruto</p>
                                <p className="text-xl font-bold" style={{ color: '#07593f' }}>
                                    R$ {totalBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                            <DollarSign className="w-8 h-8 opacity-50" style={{ color: '#07593f' }} />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-lg">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-gray-500">Total Líquido</p>
                                <p className="text-xl font-bold text-blue-600">
                                    R$ {totalLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                            <DollarSign className="w-8 h-8 text-blue-600 opacity-50" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-lg">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-gray-500">Pagos</p>
                                <p className="text-xl font-bold text-green-600">{folhasPagas}</p>
                            </div>
                            <Check className="w-8 h-8 text-green-600 opacity-50" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-lg">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-gray-500">Pendentes</p>
                                <p className="text-xl font-bold text-orange-600">{folhasPendentes}</p>
                            </div>
                            <Clock className="w-8 h-8 text-orange-600 opacity-50" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* INSS and FGTS Summary */}
            <div className="grid md:grid-cols-2 gap-4">
                <Card className="border-0 shadow-lg" style={{ backgroundColor: '#f0f9ff' }}>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-600">Total INSS (Descontado)</p>
                                <p className="text-2xl font-bold text-blue-700">
                                    R$ {totalInss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-lg" style={{ backgroundColor: '#FEF3C7' }}>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-600">Total FGTS (A Recolher)</p>
                                <p className="text-2xl font-bold" style={{ color: '#92400E' }}>
                                    R$ {totalFgts.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Painel de Pagamento em Massa */}
            {folhasPeriodo.length > 0 && (
                <Card className="border-0 shadow-lg bg-white dark:bg-neutral-900 border-l-4 border-l-indigo-600">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            <Check className="w-5 h-5 text-indigo-600" />
                            Acompanhamento e Pagamento em Massa por Datas
                        </CardTitle>
                        <p className="text-xs text-gray-400">
                            Selecione o dia do pagamento do mês para visualizar e marcar como pagos todos os salários ou vales daquela data.
                        </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Seletor de Dias do Mês */}
                        <div className="flex gap-2 pb-2 border-b border-gray-100 dark:border-neutral-800">
                            {diasDisponiveis.map(d => (
                                <button
                                    key={d}
                                    onClick={() => { setDiaSelecionado(d); setSelecionados([]); }}
                                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                                        diaSelecionado === d
                                            ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                                            : "bg-gray-50 dark:bg-neutral-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700"
                                    }`}
                                >
                                    Dia {d}
                                </button>
                            ))}
                        </div>

                        {/* Tabela de Pagamentos Previstos para o Dia */}
                        {pagamentosDoDia.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-4">
                                Nenhum salário ou vale previsto para ser pago no dia {diaSelecionado} neste mês.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-xs text-gray-500 uppercase border-b border-gray-100 dark:border-neutral-800">
                                                <th className="py-2 px-2 text-left w-10">
                                                    <input
                                                        type="checkbox"
                                                        className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                                                        checked={pagamentosDoDia.filter(p => !p.pago).length > 0 && selecionados.length === pagamentosDoDia.filter(p => !p.pago).length}
                                                        onChange={handleSelectAll}
                                                        disabled={pagamentosDoDia.filter(p => !p.pago).length === 0}
                                                    />
                                                </th>
                                                <th className="py-2 px-2 text-left">Colaborador</th>
                                                <th className="py-2 px-2 text-center">Tipo</th>
                                                <th className="py-2 px-2 text-right">Valor</th>
                                                <th className="py-2 px-2 text-center">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50 dark:divide-neutral-800/40">
                                            {pagamentosDoDia.map(pag => (
                                                <tr key={pag.key} className={`hover:bg-gray-50/50 dark:hover:bg-neutral-800/10 transition-colors ${pag.pago ? 'opacity-60 bg-gray-50/20' : ''}`}>
                                                    <td className="py-2.5 px-2">
                                                        <input
                                                            type="checkbox"
                                                            className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                                                            checked={selecionados.includes(pag.key)}
                                                            onChange={() => handleToggleSelecionado(pag.key)}
                                                            disabled={pag.pago}
                                                        />
                                                    </td>
                                                    <td className="py-2.5 px-2 font-medium text-gray-800 dark:text-gray-200">
                                                        {pag.colaborador_nome}
                                                    </td>
                                                    <td className="py-2.5 px-2 text-center">
                                                        <Badge 
                                                            variant="outline" 
                                                            className={`text-[10px] py-0 px-2 font-semibold ${
                                                                pag.tipo === "Vale"
                                                                    ? "bg-purple-50 text-purple-700 border-purple-250/20"
                                                                    : "bg-blue-50 text-blue-700 border-blue-250/20"
                                                            }`}
                                                        >
                                                            {pag.tipo}
                                                        </Badge>
                                                    </td>
                                                    <td className="py-2.5 px-2 text-right font-bold text-gray-700 dark:text-gray-300">
                                                        R$ {pag.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="py-2.5 px-2 text-center">
                                                        <Badge 
                                                            style={
                                                                pag.pago
                                                                    ? { backgroundColor: '#D1FAE5', color: '#065F46' }
                                                                    : { backgroundColor: '#FEF3C7', color: '#92400E' }
                                                            }
                                                            className="text-[10px]"
                                                        >
                                                            {pag.pago ? "Pago" : "Pendente"}
                                                        </Badge>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex justify-end pt-2 border-t border-gray-100 dark:border-neutral-800">
                                    <Button
                                        onClick={pagarSelecionados}
                                        disabled={selecionados.length === 0 || pagandoEmMassa}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5"
                                    >
                                        {pagandoEmMassa ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Processando...
                                            </>
                                        ) : (
                                            <>
                                                <Check className="w-4 h-4" />
                                                Confirmar Pagamento de {selecionados.length} Selecionados
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Payroll List */}
            <Card className="border-0 shadow-lg">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2" style={{ color: '#07593f' }}>
                        <DollarSign className="w-5 h-5" />
                        Folha de Pagamento - {MESES[mesReferencia - 1]} {anoReferencia}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#07593f' }} />
                        </div>
                    ) : folhasPeriodo.length === 0 ? (
                        <div className="text-center py-12">
                            <DollarSign className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                            <p className="text-gray-500 mb-4">Nenhuma folha gerada para este período</p>
                            <Button
                                onClick={() => setModalGerar(true)}
                                style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
                            >
                                <Calculator className="w-4 h-4 mr-2" />
                                Gerar Folha do Mês
                            </Button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b" style={{ borderColor: '#E5E0D8' }}>
                                        <th className="text-left py-3 px-2 text-sm font-medium text-gray-500">Colaborador</th>
                                        <th className="text-right py-3 px-2 text-sm font-medium text-gray-500">Bruto</th>
                                        <th className="text-right py-3 px-2 text-sm font-medium text-gray-500">INSS</th>
                                        <th className="text-right py-3 px-2 text-sm font-medium text-gray-500">Desc. VT</th>
                                        <th className="text-right py-3 px-2 text-sm font-medium text-gray-500">FGTS</th>
                                        <th className="text-right py-3 px-2 text-sm font-medium text-gray-500">Líquido</th>
                                        <th className="text-center py-3 px-2 text-sm font-medium text-gray-500">Status</th>
                                        <th className="text-center py-3 px-2 text-sm font-medium text-gray-500">Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {folhasPeriodo.map(folha => (
                                        <tr key={folha.id} className="border-b hover:bg-gray-50" style={{ borderColor: '#E5E0D8' }}>
                                            <td className="py-3 px-2">
                                                <p className="font-medium" style={{ color: '#07593f' }}>{folha.colaborador_nome}</p>
                                            </td>
                                            <td className="text-right py-3 px-2">
                                                R$ {Number(folha.salario_bruto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td className="text-right py-3 px-2 text-red-600">
                                                - R$ {Number(folha.inss).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td className="text-right py-3 px-2 text-red-600">
                                                {Number(folha.vale_transporte) > 0 ? `- R$ ${Number(folha.vale_transporte).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                                            </td>
                                            <td className="text-right py-3 px-2 text-orange-600">
                                                R$ {Number(folha.fgts).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td className="text-right py-3 px-2 font-bold" style={{ color: '#07593f' }}>
                                                R$ {Number(folha.salario_liquido).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td className="text-center py-3 px-2">
                                                <Badge style={getStatusBadgeStyle(folha.status)}>{folha.status}</Badge>
                                            </td>
                                            <td className="text-center py-3 px-2">
                                                <div className="flex justify-center gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        onClick={() => { setFolhaSelecionada(folha); setModalDetalhes(true); }}
                                                    >
                                                        <Eye className="w-3 h-3" />
                                                    </Button>
                                                    {folha.status === 'Gerado' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-green-600"
                                                            onClick={() => marcarComoPago(folha)}
                                                        >
                                                            <Check className="w-3 h-3" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="font-bold" style={{ backgroundColor: '#f0f9ff' }}>
                                        <td className="py-3 px-2">TOTAL</td>
                                        <td className="text-right py-3 px-2">
                                            R$ {totalBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="text-right py-3 px-2 text-red-600">
                                            - R$ {totalInss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="text-right py-3 px-2 text-red-600">
                                            {totalVT > 0 ? `- R$ ${totalVT.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                                        </td>
                                        <td className="text-right py-3 px-2 text-orange-600">
                                            R$ {totalFgts.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="text-right py-3 px-2" style={{ color: '#07593f' }}>
                                            R$ {totalLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td></td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Generate Modal */}
            <Dialog open={modalGerar} onOpenChange={setModalGerar}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2" style={{ color: '#07593f' }}>
                            <Calculator className="w-5 h-5" />
                            Gerar Folha de Pagamento
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 mt-4">
                        <div className="p-4 rounded-lg" style={{ backgroundColor: '#f0f9ff' }}>
                            <p className="text-sm text-gray-600 mb-2">
                                <strong>Período:</strong> {MESES[mesReferencia - 1]} de {anoReferencia}
                            </p>
                            <p className="text-sm text-gray-600">
                                <strong>Colaboradores ativos com salário:</strong> {colaboradoresAtivos.length}
                            </p>
                        </div>

                        <div className="p-4 rounded-lg border" style={{ borderColor: '#E5E0D8' }}>
                            <p className="text-sm text-gray-600 mb-2">
                                A folha será gerada automaticamente com:
                            </p>
                            <ul className="text-sm text-gray-500 space-y-1">
                                <li>• Salário bruto = Base + Adicionais CLT ativos</li>
                                <li>• INSS progressivo (tabela 2025 com faixas reais)</li>
                                <li>• IRRF automático (com dedução por dependentes)</li>
                                <li>• FGTS (8%) — encargo da empresa</li>
                                <li>• Desconto VT = menor entre 6% do salário e valor do VT</li>
                                <li>• Adicionais: Noturno, Insalubridade, Periculosidade</li>
                                <li>• Salário Família (quando aplicável)</li>
                                <li>• Líquido = Bruto - INSS - IRRF - VT + Sal. Família</li>
                            </ul>
                        </div>

                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                            <p className="text-sm text-amber-800">
                                <strong>Motor CLT 2025:</strong> Os cálculos seguem as tabelas oficiais de INSS e IRRF de 2025.
                                Para ajustes manuais, edite cada folha individualmente.
                            </p>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <Button variant="outline" onClick={() => setModalGerar(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={gerarFolhaMes}
                            disabled={gerando || colaboradoresAtivos.length === 0}
                            style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
                        >
                            {gerando ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Gerando...
                                </>
                            ) : (
                                <>
                                    <Calculator className="w-4 h-4 mr-2" />
                                    Gerar Folha
                                </>
                            )}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Details Modal */}
            {modalDetalhes && folhaSelecionada && (
                <FolhaDetalhesModal
                    folha={folhaSelecionada}
                    onClose={() => { setModalDetalhes(false); setFolhaSelecionada(null); }}
                />
            )}
            {/* Confirmation Modal for Payment */}
            <AlertDialog open={modalConfirmarPagamento} onOpenChange={setModalConfirmarPagamento}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar Pagamento</AlertDialogTitle>
                        <AlertDialogDescription>
                            Deseja marcar a folha de <strong>{folhaParaPagar?.colaborador_nome}</strong> como paga?
                            <br /><br />
                            <div className="flex items-center space-x-2 bg-gray-50 p-3 rounded-md border border-gray-200">
                                <input
                                    type="checkbox"
                                    id="gerarLancamento"
                                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600"
                                    checked={gerarLancamentoFinanceiro}
                                    onChange={(e) => setGerarLancamentoFinanceiro(e.target.checked)}
                                />
                                <label
                                    htmlFor="gerarLancamento"
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-700"
                                >
                                    Gerar no Financeiro: Salário + INSS + FGTS automaticamente
                                </label>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                Valor: R$ {Number(folhaParaPagar?.salario_liquido).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmarPagamento}
                            className="bg-green-600 hover:bg-green-700"
                        >
                            Confirmar Pagamento
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

// Details Modal
function FolhaDetalhesModal({ folha, onClose }) {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    const parseDescontosAdicionais = (val) => {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        try {
            if (typeof val === 'string') {
                return JSON.parse(val);
            }
        } catch (e) {
            console.error("Error parsing descontos_adicionais:", e);
        }
        return [];
    };

    const [formData, setFormData] = useState({
        ...folha,
        desconto_plano_saude: Number(folha.desconto_plano_saude) || 0,
        desconto_adiantamento: Number(folha.desconto_adiantamento) || 0,
        pensao_alimenticia: Number(folha.pensao_alimenticia) || 0,
        descontos_adicionais: parseDescontosAdicionais(folha.descontos_adicionais),
    });

    const handleSave = async () => {
        setSaving(true);
        try {
            const salarioBruto = Number(formData.salario_bruto) || 0;
            const inss = Number(formData.inss) || 0;
            const irrf = Number(formData.irrf) || 0;
            const descontoVT = Number(formData.vale_transporte) || 0;
            const descontoPlanoSaude = Number(formData.desconto_plano_saude) || 0;
            const descontoAdiantamento = Number(formData.desconto_adiantamento) || 0;
            const pensaoAlimenticia = Number(formData.pensao_alimenticia) || 0;
            const outrosDescontos = Number(formData.outros_descontos) || 0;
            const salarioFamilia = Number(formData.salario_familia) || 0;

            const descontosAdicionaisList = Array.isArray(formData.descontos_adicionais)
                ? formData.descontos_adicionais
                : [];
            const somaDescontosAdicionais = descontosAdicionaisList.reduce((sum, item) => sum + (Number(item.valor) || 0), 0);

            const totalDescontos = inss + irrf + descontoVT + descontoPlanoSaude + descontoAdiantamento + pensaoAlimenticia + outrosDescontos + somaDescontosAdicionais;
            const salarioLiquido = salarioBruto - totalDescontos + salarioFamilia;

            try {
                await base44.entities.FolhaPagamento.update(folha.id, {
                    ...formData,
                    salario_bruto: salarioBruto,
                    inss: inss,
                    irrf: irrf,
                    fgts: Number(formData.fgts) || 0,
                    vale_transporte: descontoVT,
                    desconto_plano_saude: descontoPlanoSaude,
                    desconto_adiantamento: descontoAdiantamento,
                    pensao_alimenticia: pensaoAlimenticia,
                    outros_descontos: outrosDescontos,
                    descontos_adicionais: descontosAdicionaisList,
                    salario_familia: salarioFamilia,
                    salario_liquido: salarioLiquido,
                });
            } catch (err) {
                if (err.code === '42703' || String(err.message).includes('column') || String(err.message).includes('does not exist')) {
                    // Fallback se as novas colunas não existirem na tabela
                    const totalOutrosDescontos = outrosDescontos + descontoPlanoSaude + descontoAdiantamento + pensaoAlimenticia + somaDescontosAdicionais;
                    
                    let obsDetalhes = "";
                    if (descontoPlanoSaude > 0) obsDetalhes += `Plano Saúde: R$ ${descontoPlanoSaude.toFixed(2)}; `;
                    if (descontoAdiantamento > 0) obsDetalhes += `Adiantamento: R$ ${descontoAdiantamento.toFixed(2)}; `;
                    if (pensaoAlimenticia > 0) obsDetalhes += `Pensão: R$ ${pensaoAlimenticia.toFixed(2)}; `;
                    descontosAdicionaisList.forEach(d => {
                        if (d.valor > 0) obsDetalhes += `${d.descricao || 'Desconto'}: R$ ${d.valor.toFixed(2)}; `;
                    });

                    const novaObservacao = formData.observacoes 
                        ? `${formData.observacoes}\n[Detalhamento de Descontos: ${obsDetalhes}]`
                        : `[Detalhamento de Descontos: ${obsDetalhes}]`;

                    const dataToSave = { ...formData };
                    delete dataToSave.desconto_plano_saude;
                    delete dataToSave.desconto_adiantamento;
                    delete dataToSave.pensao_alimenticia;
                    delete dataToSave.descontos_adicionais;

                    await base44.entities.FolhaPagamento.update(folha.id, {
                        ...dataToSave,
                        salario_bruto: salarioBruto,
                        inss: inss,
                        irrf: irrf,
                        fgts: Number(formData.fgts) || 0,
                        vale_transporte: descontoVT,
                        outros_descontos: totalOutrosDescontos,
                        salario_familia: salarioFamilia,
                        salario_liquido: salarioLiquido,
                        observacoes: novaObservacao,
                    });
                } else {
                    throw err;
                }
            }
            queryClient.invalidateQueries(['folhas_pagamento']);
            toast.success("Folha atualizada!");
            setEditing(false);
        } catch (error) {
            toast.error("Erro: " + error.message);
        } finally {
            setSaving(false);
        }
    };

    const handleAddDescontoAdicional = () => {
        setFormData(prev => ({
            ...prev,
            descontos_adicionais: [
                ...(prev.descontos_adicionais || []),
                { descricao: "", valor: 0 }
            ]
        }));
    };

    const handleRemoveDescontoAdicional = (index) => {
        setFormData(prev => ({
            ...prev,
            descontos_adicionais: prev.descontos_adicionais.filter((_, i) => i !== index)
        }));
    };

    const handleChangeDescontoAdicional = (index, field, value) => {
        setFormData(prev => {
            const newList = [...(prev.descontos_adicionais || [])];
            newList[index] = {
                ...newList[index],
                [field]: field === "valor" ? Number(value) || 0 : value
            };
            return {
                ...prev,
                descontos_adicionais: newList
            };
        });
    };

    const descontosAdicionaisList = Array.isArray(formData.descontos_adicionais)
        ? formData.descontos_adicionais
        : [];

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2" style={{ color: '#07593f' }}>
                        <DollarSign className="w-5 h-5" />
                        Detalhes do Holerite
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 mt-4">
                    <div className="p-4 rounded-lg" style={{ backgroundColor: '#f0f9ff' }}>
                        <p className="font-bold text-lg" style={{ color: '#07593f' }}>{folha.colaborador_nome}</p>
                        <p className="text-sm text-gray-500">
                            {MESES[(folha.mes_referencia || 1) - 1]} de {folha.ano_referencia}
                        </p>
                    </div>

                    {editing ? (
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>Salário Bruto</Label>
                                    <Input
                                        type="number"
                                        value={formData.salario_bruto}
                                        onChange={(e) => setFormData(prev => ({ ...prev, salario_bruto: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label>Salário Família</Label>
                                    <Input
                                        type="number"
                                        value={formData.salario_familia}
                                        onChange={(e) => setFormData(prev => ({ ...prev, salario_familia: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>INSS (Desconto)</Label>
                                    <Input
                                        type="number"
                                        value={formData.inss}
                                        onChange={(e) => setFormData(prev => ({ ...prev, inss: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label>IRRF (Desconto)</Label>
                                    <Input
                                        type="number"
                                        value={formData.irrf}
                                        onChange={(e) => setFormData(prev => ({ ...prev, irrf: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>FGTS (A Recolher)</Label>
                                    <Input
                                        type="number"
                                        value={formData.fgts}
                                        onChange={(e) => setFormData(prev => ({ ...prev, fgts: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label>Vale Transporte (Desconto)</Label>
                                    <Input
                                        type="number"
                                        value={formData.vale_transporte}
                                        onChange={(e) => setFormData(prev => ({ ...prev, vale_transporte: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>Plano de Saúde (Desconto)</Label>
                                    <Input
                                        type="number"
                                        value={formData.desconto_plano_saude}
                                        onChange={(e) => setFormData(prev => ({ ...prev, desconto_plano_saude: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label>Adiantamento/Vale (Desconto)</Label>
                                    <Input
                                        type="number"
                                        value={formData.desconto_adiantamento}
                                        onChange={(e) => setFormData(prev => ({ ...prev, desconto_adiantamento: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>Pensão Alimentícia (Desconto)</Label>
                                    <Input
                                        type="number"
                                        value={formData.pensao_alimenticia}
                                        onChange={(e) => setFormData(prev => ({ ...prev, pensao_alimenticia: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label>Outros Descontos (Geral)</Label>
                                    <Input
                                        type="number"
                                        value={formData.outros_descontos}
                                        onChange={(e) => setFormData(prev => ({ ...prev, outros_descontos: e.target.value }))}
                                    />
                                </div>
                            </div>

                            {/* Seção de Descontos Adicionais */}
                            <div className="border rounded-lg p-3 space-y-2 bg-gray-50/50 dark:bg-neutral-850/50">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Múltiplos Descontos Adicionais
                                    </span>
                                    <Button 
                                        type="button" 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={handleAddDescontoAdicional}
                                        className="h-8 text-xs flex items-center gap-1"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Adicionar
                                    </Button>
                                </div>

                                {descontosAdicionaisList.length === 0 ? (
                                    <p className="text-xs text-gray-400 text-center py-2">
                                        Nenhum desconto adicional customizado.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {descontosAdicionaisList.map((item, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                                <Input
                                                    type="text"
                                                    placeholder="Descrição (ex: Quebra de Caixa)"
                                                    value={item.descricao}
                                                    onChange={(e) => handleChangeDescontoAdicional(index, "descricao", e.target.value)}
                                                    className="flex-1 text-sm h-9"
                                                />
                                                <Input
                                                    type="number"
                                                    placeholder="Valor (R$)"
                                                    value={item.valor}
                                                    onChange={(e) => handleChangeDescontoAdicional(index, "valor", e.target.value)}
                                                    className="w-24 text-sm h-9"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleRemoveDescontoAdicional(index)}
                                                    className="h-9 w-9 text-red-500 hover:text-red-750 hover:bg-red-50"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <Label>Observações</Label>
                                <Textarea
                                    value={formData.observacoes || ""}
                                    onChange={(e) => setFormData(prev => ({ ...prev, observacoes: e.target.value }))}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                            <div className="flex justify-between py-2 border-b" style={{ borderColor: '#E5E0D8' }}>
                                <span className="text-gray-600">Salário Bruto</span>
                                <span className="font-medium">R$ {Number(formData.salario_bruto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            </div>
                            {Number(formData.adicional_noturno) > 0 && (
                                <div className="flex justify-between py-2 border-b text-indigo-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>(+) Adic. Noturno</span>
                                    <span>Incluso no bruto: R$ {Number(formData.adicional_noturno).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {Number(formData.insalubridade) > 0 && (
                                <div className="flex justify-between py-2 border-b text-amber-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>(+) Insalubridade</span>
                                    <span>Incluso no bruto: R$ {Number(formData.insalubridade).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {Number(formData.periculosidade) > 0 && (
                                <div className="flex justify-between py-2 border-b text-red-500" style={{ borderColor: '#E5E0D8' }}>
                                    <span>(+) Periculosidade</span>
                                    <span>Incluso no bruto: R$ {Number(formData.periculosidade).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            <div className="flex justify-between py-2 border-b text-red-600" style={{ borderColor: '#E5E0D8' }}>
                                <span>INSS</span>
                                <span>- R$ {Number(formData.inss).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            </div>
                            {Number(formData.irrf) > 0 && (
                                <div className="flex justify-between py-2 border-b text-red-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>IRRF</span>
                                    <span>- R$ {Number(formData.irrf).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {Number(formData.vale_transporte) > 0 && (
                                <div className="flex justify-between py-2 border-b text-red-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>Desc. Vale Transporte</span>
                                    <span>- R$ {Number(formData.vale_transporte).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {Number(formData.desconto_plano_saude) > 0 && (
                                <div className="flex justify-between py-2 border-b text-red-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>Plano de Saúde</span>
                                    <span>- R$ {Number(formData.desconto_plano_saude).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {Number(formData.desconto_adiantamento) > 0 && (
                                <div className="flex justify-between py-2 border-b text-red-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>Adiantamento / Vale</span>
                                    <span>- R$ {Number(formData.desconto_adiantamento).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {Number(formData.pensao_alimenticia) > 0 && (
                                <div className="flex justify-between py-2 border-b text-red-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>Pensão Alimentícia</span>
                                    <span>- R$ {Number(formData.pensao_alimenticia).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {Number(formData.outros_descontos) > 0 && (
                                <div className="flex justify-between py-2 border-b text-red-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>Outros Descontos (Geral)</span>
                                    <span>- R$ {Number(formData.outros_descontos).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {descontosAdicionaisList.map((item, idx) => (
                                <div key={idx} className="flex justify-between py-2 border-b text-red-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>{item.descricao || "Desconto Adicional"}</span>
                                    <span>- R$ {Number(item.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            ))}
                            {Number(formData.salario_familia) > 0 && (
                                <div className="flex justify-between py-2 border-b text-green-600" style={{ borderColor: '#E5E0D8' }}>
                                    <span>(+) Salário Família</span>
                                    <span>+ R$ {Number(formData.salario_familia).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            <div className="flex justify-between py-2 border-b text-orange-600" style={{ borderColor: '#E5E0D8' }}>
                                <span>FGTS (a recolher)</span>
                                <span>R$ {Number(formData.fgts).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between py-3 font-bold text-lg" style={{ color: '#07593f' }}>
                                <span>Salário Líquido</span>
                                <span>R$ {Number(formData.salario_liquido).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between py-2">
                                <span className="text-gray-600">Status</span>
                                <Badge style={formData.status === 'Pago' ? { backgroundColor: '#D1FAE5', color: '#065F46' } : { backgroundColor: '#FEF3C7', color: '#92400E' }}>
                                    {formData.status}
                                </Badge>
                            </div>
                            {formData.data_pagamento && (
                                <div className="flex justify-between py-2">
                                    <span className="text-gray-600">Data Pagamento</span>
                                    <span>{new Date(formData.data_pagamento).toLocaleDateString('pt-BR')}</span>
                                </div>
                            )}
                            {formData.observacoes && (
                                <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 border border-gray-250/20">
                                    <span className="font-semibold block mb-1">Observações:</span>
                                    {formData.observacoes}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    {editing ? (
                        <>
                            <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
                            <Button onClick={handleSave} disabled={saving} style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}>
                                {saving ? "Salvando..." : "Salvar"}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={onClose}>Fechar</Button>
                            <Button variant="outline" onClick={() => setEditing(true)}>
                                Editar
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
