
import React, { useState, useEffect } from "react";
import { base44, supabase } from "@/lib/supabase";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, Users, FileDown, AlertCircle, Calendar, Banknote, RefreshCcw, Lock, CheckCircle2, Target, BarChart3 } from "lucide-react";
import { ModalNiveisComissao } from "@/components/comissoes/ModalNiveisComissao";
import { calcularVendasLiquidas, calcularComissaoTiered } from "@/services/comissaoTiersService";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";

export default function RelatorioComissoes() {
  const { organization, settings } = useTenant();
  const [user, setUser] = useState(null);
  const [vendedorFiltro, setVendedorFiltro] = useState("todos");
  const [mesInicio, setMesInicio] = useState(new Date().toISOString().slice(0, 7));
  const [mesFim, setMesFim] = useState(new Date().toISOString().slice(0, 7));

  // States for payment modal
  const [modalPagamento, setModalPagamento] = useState(false);
  const [pagamentoSelecionado, setPagamentoSelecionado] = useState(null);
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().slice(0, 10));
  const [processandoPagamento, setProcessandoPagamento] = useState(false);
  const [observacaoPagamento, setObservacaoPagamento] = useState("");
  const [processandoFechamento, setProcessandoFechamento] = useState(false);
  const [modalNiveisVendedor, setModalNiveisVendedor] = useState(null);
  const queryClient = useQueryClient();

  const tenantId = organization?.id || "00000000-0000-0000-0000-000000000001";

  useEffect(() => {
    const loadUser = async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    };
    loadUser();
  }, []);

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ['vendas'],
    queryFn: () => base44.entities.Venda.list('-data_venda'),
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list(),
  });

  const { data: assistencias = [] } = useQuery({
    queryKey: ['assistencias-comissoes'],
    queryFn: () => base44.entities.AssistenciaTecnica.list(),
  });

  const { data: fechamentos = [] } = useQuery({
    queryKey: ['comissoes-fechamento', mesInicio, mesFim, tenantId],
    queryFn: () => base44.entities.ComissaoFechamentoMensal.list('-created_at'),
  });

  const { data: configTaxas = [] } = useQuery({
    queryKey: ['configuracao_taxas'],
    queryFn: () => base44.entities.ConfiguracaoTaxa.list(),
  });

  const { data: niveisComissao = [] } = useQuery({
    queryKey: ['niveis-comissao'],
    queryFn: () => base44.entities.NivelComissao.list(),
  });

  const { data: niveisComissaoFaixas = [] } = useQuery({
    queryKey: ['niveis-comissao-faixas'],
    queryFn: () => base44.entities.NivelComissaoFaixa.list(),
  });

  const { data: metas = [] } = useQuery({
    queryKey: ['metas-comissoes', organization?.id, mesInicio, mesFim],
    enabled: !!organization?.id && user?.cargo === 'Administrador',
    queryFn: async () => {
      const { data, error } = await supabase.from('metas_vendas').select('mes, loja, vendedor_id, meta_valor')
        .eq('organization_id', organization.id).gte('mes', mesInicio + '-01').lte('mes', mesFim + '-01').limit(1000);
      if (error) throw error;
      return data;
    },
  });

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: '#07593f' }} />
      </div>
    );
  }

  // Sistema simplificado - usa APENAS cargo
  const isAdmin = user.cargo === 'Administrador';

  if (!isAdmin) {
    return (
      <div className="p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <Card className="border-2 border-red-200 bg-red-50">
            <CardContent className="p-8 text-center">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-600" />
              <h2 className="text-2xl font-bold mb-2 text-red-800">
                Acesso Restrito
              </h2>
              <p className="text-red-600">
                Apenas administradores podem acessar o relatório de comissões.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Filtrar vendas por período e vendedor
  const getVendedorRef = (venda) => venda.vendedor_id || venda.responsavel_id || venda.responsavel_nome || "sem-vendedor";

  const vendasFiltradas = vendas.filter(v => {
    const dataVenda = v.data_venda?.slice(0, 7); // YYYY-MM
    const dentroPeríodo = dataVenda >= mesInicio && dataVenda <= mesFim;
    const vendedorMatch = vendedorFiltro === "todos" || getVendedorRef(v) === vendedorFiltro;
    return dentroPeríodo && vendedorMatch && v.comissao_calculada > 0;
  });

  // Calcular breakdown por forma de pagamento para todas as vendas filtradas
  const calcularBreakdownPorFormaPagamento = (vendasArr) => {
    const breakdown = {};

    vendasArr.forEach(venda => {
      if (venda.pagamentos && Array.isArray(venda.pagamentos)) {
        venda.pagamentos.forEach(pag => {
          const forma = pag.forma_pagamento;
          if (!breakdown[forma]) {
            breakdown[forma] = { valor: 0, quantidade: 0 };
          }
          breakdown[forma].valor += pag.valor || 0;
          breakdown[forma].quantidade += 1;
        });
      }
    });

    return breakdown;
  };



  // Agrupar por vendedor (com fallback para responsavel_id em vendas antigas)
  const gruposPorVendedor = vendasFiltradas.reduce((acc, venda) => {
    const ref = getVendedorRef(venda);
    if (!acc[ref]) {
      const vendedorCadastrado = vendedores.find((ven) => ven.id === ref);
      acc[ref] = {
        vendedor: vendedorCadastrado || {
          id: ref,
          nome: venda.responsavel_nome || "Sem vendedor",
          loja: venda.loja || "-",
          meta_mensal: 0,
        },
        vendas: [],
      };
    }

    acc[ref].vendas.push(venda);
    return acc;
  }, {});

  const faturamentosLoja = {};
  Object.values(gruposPorVendedor).forEach((grupo) => {
    const loja = grupo.vendedor.loja || "-";
    const vendasVendedor = grupo.vendas;
    const totalVendasVendedor = vendasVendedor.reduce((sum, v) => {
      const assistencia = assistencias.find(a => a.numero_pedido === v.numero_pedido && a.status === 'Concluída');
      return sum + ((v.valor_total || 0) - (assistencia?.valor_devolvido || 0));
    }, 0);
    faturamentosLoja[loja] = (faturamentosLoja[loja] || 0) + totalVendasVendedor;
  });

  const comissoesPorVendedor = Object.values(gruposPorVendedor).map((grupo) => {
    const vendasVendedor = grupo.vendas;

    // Calcular comissão subtraindo devoluções
    const totalComissao = vendasVendedor.reduce((sum, v) => {
      const assistencia = assistencias.find(a =>
        a.numero_pedido === v.numero_pedido &&
        a.status === 'Concluída' &&
        (a.tipo === 'Devolução' || a.tipo === 'Troca')
      );

      const valorBaseComissao = Math.max(0, (v.valor_total || 0) - (assistencia?.valor_devolvido || 0));
      const porcentagem = v.comissao_calculada / (v.valor_total || 1);
      const comissaoAjustada = valorBaseComissao * porcentagem;

      return sum + comissaoAjustada;
    }, 0);

    const totalVendas = vendasVendedor.reduce((sum, v) => {
      const assistencia = assistencias.find(a => a.numero_pedido === v.numero_pedido && a.status === 'Concluída');
      return sum + ((v.valor_total || 0) - (assistencia?.valor_devolvido || 0));
    }, 0);

    const quantidadeVendas = vendasVendedor.length;
    const breakdownPagamentos = calcularBreakdownPorFormaPagamento(vendasVendedor);
    const vendasLiquidas = calcularVendasLiquidas(vendasVendedor, configTaxas);
    
    const nivelConfig = niveisComissao.find((n) => n.vendedor_id === grupo.vendedor.id && n.ativo !== false);
    const faixasNivel = nivelConfig ? niveisComissaoFaixas.filter((f) => f.nivel_comissao_id === nivelConfig.id) : [];
    const metaVendedor = nivelConfig?.meta_mensal || grupo.vendedor.meta_mensal || 0;

    // Configurações do modelo
    const faixaRef = settings?.comissao_faixa_referencia || 'vendedor';
    const pisoLoja = Number(settings?.comissao_meta_minima_loja_percentual || 0);

    const lojaVendedor = grupo.vendedor.loja || "-";
    const faturamentoLoja = faturamentosLoja[lojaVendedor] || 0;

    // Buscar meta da loja
    const metaLojaObj = metas.find(m => m.mes === `${mesInicio}-01` && m.loja === lojaVendedor && !m.vendedor_id);
    const metaLoja = metaLojaObj?.meta_valor || 0;

    const percentualMetaVendedor = metaVendedor > 0 ? (totalVendas / metaVendedor) * 100 : 0;
    const percentualMetaLoja = metaLoja > 0 ? (faturamentoLoja / metaLoja) * 100 : 0;

    let overridePercentual = undefined;
    let pisoLojaAtingido = true;

    if (faixaRef === 'loja') {
      overridePercentual = percentualMetaLoja;
    } else if (faixaRef === 'ambos') {
      overridePercentual = percentualMetaVendedor;
      if (percentualMetaLoja < pisoLoja) {
        pisoLojaAtingido = false;
      }
    }

    const comissaoTiered = nivelConfig && faixasNivel.length > 0 && (faixaRef !== 'ambos' || pisoLojaAtingido)
      ? calcularComissaoTiered({
          vendasBrutas: totalVendas,
          vendasLiquidas,
          meta: metaVendedor,
          faixas: faixasNivel,
          percentualMetaOverride: overridePercentual
        })
      : null;

    return {
      vendedor: grupo.vendedor,
      totalComissao,
      totalVendas,
      quantidadeVendas,
      breakdownPagamentos,
      vendasLiquidas,
      comissaoTiered,
      meta: metaVendedor,
      metaLoja,
      faturamentoLoja,
      percentualMetaLoja,
      pisoLojaAtingido,
      pisoLoja,
      faixaRef,
      vendas: vendasVendedor
    };
  }).filter(item => item.quantidadeVendas > 0);

  const getPeriodoInicioDate = () => new Date(`${mesInicio}-01T00:00:00`);

  const getPeriodoFimDate = () => {
    const [ano, mes] = mesFim.split('-').map(Number);
    return new Date(ano, mes, 0, 23, 59, 59, 999);
  };

  const periodoInicioDate = getPeriodoInicioDate();
  const periodoFimDate = getPeriodoFimDate();
  const periodoInicioIso = periodoInicioDate.toISOString().slice(0, 10);
  const periodoFimIso = periodoFimDate.toISOString().slice(0, 10);

  const fechamentosPeriodo = (fechamentos || []).filter((f) => {
    const inicio = (f.periodo_inicio || '').slice(0, 10);
    const fim = (f.periodo_fim || '').slice(0, 10);
    const vendedorMatch = vendedorFiltro === 'todos' || f.vendedor_id === vendedorFiltro;
    return (
      f.organization_id === tenantId &&
      inicio === periodoInicioIso &&
      fim === periodoFimIso &&
      vendedorMatch
    );
  });

  const mapFechamentoPorVendedor = new Map(
    fechamentosPeriodo.map((f) => [f.vendedor_id || `sem-vendedor-${f.id}`, f])
  );

  const comissoesConsolidadas = comissoesPorVendedor.map((item) => {
    const fechamento = mapFechamentoPorVendedor.get(item.vendedor.id);
    const modelo = settings?.comissao_modelo_calculo || 'regra_venda';

    let totalComissaoFinal = item.totalComissao;
    if (modelo === 'faixas_meta') {
      if (item.comissaoTiered && item.comissaoTiered.valorComissao > 0) {
        totalComissaoFinal = item.comissaoTiered.valorComissao;
      } else if (item.comissaoTiered && !item.pisoLojaAtingido) {
        totalComissaoFinal = item.totalComissao; // fallback se piso não atingido
      } else {
        totalComissaoFinal = 0; // se atingiu o piso mas faturamento abaixo do primeiro tier
      }
    }

    if (!fechamento) {
      return {
        ...item,
        fechamento_id: null,
        status_fechamento: 'Nao Fechado',
        totalFinal: totalComissaoFinal,
      };
    }

    return {
      ...item,
      fechamento_id: fechamento.id,
      status_fechamento: fechamento.status || 'Pendente',
      totalFinal: Number(fechamento.total_final || fechamento.total_comissao || totalComissaoFinal),
      fechamento,
    };
  });

  const totalGeralComissoes = comissoesConsolidadas.reduce((sum, item) => sum + item.totalFinal, 0);
  const totalGeralVendas = comissoesConsolidadas.reduce((sum, item) => sum + item.totalVendas, 0);

  const totalPendente = comissoesConsolidadas
    .filter((item) => item.status_fechamento !== 'Pago')
    .reduce((sum, item) => sum + Number(item.totalFinal || 0), 0);

  const aplicarPoliticaFechamento = (existente, politica) => {
    if (!existente) {
      return 'criar';
    }

    if (politica === 'recalcular_tudo') {
      return 'recriar';
    }

    if (politica === 'recalcular_periodo_aberto') {
      return existente.status === 'Pago' ? 'manter' : 'recriar';
    }

    return 'manter';
  };

  const gerarFechamentoPeriodo = async () => {
    setProcessandoFechamento(true);
    const politica = settings?.comissao_recalculo_politica || 'nao_recalcular';
    const modelo = settings?.comissao_modelo_calculo || 'regra_venda';

    try {
      const existentesPorVendedor = new Map(
        fechamentosPeriodo.map((item) => [item.vendedor_id || `sem-vendedor-${item.id}`, item])
      );

      let criados = 0;
      let atualizados = 0;
      let mantidos = 0;

      for (const item of comissoesPorVendedor) {
        const existente = existentesPorVendedor.get(item.vendedor.id);
        const acao = aplicarPoliticaFechamento(existente, politica);

        if (acao === 'manter') {
          mantidos += 1;
          continue;
        }

        let totalComissaoFinal = item.totalComissao;
        if (modelo === 'faixas_meta') {
          if (item.comissaoTiered && item.comissaoTiered.valorComissao > 0) {
            totalComissaoFinal = item.comissaoTiered.valorComissao;
          } else if (item.comissaoTiered && !item.pisoLojaAtingido) {
            totalComissaoFinal = item.totalComissao; // fallback
          } else {
            totalComissaoFinal = 0;
          }
        }

        if (acao === 'recriar' && existente) {
          await base44.entities.ComissaoFechamentoMensal.update(existente.id, {
            quantidade_vendas: item.quantidadeVendas,
            valor_total_vendas: Number(item.totalVendas.toFixed(2)),
            total_comissao: Number(totalComissaoFinal.toFixed(2)),
            total_final: Number(totalComissaoFinal.toFixed(2)),
            total_ajustes: Number(existente.total_ajustes || 0),
            valor_vendas_liquidas: Number(item.vendasLiquidas.toFixed(2)),
            percentual_meta_atingido: item.comissaoTiered ? Number(item.comissaoTiered.percentualMeta.toFixed(1)) : null,
            faixa_comissao_aplicada: item.comissaoTiered?.faixaAplicada ? `>=${item.comissaoTiered.faixaAplicada.percentual_meta_min}%` : null,
            percentual_comissao_aplicado: item.comissaoTiered?.percentualComissao ?? null,
            breakdown_pagamentos: item.breakdownPagamentos,
            status: existente.status || 'Pendente',
            observacoes: existente.observacoes || `Fechamento atualizado automaticamente (${politica})`,
            updated_at: new Date().toISOString(),
          });
          atualizados += 1;
          continue;
        }

        await base44.entities.ComissaoFechamentoMensal.create({
          organization_id: tenantId,
          periodo_inicio: periodoInicioIso,
          periodo_fim: periodoFimIso,
          vendedor_id: item.vendedor.id,
          loja: item.vendedor.loja || null,
          quantidade_vendas: item.quantidadeVendas,
          valor_total_vendas: Number(item.totalVendas.toFixed(2)),
          total_comissao: Number(totalComissaoFinal.toFixed(2)),
          total_ajustes: 0,
          total_final: Number(totalComissaoFinal.toFixed(2)),
          valor_vendas_liquidas: Number(item.vendasLiquidas.toFixed(2)),
          percentual_meta_atingido: item.comissaoTiered ? Number(item.comissaoTiered.percentualMeta.toFixed(1)) : null,
          faixa_comissao_aplicada: item.comissaoTiered?.faixaAplicada ? `>=${item.comissaoTiered.faixaAplicada.percentual_meta_min}%` : null,
          percentual_comissao_aplicado: item.comissaoTiered?.percentualComissao ?? null,
          status: 'Pendente',
          breakdown_pagamentos: item.breakdownPagamentos,
          observacoes: `Fechamento gerado automaticamente em ${new Date().toLocaleDateString('pt-BR')}`,
        });
        criados += 1;
      }

      queryClient.invalidateQueries(['comissoes-fechamento']);
      toast.success(`Fechamento concluído: ${criados} criado(s), ${atualizados} atualizado(s), ${mantidos} mantido(s).`);
    } catch (error) {
      toast.error(`Erro ao gerar fechamento: ${error.message}`);
    } finally {
      setProcessandoFechamento(false);
    }
  };

  const exportarCSV = () => {
    let csv = "Vendedor,Loja,Quantidade de Vendas,Total em Vendas,Total Comissões\n";

    comissoesPorVendedor.forEach(item => {
      csv += `${item.vendedor.nome},${item.vendedor.loja},${item.quantidadeVendas},R$ ${item.totalVendas.toFixed(2)},R$ ${item.totalComissao.toFixed(2)}\n`;
    });

    csv += `\nTOTAL GERAL,,${comissoesPorVendedor.reduce((sum, i) => sum + i.quantidadeVendas, 0)},R$ ${totalGeralVendas.toFixed(2)},R$ ${totalGeralComissoes.toFixed(2)}`;

    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comissoes_${mesInicio}_${mesFim}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const abrirModalPagamento = (item) => {
    if (!item.fechamento_id) {
      toast.error('Feche o período antes de registrar pagamento.');
      return;
    }

    if (item.status_fechamento === 'Pago') {
      toast.info('Esta comissão já está marcada como paga.');
      return;
    }

    setPagamentoSelecionado(item);
    setDataPagamento(new Date().toISOString().slice(0, 10));
    setObservacaoPagamento("");
    setModalPagamento(true);
  };

  const confirmarPagamentoComissao = async () => {
    if (!pagamentoSelecionado) return;

    setProcessandoPagamento(true);
    try {
      await base44.entities.LancamentoFinanceiro.create({
        descricao: `Comissão - ${pagamentoSelecionado.vendedor.nome} - Ref: ${mesInicio === mesFim ? mesInicio : `${mesInicio} a ${mesFim}`}`,
        valor: -Number(pagamentoSelecionado.totalFinal.toFixed(2)),
        tipo: 'despesa',
        categoria_nome: 'Comissões',
        data_lancamento: dataPagamento,
        forma_pagamento: 'Transferência',
        status: 'Pago',
        observacao: `Pgto ref. ${pagamentoSelecionado.quantidadeVendas} vendas. ${observacaoPagamento}`,
      });

      if (pagamentoSelecionado.fechamento_id) {
        await base44.entities.ComissaoFechamentoMensal.update(pagamentoSelecionado.fechamento_id, {
          status: 'Pago',
          data_pagamento: `${dataPagamento}T12:00:00.000Z`,
          observacoes: observacaoPagamento || pagamentoSelecionado.fechamento?.observacoes || null,
          updated_at: new Date().toISOString(),
        });

        const dataInicioHistorico = `${periodoInicioIso}T00:00:00.000Z`;
        const dataFimHistorico = `${periodoFimIso}T23:59:59.999Z`;
        await supabase
          .from('comissoes_historico')
          .update({
            status: 'Pago',
            data_pagamento: `${dataPagamento}T12:00:00.000Z`,
          })
          .eq('organization_id', tenantId)
          .eq('vendedor_id', pagamentoSelecionado.vendedor.id)
          .gte('data_calculo', dataInicioHistorico)
          .lte('data_calculo', dataFimHistorico)
          .neq('status', 'Pago');
      }

      toast.success(`Pagamento registrado para ${pagamentoSelecionado.vendedor.nome}!`);
      setModalPagamento(false);
      setPagamentoSelecionado(null);
      queryClient.invalidateQueries(['comissoes-fechamento']);
      queryClient.invalidateQueries(['lancamentos']);

    } catch (error) {
      toast.error("Erro ao registrar pagamento: " + error.message);
    } finally {
      setProcessandoPagamento(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: '#07593f' }}>
              Relatório de Comissões
            </h1>
            <p style={{ color: '#8B8B8B' }}>
              Análise detalhada por vendedor e período
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={gerarFechamentoPeriodo}
              variant="outline"
              disabled={processandoFechamento || comissoesPorVendedor.length === 0}
            >
              <RefreshCcw className="w-4 h-4 mr-2" />
              {processandoFechamento ? 'Processando...' : 'Gerar Fechamento'}
            </Button>
            <Button
              onClick={exportarCSV}
              className="shadow-lg"
              style={{ background: 'linear-gradient(135deg, #f38a4c 0%, #f5a164 100%)' }}
            >
              <FileDown className="w-4 h-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </div>

        <Card className="border-0 shadow-lg mb-6">
          <CardContent className="p-4 md:p-5">
            <div className="grid md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border" style={{ borderColor: '#E5E0D8' }}>
                <p className="text-xs text-gray-500">Período de fechamento</p>
                <p className="font-semibold" style={{ color: '#07593f' }}>{periodoInicioIso} a {periodoFimIso}</p>
              </div>
              <div className="p-3 rounded-lg border" style={{ borderColor: '#E5E0D8' }}>
                <p className="text-xs text-gray-500">Fechamentos encontrados</p>
                <p className="font-semibold" style={{ color: '#07593f' }}>{fechamentosPeriodo.length}</p>
              </div>
              <div className="p-3 rounded-lg border" style={{ borderColor: '#E5E0D8' }}>
                <p className="text-xs text-gray-500">Pendente para pagamento</p>
                <p className="font-semibold text-amber-600">
                  R$ {totalPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="p-3 rounded-lg border" style={{ borderColor: '#E5E0D8' }}>
                <p className="text-xs text-gray-500">Política de recálculo</p>
                <p className="font-semibold" style={{ color: '#07593f' }}>
                  {settings?.comissao_recalculo_politica || 'nao_recalcular'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg mb-6">
          <CardContent className="p-6">
            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="mesInicio">Período Inicial</Label>
                <Input
                  id="mesInicio"
                  type="month"
                  value={mesInicio}
                  onChange={(e) => setMesInicio(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="mesFim">Período Final</Label>
                <Input
                  id="mesFim"
                  type="month"
                  value={mesFim}
                  onChange={(e) => setMesFim(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="vendedor">Vendedor</Label>
                <Select value={vendedorFiltro} onValueChange={setVendedorFiltro}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os Vendedores</SelectItem>
                    {vendedores.map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.nome} - {v.loja}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium" style={{ color: '#8B8B8B' }}>
                Total em Comissões
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <DollarSign className="w-8 h-8" style={{ color: '#f38a4c' }} />
                <p className="text-2xl font-bold" style={{ color: '#f38a4c' }}>
                  R$ {totalGeralComissoes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium" style={{ color: '#8B8B8B' }}>
                Total em Vendas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-8 h-8" style={{ color: '#07593f' }} />
                <p className="text-2xl font-bold" style={{ color: '#07593f' }}>
                  R$ {totalGeralVendas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium" style={{ color: '#8B8B8B' }}>
                Vendedores Ativos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Users className="w-8 h-8" style={{ color: '#3b82f6' }} />
                <p className="text-2xl font-bold" style={{ color: '#3b82f6' }}>
                  {comissoesPorVendedor.length}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto" style={{ borderColor: '#07593f' }} />
          </div>
        ) : comissoesConsolidadas.length === 0 ? (
          <Card className="border-0 shadow-lg">
            <CardContent className="p-12 text-center">
              <Calendar className="w-16 h-16 mx-auto mb-4 opacity-20" style={{ color: '#07593f' }} />
              <p className="text-xl" style={{ color: '#8B8B8B' }}>
                Nenhuma comissão encontrada no período selecionado
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {comissoesConsolidadas.map((item) => (
              <Card key={item.vendedor.id} className="border-0 shadow-lg">
                <CardHeader style={{ backgroundColor: '#f0f9ff' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
                        style={{ backgroundColor: '#07593f', color: 'white' }}
                      >
                        {item.vendedor.nome.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle style={{ color: '#07593f' }}>
                            {item.vendedor.nome}
                          </CardTitle>
                          <button
                            onClick={() => setModalNiveisVendedor(item.vendedor)}
                            className="text-gray-400 hover:text-green-600 transition-colors"
                            title="Configurar Níveis de Comissão"
                          >
                            <Target className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-sm" style={{ color: '#8B8B8B' }}>
                          Loja {item.vendedor.loja}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-2 mb-1">
                        <Badge
                          className={item.status_fechamento === 'Pago' ? 'bg-green-100 text-green-700' : item.status_fechamento === 'Pendente' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}
                        >
                          {item.status_fechamento === 'Pago' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
                          {item.status_fechamento}
                        </Badge>
                      </div>
                      <p className="text-sm mb-1" style={{ color: '#8B8B8B' }}>Total Comissão</p>
                      <p className="text-2xl font-bold" style={{ color: '#f38a4c' }}>
                        R$ {item.totalFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-8 text-green-700 border-green-200 hover:bg-green-50"
                        disabled={!item.fechamento_id || item.status_fechamento === 'Pago'}
                        onClick={() => abrirModalPagamento(item)}
                      >
                        <Banknote className="w-4 h-4 mr-1" />
                        {!item.fechamento_id ? 'Fechar Período Primeiro' : item.status_fechamento === 'Pago' ? 'Já Pago' : 'Registrar Pagamento'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid md:grid-cols-4 gap-4 mb-4">
                    <div className="text-center p-3 rounded-lg" style={{ backgroundColor: '#FAF8F5' }}>
                      <p className="text-sm mb-1" style={{ color: '#8B8B8B' }}>Quantidade de Vendas</p>
                      <p className="text-xl font-bold" style={{ color: '#07593f' }}>
                        {item.quantidadeVendas}
                      </p>
                    </div>
                    <div className="text-center p-3 rounded-lg" style={{ backgroundColor: '#FAF8F5' }}>
                      <p className="text-sm mb-1" style={{ color: '#8B8B8B' }}>Total em Vendas</p>
                      <p className="text-xl font-bold" style={{ color: '#07593f' }}>
                        R$ {item.totalVendas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-center p-3 rounded-lg" style={{ backgroundColor: '#FFF7ED' }}>
                      <p className="text-sm mb-1" style={{ color: '#8B8B8B' }}>Vendas Líquidas</p>
                      <p className="text-xl font-bold text-orange-600">
                        R$ {item.vendasLiquidas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-center p-3 rounded-lg" style={{ backgroundColor: '#FAF8F5' }}>
                      <p className="text-sm mb-1" style={{ color: '#8B8B8B' }}>Ticket Médio</p>
                      <p className="text-xl font-bold" style={{ color: '#07593f' }}>
                        R$ {(item.totalVendas / item.quantidadeVendas).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Comissão por Faixas */}
                  {settings?.comissao_modelo_calculo === 'faixas_meta' && (
                    <>
                      {/* Caso 1: Piso da loja não atingido */}
                      {!item.pisoLojaAtingido && (
                        <div className="mb-4 p-4 rounded-lg border-2 border-red-200 bg-red-50/50">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="w-4 h-4 text-red-600" />
                              <p className="text-sm font-semibold text-red-800">Piso da Loja Não Atingido</p>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <Badge className="bg-red-100 text-red-700">
                                Loja: {item.percentualMetaLoja.toFixed(1)}% (Piso Mínimo: {item.pisoLoja}%)
                              </Badge>
                              <span className="text-xs text-red-600 font-medium">
                                Revertido para Comissão Simples (Por Venda)
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Caso 2: Piso atingido e possui faixa ativa */}
                      {item.pisoLojaAtingido && item.comissaoTiered && item.comissaoTiered.faixaAplicada && (
                        <div className="mb-4 p-4 rounded-lg border-2" style={{ borderColor: '#f38a4c', backgroundColor: '#fff7ed' }}>
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <BarChart3 className="w-4 h-4 text-orange-600" />
                              <p className="text-sm font-semibold text-orange-800">Comissão por Faixas (Meta Atingida)</p>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <Badge className="bg-orange-100 text-orange-700">
                                {item.comissaoTiered.percentualMeta.toFixed(1)}% da meta
                              </Badge>
                              <Badge className="bg-green-100 text-green-700">
                                {`Faixa ≥${item.comissaoTiered.faixaAplicada.percentual_meta_min}% → ${item.comissaoTiered.percentualComissao}% ${item.comissaoTiered.faixaAplicada.base_calculo === 'bruto' ? 'bruto' : 'líquido'}`}
                              </Badge>
                              <span className="text-lg font-bold text-orange-700">
                                R$ {item.comissaoTiered.valorComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Caso 3: Piso atingido mas faturamento abaixo do primeiro tier */}
                      {item.pisoLojaAtingido && item.comissaoTiered && !item.comissaoTiered.faixaAplicada && (
                        <div className="mb-4 p-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-gray-500" />
                            <span className="text-xs text-gray-500 font-medium">Faturamento individual abaixo do percentual mínimo para receber comissão.</span>
                          </div>
                          <Badge className="bg-gray-200 text-gray-700">0% de comissão</Badge>
                        </div>
                      )}
                    </>
                  )}

                  {/* Breakdown por Forma de Pagamento */}
                  {Object.keys(item.breakdownPagamentos).length > 0 && (
                    <div className="mt-4 p-4 rounded-lg border" style={{ borderColor: '#E5E0D8' }}>
                      <p className="text-sm font-semibold mb-3" style={{ color: '#07593f' }}>
                        Recebimentos por Forma de Pagamento
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {Object.entries(item.breakdownPagamentos).map(([forma, dados]) => (
                          <div key={forma} className="flex items-center justify-between p-2 rounded bg-gray-50">
                            <span className="text-sm text-gray-600">{forma}</span>
                            <span className="text-sm font-semibold" style={{ color: '#07593f' }}>
                              R$ {dados.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {item.meta > 0 && (
                    <div className="mt-4 p-4 rounded-lg" style={{ backgroundColor: '#f0f9ff' }}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium" style={{ color: '#07593f' }}>
                          Meta Individual: R$ {item.meta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                        <Badge
                          style={{
                            backgroundColor: item.totalVendas >= item.meta ? '#D1FAE5' : '#FEF3C7',
                            color: item.totalVendas >= item.meta ? '#065F46' : '#92400E'
                          }}
                        >
                          {((item.totalVendas / item.meta) * 100).toFixed(0)}% atingido
                        </Badge>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${Math.min((item.totalVendas / item.meta) * 100, 100)}%`,
                            backgroundColor: item.totalVendas >= item.meta ? '#07593f' : '#f38a4c'
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Meta da Loja (se configurado como referência) */}
                  {settings?.comissao_modelo_calculo === 'faixas_meta' && item.faixaRef !== 'vendedor' && item.metaLoja > 0 && (
                    <div className="mt-3 p-4 rounded-lg" style={{ backgroundColor: '#FAF8F5' }}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-gray-700">
                          Meta da Filial (Loja {item.vendedor.loja}): R$ {item.metaLoja.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (Faturamento: R$ {item.faturamentoLoja.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                        </p>
                        <Badge
                          className={item.percentualMetaLoja >= 100 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}
                        >
                          {item.percentualMetaLoja.toFixed(0)}% atingido
                        </Badge>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${Math.min(item.percentualMetaLoja, 100)}%`,
                            backgroundColor: item.percentualMetaLoja >= 100 ? '#07593f' : '#f38a4c'
                          }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}


        {modalNiveisVendedor && (
          <ModalNiveisComissao
            vendedor={modalNiveisVendedor}
            organizationId={tenantId}
            niveisComissao={niveisComissao}
            niveisComissaoFaixas={niveisComissaoFaixas}
            onClose={() => setModalNiveisVendedor(null)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['niveis-comissao'] });
              queryClient.invalidateQueries({ queryKey: ['niveis-comissao-faixas'] });
            }}
          />
        )}

        {/* Modal de Pagamento */}
        <Dialog open={modalPagamento} onOpenChange={setModalPagamento}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-green-600" />
                Registrar Pagamento de Comissão
              </DialogTitle>
              <DialogDescription>
                Confirmar pagamento para <strong>{pagamentoSelecionado?.vendedor.nome}</strong>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="p-4 bg-green-50 rounded-lg border border-green-100 text-center">
                <p className="text-sm text-gray-500 mb-1">Valor a Pagar</p>
                <p className="text-3xl font-bold text-green-700">
                  R$ {pagamentoSelecionado?.totalFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dataPagamento">Data do Pagamento</Label>
                <Input
                  id="dataPagamento"
                  type="date" lang="pt-BR"
                  value={dataPagamento}
                  onChange={(e) => setDataPagamento(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="obsPagamento">Observações (Opcional)</Label>
                <Input
                  id="obsPagamento"
                  placeholder="Ex: Pix, Transferência, etc."
                  value={observacaoPagamento}
                  onChange={(e) => setObservacaoPagamento(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setModalPagamento(false)}>Cancelar</Button>
              <Button
                onClick={confirmarPagamentoComissao}
                disabled={processandoPagamento}
                className="bg-green-600 hover:bg-green-700"
              >
                {processandoPagamento ? "Processando..." : "Confirmar Pagamento"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div >
  );
}
