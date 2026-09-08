import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign, AlertCircle, Plus, BarChart3,
  LayoutDashboard, TrendingDown, TrendingUp, ShoppingCart
} from "lucide-react";
import VisaoGeral from "../components/financeiro/VisaoGeral";
import ContasReceber from "../components/financeiro/ContasReceber";
import ContasPagar from "../components/financeiro/ContasPagar";
import LancamentoForm from "../components/financeiro/LancamentoForm";
import LancamentosList from "../components/financeiro/LancamentosList";
import FinanceiroCharts from "../components/financeiro/FinanceiroCharts";
import RecorrentesManager from "../components/financeiro/RecorrentesManager";
import VencimentosProximos from "../components/financeiro/VencimentosProximos";
import AprovacaoComprasTab from "../components/financeiro/AprovacaoComprasTab";
import { isVendaCancelada } from "@/utils/vendaStatus";

function getLancamentoCompetenciaDate(lancamento) {
  return lancamento?.data_vencimento || lancamento?.data_lancamento || lancamento?.created_at || null;
}

const MESES_OPTIONS = [
  { value: "01", label: "Janeiro" },
  { value: "02", label: "Fevereiro" },
  { value: "03", label: "Março" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Maio" },
  { value: "06", label: "Junho" },
  { value: "07", label: "Julho" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

function getMesAnoParts(mesAno) {
  if (!mesAno || !/^\d{4}-\d{2}$/.test(mesAno)) {
    const now = new Date();
    return {
      ano: String(now.getFullYear()),
      mes: String(now.getMonth() + 1).padStart(2, "0"),
    };
  }

  const [ano, mes] = mesAno.split("-");
  return { ano, mes };
}

function getTodayYmd() {
  return new Date().toISOString().split("T")[0];
}

function getMonthStartYmd() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}


export default function Financeiro() {
  const { user, loading, can } = useAuth();
  const [activeTab, setActiveTab] = useState("visao-geral");
  const [mesAno, setMesAno] = useState(new Date().toISOString().slice(0, 7));
  const [dreModo, setDreModo] = useState("mensal");
  const [dreDataInicio, setDreDataInicio] = useState(getMonthStartYmd());
  const [dreDataFim, setDreDataFim] = useState(getTodayYmd());
  const partesMesAno = useMemo(() => getMesAnoParts(mesAno), [mesAno]);
  const [anoInput, setAnoInput] = useState(partesMesAno.ano);
  const canViewFinanceiro = can('view_financeiro') || can('manage_financeiro');
  const canManage = can('manage_financeiro');

  useEffect(() => {
    setAnoInput(partesMesAno.ano);
  }, [partesMesAno.ano]);

  const queryOpts = { enabled: !!user && canViewFinanceiro };

  const { data: lancamentos = [], isLoading: loadingLancamentos } = useQuery({
    queryKey: ['lancamentos-financeiros'],
    queryFn: async () => await base44.entities.LancamentoFinanceiro.list('-data_lancamento') || [],
    ...queryOpts,
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias-financeiras'],
    queryFn: async () => await base44.entities.CategoriaFinanceira.list('nome') || [],
    ...queryOpts,
  });

  const { data: vendas = [], isLoading: loadingVendas } = useQuery({
    queryKey: ['vendas-financeiro'],
    queryFn: async () => await base44.entities.Venda.list('-data_venda') || [],
    ...queryOpts,
  });

  const { data: folhas = [], isLoading: loadingFolhas } = useQuery({
    queryKey: ['folhas-pagamento'],
    queryFn: async () => await base44.entities.FolhaPagamento.list('-created_at') || [],
    ...queryOpts,
  });

  const { data: comissoes = [], isLoading: loadingComissoes } = useQuery({
    queryKey: ['comissoes-historico'],
    queryFn: async () => await base44.entities.ComissaoHistorico.list('-data_calculo') || [],
    ...queryOpts,
  });

  const { data: contasPagarCompras = [], isLoading: loadingCompras } = useQuery({
    queryKey: ['contas-pagar-compras'],
    queryFn: async () => {
      try {
        return await base44.entities.ContaPagarCompras.list('-created_at') || [];
      } catch {
        // tabela pode não existir em todos os ambientes
        return [];
      }
    },
    ...queryOpts,
  });

  const { data: metas = [] } = useQuery({
    queryKey: ['metas-vendas'],
    queryFn: async () => await base44.entities.MetaVenda.list() || [],
    ...queryOpts,
  });

  const { data: colaboradores = [] } = useQuery({
    queryKey: ['colaboradores-financeiro'],
    queryFn: async () => await base44.entities.Colaborador.list() || [],
    ...queryOpts,
  });

  const { data: entregas = [] } = useQuery({
    queryKey: ['entregas-financeiro'],
    queryFn: async () => await base44.entities.Entrega.list('-created_at') || [],
    ...queryOpts,
  });

  const { data: ocsPendentes = [], isLoading: loadingOcsPendentes } = useQuery({
    queryKey: ['compras-pendentes-aprovacao'],
    queryFn: async () => {
      try {
        return await base44.entities.ComprasOrden.filter({ pagamento_status: 'pendente_aprovacao' }, '-created_at') || [];
      } catch {
        return [];
      }
    },
    ...queryOpts,
    refetchInterval: 30000,
  });

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
      </div>
    );
  }

  if (!canViewFinanceiro) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center text-gray-500">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <h2 className="text-lg font-semibold">Acesso Restrito</h2>
        </div>
      </div>
    );
  }

  const listaLancamentos = Array.isArray(lancamentos) ? lancamentos : [];
  const lancamentosDoMes = listaLancamentos.filter(
    (l) => getLancamentoCompetenciaDate(l)?.slice(0, 7) === mesAno
  );
  const vendasDoMes = vendas.filter(
    (v) => v.data_venda?.slice(0, 7) === mesAno && !isVendaCancelada(v)
  );
  const pendentesCount = ocsPendentes.length;

  const TABS = [
    { id: "visao-geral",    label: "Visão Geral",       icon: LayoutDashboard },
    { id: "contas-receber", label: "Entradas",           icon: TrendingDown },
    { id: "contas-pagar",   label: "Saídas",             icon: TrendingUp },
    { id: "lancamentos",    label: "Lançamentos",        icon: DollarSign },
    { id: "graficos",       label: "Gráficos",           icon: BarChart3 },
    { id: "aprovacao-compras", label: "Aprovação de Compras", icon: ShoppingCart, count: pendentesCount },
    ...(canManage ? [{ id: "novo", label: "Novo", icon: Plus }] : []),
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-end items-center">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mês de Vencimento</span>
          <select
            value={partesMesAno.mes}
            onChange={(e) => {
              const anoBase = anoInput.length === 4 ? anoInput : partesMesAno.ano;
              setMesAno(`${anoBase}-${e.target.value}`);
            }}
            className="border rounded px-3 py-2 text-sm bg-white dark:bg-neutral-900 dark:border-neutral-800"
          >
            {MESES_OPTIONS.map((mes) => (
              <option key={mes.value} value={mes.value}>
                {mes.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            inputMode="numeric"
            placeholder="Ano"
            value={anoInput}
            onChange={(e) => {
              const somenteDigitos = e.target.value.replace(/\D/g, "").slice(0, 4);
              setAnoInput(somenteDigitos);
              if (somenteDigitos.length === 4) {
                setMesAno(`${somenteDigitos}-${partesMesAno.mes}`);
              }
            }}
            onBlur={() => {
              if (anoInput.length !== 4) {
                setAnoInput(partesMesAno.ano);
              }
            }}
            className="w-24 border rounded px-3 py-2 text-sm bg-white dark:bg-neutral-900 dark:border-neutral-800"
          />

          {activeTab === "visao-geral" && (
            <>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">D.R.E.</span>
              <select
                value={dreModo}
                onChange={(e) => setDreModo(e.target.value)}
                className="border rounded px-3 py-2 text-sm bg-white dark:bg-neutral-900 dark:border-neutral-800"
              >
                <option value="mensal">Mensal</option>
                <option value="intervalo">Período</option>
              </select>

              {dreModo === "intervalo" && (
                <>
                  <input
                    type="date"
                    value={dreDataInicio}
                    onChange={(e) => setDreDataInicio(e.target.value)}
                    className="border rounded px-3 py-2 text-sm bg-white dark:bg-neutral-900 dark:border-neutral-800"
                  />
                  <input
                    type="date"
                    value={dreDataFim}
                    onChange={(e) => setDreDataFim(e.target.value)}
                    className="border rounded px-3 py-2 text-sm bg-white dark:bg-neutral-900 dark:border-neutral-800"
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        {/* Tab nav */}
        <div className="bg-white dark:bg-neutral-900 p-1 rounded-xl border border-gray-200 dark:border-neutral-800 overflow-x-auto">
          <TabsList className="h-auto bg-transparent p-0 w-full justify-start gap-1">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="data-[state=active]:bg-green-50 data-[state=active]:text-green-700 dark:data-[state=active]:bg-green-900/20 dark:data-[state=active]:text-green-400 py-2.5 px-4 h-auto rounded-lg border border-transparent data-[state=active]:border-green-100 dark:data-[state=active]:border-green-900 transition-all whitespace-nowrap"
              >
                <tab.icon className="w-4 h-4 mr-2" />
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-2 bg-amber-100 text-amber-800 text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {tab.count}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-4">
          <TabsContent value="visao-geral">
            <VisaoGeral
              vendas={vendas}
              lancamentos={listaLancamentos}
              folhas={folhas}
              comissoes={comissoes}
              contasPagarCompras={contasPagarCompras}
              metas={metas}
              colaboradores={colaboradores}
              mesAno={mesAno}
              dreModo={dreModo}
              dreDataInicio={dreDataInicio}
              dreDataFim={dreDataFim}
            />
          </TabsContent>

          <TabsContent value="contas-receber">
            <ContasReceber vendas={vendas} lancamentos={listaLancamentos} entregas={entregas} mesAno={mesAno} isLoading={loadingVendas} />
          </TabsContent>

          <TabsContent value="contas-pagar">
            <ContasPagar
              folhas={folhas}
              comissoes={comissoes}
              contasPagarCompras={contasPagarCompras}
              lancamentos={listaLancamentos}
              categorias={categorias}
              colaboradores={colaboradores}
              mesAno={mesAno}
              isLoadingFolha={loadingFolhas}
              isLoadingComissoes={loadingComissoes}
              isLoadingCompras={loadingCompras}
              isLoadingLancamentos={loadingLancamentos}
            />
          </TabsContent>

          <TabsContent value="lancamentos">
            <div className="space-y-4">
              <VencimentosProximos lancamentos={listaLancamentos} />
              <LancamentosList
                lancamentos={lancamentosDoMes}
                categorias={categorias}
                isLoading={loadingLancamentos}
              />
              <RecorrentesManager lancamentos={listaLancamentos} />
            </div>
          </TabsContent>

          <TabsContent value="graficos">
            <FinanceiroCharts
              lancamentos={lancamentosDoMes}
              categorias={categorias}
              mesAno={mesAno}
              vendas={vendasDoMes}
            />
          </TabsContent>

          <TabsContent value="categorias">
            {/* removido — categorias agora ficam dentro do formulário de lançamento */}
          </TabsContent>

          <TabsContent value="aprovacao-compras">
            <AprovacaoComprasTab
              ocs={ocsPendentes}
              categorias={categorias}
              isLoading={loadingOcsPendentes}
              currentUser={user}
            />
          </TabsContent>

          {canManage && (
            <TabsContent value="novo">
              <LancamentoForm categorias={categorias} />
            </TabsContent>
          )}
        </div>
      </Tabs>
      
      {/* Modal global de detalhes de lançamentos (escuta eventos customizados) */}
      <LancamentosList onlyModal categorias={categorias} />
    </div>
  );
}