import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, UserCog, Save } from "lucide-react";
import { toast } from "sonner";
import { createOperationalFinancialEntry } from '@/services/financialOperations';

function chaveLancamentoMontador(montadorId, dataInicio, dataFim) {
  return `[MONTAGEM_EXT|${montadorId}|${dataInicio}|${dataFim}]`;
}

function moeda(valor) {
  if (typeof valor !== "number" || Number.isNaN(valor)) return "-";
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseDataSeguro(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export default function RelatorioMontadores() {
  const queryClient = useQueryClient();
  const [filtroMontador, setFiltroMontador] = useState("todos");
  const [dataInicio, setDataInicio] = useState(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split("T")[0]);
  const [dataFim, setDataFim] = useState(new Date().toISOString().split("T")[0]);
  const [valoresPendentes, setValoresPendentes] = useState({});

  const { data: montagensItens = [], isLoading: loadingItens } = useQuery({
    queryKey: ["relatorio-montadores-itens"],
    queryFn: () => base44.entities.MontagemItem.list("-updated_at"),
  });

  const { data: montadores = [] } = useQuery({
    queryKey: ["relatorio-montadores"],
    queryFn: () => base44.entities.Montador.list(),
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["relatorio-montadores-produtos"],
    queryFn: () => base44.entities.Produto.list(),
  });

  const { data: lancamentosFinanceiros = [], isLoading: loadingLancamentos } = useQuery({
    queryKey: ["relatorio-montadores-lancamentos"],
    queryFn: () => base44.entities.LancamentoFinanceiro.list("-data_lancamento"),
  });

  const produtoPorId = useMemo(() => {
    const mapa = {};
    (produtos || []).forEach((p) => {
      mapa[p.id] = p;
    });
    return mapa;
  }, [produtos]);

  const montadorPorId = useMemo(() => {
    const mapa = {};
    (montadores || []).forEach((m) => {
      mapa[m.id] = m;
    });
    return mapa;
  }, [montadores]);

  const atualizarValorMontagem = useMutation({
    mutationFn: ({ produtoId, valor }) => base44.entities.Produto.update(produtoId, { valor_montagem: valor }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relatorio-montadores-produtos"] });
      queryClient.invalidateQueries({ queryKey: ["produtos-relatorios"] });
      toast.success("Valor de montagem atualizado");
    },
    onError: () => {
      toast.error("Nao foi possivel salvar o valor de montagem");
    },
  });

  const criarLancamentoMontagem = useMutation({
    mutationFn: ({ sourceId, operationKey, ...entry }) => createOperationalFinancialEntry({
      sourceType: 'montagem', sourceId, operationKey, entry,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relatorio-montadores-lancamentos"] });
      queryClient.invalidateQueries({ queryKey: ["lancamentos-financeiros"] });
      queryClient.invalidateQueries({ queryKey: ["lancamentos-relatorios"] });
    },
  });

  const itensFiltrados = useMemo(() => {
    const inicio = parseDataSeguro(dataInicio);
    const fim = parseDataSeguro(dataFim);
    if (fim) fim.setHours(23, 59, 59, 999);

    return montagensItens.filter((item) => {
      const status = String(item.status || "").toLowerCase();
      const tipo = String(item.tipo_montagem || "").toLowerCase();
      const montadorId = item.montador_id;
      const dataItem = parseDataSeguro(item.data_agendada || item.updated_at || item.created_at);

      const statusConcluido = status.includes("conclu");
      const tipoTerceirizado = tipo === "terceirizada";
      const temMontador = montadorId !== null && montadorId !== undefined;
      const passouFiltroMontador = filtroMontador === "todos" || String(montadorId) === filtroMontador;
      const passouFiltroData = (!inicio || (dataItem && dataItem >= inicio)) && (!fim || (dataItem && dataItem <= fim));

      return statusConcluido && tipoTerceirizado && temMontador && passouFiltroMontador && passouFiltroData;
    });
  }, [montagensItens, filtroMontador, dataInicio, dataFim]);

  const gruposMontador = useMemo(() => {
    const grupos = {};

    itensFiltrados.forEach((item) => {
      const montadorId = item.montador_id;
      if (!grupos[montadorId]) {
        const chaveLancamento = chaveLancamentoMontador(montadorId, dataInicio, dataFim);
        const lancamentoExistente = (lancamentosFinanceiros || []).find((lancamento) => {
          const textoLivre = `${lancamento.observacao || ""} ${lancamento.observacoes || ""} ${lancamento.descricao || ""}`;
          return textoLivre.includes(chaveLancamento);
        });

        grupos[montadorId] = {
          montadorId,
          montadorNome: montadorPorId[montadorId]?.nome || item.montador_nome || `Montador ${montadorId}`,
          itens: [],
          totalBruto: 0,
          qtdItens: 0,
          chaveLancamento,
          lancamentoExistente,
        };
      }

      const produto = item.produto_id ? produtoPorId[item.produto_id] : null;
      const valorMontagem = typeof produto?.valor_montagem === "number" ? produto.valor_montagem : null;
      const quantidade = item.quantidade || 1;
      const subtotal = valorMontagem !== null ? valorMontagem * quantidade : null;

      grupos[montadorId].itens.push({
        id: item.id,
        produto_id: item.produto_id,
        produto_nome: item.produto_nome,
        quantidade,
        valor_montagem: valorMontagem,
        subtotal,
        data_ref: item.data_agendada || item.updated_at || item.created_at,
      });

      grupos[montadorId].qtdItens += quantidade;
      if (subtotal !== null) {
        grupos[montadorId].totalBruto += subtotal;
      }
    });

    return Object.values(grupos).sort((a, b) => b.totalBruto - a.totalBruto);
  }, [itensFiltrados, montadorPorId, produtoPorId, lancamentosFinanceiros, dataInicio, dataFim]);

  const resumo = useMemo(() => {
    const totalMontadores = gruposMontador.length;
    const totalItens = gruposMontador.reduce((soma, grupo) => soma + grupo.qtdItens, 0);
    const totalBruto = gruposMontador.reduce((soma, grupo) => soma + grupo.totalBruto, 0);
    const totalLancado = gruposMontador
      .filter((grupo) => !!grupo.lancamentoExistente)
      .reduce((soma, grupo) => soma + grupo.totalBruto, 0);
    const totalPendente = totalBruto - totalLancado;

    return { totalMontadores, totalItens, totalBruto, totalLancado, totalPendente };
  }, [gruposMontador]);

  const handleValorPendente = (produtoId, valor) => {
    setValoresPendentes((prev) => ({ ...prev, [produtoId]: valor }));
  };

  const handleSalvarValor = (produtoId) => {
    const bruto = valoresPendentes[produtoId];
    const valor = Number(String(bruto || "").replace(",", "."));

    if (!valor || valor <= 0) {
      toast.error("Informe um valor valido para a montagem");
      return;
    }

    atualizarValorMontagem.mutate({ produtoId, valor });
  };

  const gerarLancamentoPorMontador = async (grupo) => {
    if (grupo.lancamentoExistente) {
      toast.info(`Lançamento já existe para ${grupo.montadorNome} neste período`);
      return;
    }

    if (!grupo.totalBruto || grupo.totalBruto <= 0) {
      toast.error(`Total inválido para ${grupo.montadorNome}`);
      return;
    }

    try {
      await criarLancamentoMontagem.mutateAsync({
        sourceId: grupo.itens[0]?.id,
        operationKey: grupo.chaveLancamento,
        descricao: `Montagem Externa - ${grupo.montadorNome} (${dataInicio} a ${dataFim})`,
        valor: Number(grupo.totalBruto.toFixed(2)),
        tipo: "despesa",
        categoria_nome: "Montagens Externas",
        data_lancamento: dataFim,
        forma_pagamento: "Transferência",
        status: "Pendente",
        observacao: `${grupo.chaveLancamento} Pagamento bruto de montagens terceirizadas no período.`,
      });
      toast.success(`Lançamento financeiro criado para ${grupo.montadorNome}`);
    } catch (error) {
      toast.error(`Falha ao criar lançamento: ${error.message}`);
    }
  };

  const gerarLancamentosPendentes = async () => {
    const pendentes = gruposMontador.filter((grupo) => !grupo.lancamentoExistente && grupo.totalBruto > 0);
    if (pendentes.length === 0) {
      toast.info("Não há lançamentos pendentes para gerar");
      return;
    }

    for (const grupo of pendentes) {
      // processamento sequencial para reduzir risco de corrida e mensagens de erro simultâneas
      // eslint-disable-next-line no-await-in-loop
      await gerarLancamentoPorMontador(grupo);
    }
  };

  if (loadingItens || loadingLancamentos) {
    return (
      <Card className="border-0 shadow-lg">
        <CardContent className="p-6 text-sm text-gray-500">Carregando relatorio de montadores...</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5 text-emerald-600" />
            Relatorio de montagens terceirizadas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs text-gray-500">Data inicio</Label>
              <Input type="date" lang="pt-BR" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Data fim</Label>
              <Input type="date" lang="pt-BR" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Montador</Label>
              <Select value={filtroMontador} onValueChange={setFiltroMontador}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {montadores.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="border border-emerald-100">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Montadores no periodo</p>
                <p className="text-2xl font-bold text-gray-900">{resumo.totalMontadores}</p>
              </CardContent>
            </Card>
            <Card className="border border-emerald-100">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Itens montados</p>
                <p className="text-2xl font-bold text-gray-900">{resumo.totalItens}</p>
              </CardContent>
            </Card>
            <Card className="border border-emerald-100">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total bruto a pagar</p>
                <p className="text-2xl font-bold text-emerald-700">{moeda(resumo.totalBruto)}</p>
              </CardContent>
            </Card>
            <Card className="border border-emerald-100">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Já lançado (financeiro)</p>
                <p className="text-2xl font-bold text-blue-700">{moeda(resumo.totalLancado)}</p>
              </CardContent>
            </Card>
            <Card className="border border-emerald-100">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Pendente de lançamento</p>
                <p className="text-2xl font-bold text-amber-700">{moeda(resumo.totalPendente)}</p>
              </CardContent>
            </Card>
          </div>

          <Alert className="border-amber-200 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">
              Itens sem valor de montagem exibem campo em branco para definicao rapida no cadastro do produto.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={gerarLancamentosPendentes}
              disabled={criarLancamentoMontagem.isPending}
            >
              Gerar lançamentos pendentes
            </Button>
          </div>
        </CardContent>
      </Card>

      {gruposMontador.length === 0 ? (
        <Card className="border-0 shadow-lg">
          <CardContent className="p-6 text-gray-500">
            Nenhuma montagem terceirizada concluida encontrada para os filtros selecionados.
          </CardContent>
        </Card>
      ) : (
        gruposMontador.map((grupo) => (
          <Card key={grupo.montadorId} className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-lg">{grupo.montadorNome}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{grupo.qtdItens} item(ns)</Badge>
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Total: {moeda(grupo.totalBruto)}</Badge>
                  <Badge className={grupo.lancamentoExistente ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100"}>
                    {grupo.lancamentoExistente ? "Lançado no financeiro" : "Sem lançamento"}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => gerarLancamentoPorMontador(grupo)}
                    disabled={!!grupo.lancamentoExistente || criarLancamentoMontagem.isPending || grupo.totalBruto <= 0}
                  >
                    Gerar lançamento
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Valor montagem</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grupo.itens.map((item) => {
                    const data = parseDataSeguro(item.data_ref);
                    const podeSalvarInline = !!item.produto_id;
                    const valorPendente = item.produto_id ? (valoresPendentes[item.produto_id] ?? "") : "";

                    return (
                      <TableRow key={item.id}>
                        <TableCell>{data ? data.toLocaleDateString("pt-BR") : "-"}</TableCell>
                        <TableCell>{item.produto_nome || "-"}</TableCell>
                        <TableCell className="text-right">{item.quantidade}</TableCell>
                        <TableCell className="text-right">
                          {item.valor_montagem === null ? (
                            <div className="flex items-center justify-end gap-2">
                              {podeSalvarInline ? (
                                <>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={valorPendente}
                                    onChange={(e) => handleValorPendente(item.produto_id, e.target.value)}
                                    placeholder="R$"
                                    className="w-28"
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleSalvarValor(item.produto_id)}
                                    disabled={atualizarValorMontagem.isPending}
                                  >
                                    <Save className="w-3 h-3 mr-1" />
                                    Salvar
                                  </Button>
                                </>
                              ) : (
                                <span className="text-xs text-amber-700">Sem vinculo com produto</span>
                              )}
                            </div>
                          ) : (
                            moeda(item.valor_montagem)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {item.subtotal === null ? "-" : moeda(item.subtotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
