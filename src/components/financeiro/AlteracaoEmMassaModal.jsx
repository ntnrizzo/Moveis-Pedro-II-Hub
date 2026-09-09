import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";
import { formatBrazilDate } from "@/lib/dateBrazil";
import {
  Search,
  CheckSquare,
  X,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Loader2,
  Filter,
  ArrowRight,
  RefreshCw
} from "lucide-react";

export default function AlteracaoEmMassaModal({ open, onOpenChange, lancamentos = [], categorias = [] }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user, can } = useAuth();

  // Estados locais do modal
  const [busca, setBusca] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("todos"); // todos, entrada, saida
  const [statusFiltro, setStatusFiltro] = useState("pendente"); // todos, pendente, pago, cancelado (padrão pendente)
  const [categoriaFiltro, setCategoriaFiltro] = useState("todos");

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [novoStatus, setNovoStatus] = useState("Pago"); // Pago ou Pendente ou Cancelado
  const [etapa, setEtapa] = useState("selecao"); // selecao | confirmacao
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);

  // Resetar ao fechar ou abrir
  const handleClose = (isOpen) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setEtapa("selecao");
      setSelectedIds(new Set());
      setBusca("");
      setExecutionResult(null);
      setIsExecuting(false);
    }
  };

  // Filtragem dos lançamentos
  const lancamentosFiltrados = useMemo(() => {
    return lancamentos.filter((lanc) => {
      // Busca por texto (descrição, categoria, valor, data)
      if (busca.trim()) {
        const termo = busca.toLowerCase().trim();
        const matchDesc = lanc.descricao?.toLowerCase().includes(termo);
        const matchCat = lanc.categoria_nome?.toLowerCase().includes(termo);
        const matchValor = String(lanc.valor || "").includes(termo);
        const matchForma = lanc.forma_pagamento?.toLowerCase().includes(termo);
        const matchData = (lanc.data_vencimento || lanc.data_lancamento || "").includes(termo);

        if (!matchDesc && !matchCat && !matchValor && !matchForma && !matchData) {
          return false;
        }
      }

      // Filtro de Tipo
      if (tipoFiltro !== "todos") {
        const isEntrada = lanc.tipo === "Entrada" || lanc.tipo === "receita";
        if (tipoFiltro === "entrada" && !isEntrada) return false;
        if (tipoFiltro === "saida" && isEntrada) return false;
      }

      // Filtro de Status
      if (statusFiltro !== "todos") {
        const statusAtual = lanc.status || "Pendente";
        if (statusFiltro === "pendente" && statusAtual !== "Pendente") return false;
        if (statusFiltro === "pago" && statusAtual !== "Pago") return false;
        if (statusFiltro === "cancelado" && statusAtual !== "Cancelado") return false;
      }

      // Filtro de Categoria
      if (categoriaFiltro !== "todos") {
        if (String(lanc.categoria_id) !== String(categoriaFiltro) && lanc.categoria_nome !== categoriaFiltro) {
          return false;
        }
      }

      return true;
    });
  }, [lancamentos, busca, tipoFiltro, statusFiltro, categoriaFiltro]);

  // Lista de lançamentos selecionados (objetos completos)
  const lancamentosSelecionados = useMemo(() => {
    return lancamentos.filter((l) => selectedIds.has(l.id));
  }, [lancamentos, selectedIds]);

  // Valor total selecionado
  const totalValorSelecionado = useMemo(() => {
    return lancamentosSelecionados.reduce((sum, l) => sum + Number(l.valor || 0), 0);
  }, [lancamentosSelecionados]);

  // Handlers de seleção
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selecionarTodosFiltrados = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      lancamentosFiltrados.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const limparSelecao = () => {
    setSelectedIds(new Set());
  };

  const removerToken = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // Executar alteração em massa
  const executarAlteracaoEmMassa = async () => {
    if (!can("manage_financeiro")) return;
    if (selectedIds.size === 0) return;

    setIsExecuting(true);
    setExecutionResult(null);

    let sucessos = 0;
    let falhas = 0;
    const erros = [];

    try {
      for (const lanc of lancamentosSelecionados) {
        try {
          const previousStatus = lanc.status || "Pendente";
          await base44.entities.LancamentoFinanceiro.update(lanc.id, { status: novoStatus });

          // Se marcou como Pago, adiciona Log de Auditoria
          if (novoStatus === "Pago" && previousStatus !== "Pago") {
            try {
              await base44.entities.AuditLog.create({
                acao: "MARK_PAID",
                usuario: user?.full_name || user?.nome || user?.email || "Usuário desconhecido",
                user_id: user?.id || null,
                tabela: "lancamentos_financeiros",
                detalhes: {
                  record_id: lanc.id,
                  descricao: lanc.descricao || null,
                  categoria: lanc.categoria_nome || null,
                  valor: lanc.valor ?? null,
                  data_vencimento: lanc.data_vencimento || null,
                  from_status: previousStatus,
                  to_status: novoStatus,
                  origem: "alteracao_em_massa"
                },
              });
            } catch (err) {
              console.error("Erro audit log:", err);
            }
          }

          sucessos++;
        } catch (err) {
          falhas++;
          erros.push(`${lanc.descricao}: ${err.message || "Erro de atualização"}`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["lancamentos-financeiros"] });
      queryClient.invalidateQueries({ queryKey: ["audit-mark-paid"] });

      setExecutionResult({
        sucessos,
        falhas,
        erros,
      });

    } catch (err) {
      setExecutionResult({
        sucessos,
        falhas: selectedIds.size - sucessos,
        erros: [err.message || "Erro ao processar alteração em massa."]
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const formatMoney = (val) =>
    `R$ ${Math.abs(val || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  return (
    <Dialog open={open && can("manage_financeiro")} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="p-5 pb-3 border-b bg-gray-50/50 dark:bg-neutral-900/50">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
                <CheckSquare className="w-5 h-5 text-emerald-600" />
                Alteração em Massa de Lançamentos
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500 mt-1">
                Pesquise, selecione múltiplos lançamentos e altere o status de pagamento de uma só vez.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Conteúdo principal */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {executionResult ? (
            /* Tela de Resultado da Operação */
            <div className="space-y-4 py-4">
              <div className="p-4 rounded-lg bg-green-50 border border-green-200 flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-bold text-green-900">Operação concluída com sucesso!</h4>
                  <p className="text-sm text-green-700 mt-1">
                    {executionResult.sucessos} lançamento(s) alterado(s) para o status <strong>{novoStatus}</strong>.
                  </p>
                  {executionResult.falhas > 0 && (
                    <p className="text-sm text-red-600 mt-1">
                      {executionResult.falhas} lançamento(s) apresentaram erro na alteração.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  onClick={() => {
                    setExecutionResult(null);
                    setEtapa("selecao");
                    setSelectedIds(new Set());
                  }}
                  variant="outline"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Realizar outra alteração
                </Button>
                <Button onClick={() => handleClose(false)}>
                  Concluir
                </Button>
              </div>
            </div>
          ) : etapa === "selecao" ? (
            /* ETAPA 1: Seleção de Lançamentos & Tokens */
            <div className="space-y-4">
              {/* Painel de Controle de Status de Destino */}
              <div className="p-4 rounded-xl border bg-gradient-to-r from-emerald-50/50 to-teal-50/50 dark:from-emerald-950/20 dark:to-teal-950/20 border-emerald-200 dark:border-emerald-900/50 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-emerald-900 dark:text-emerald-300">
                    Definir Novo Status Desejado:
                  </Label>
                  <div className="flex items-center gap-2">
                    <Select value={novoStatus} onValueChange={setNovoStatus}>
                      <SelectTrigger className="w-[180px] bg-white dark:bg-neutral-800 font-semibold border-emerald-300">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pago">
                          <span className="flex items-center gap-2">
                            <Badge className="bg-green-100 text-green-800">Pago</Badge>
                          </span>
                        </SelectItem>
                        <SelectItem value="Pendente">
                          <span className="flex items-center gap-2">
                            <Badge className="bg-yellow-100 text-yellow-800">Pendente</Badge>
                          </span>
                        </SelectItem>
                        <SelectItem value="Cancelado">
                          <span className="flex items-center gap-2">
                            <Badge className="bg-gray-100 text-gray-600">Cancelado</Badge>
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Resumo de Seleção */}
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Lançamentos Selecionados</p>
                    <p className="text-lg font-bold text-emerald-800 dark:text-emerald-400">
                      {selectedIds.size} item(s)
                    </p>
                  </div>
                  <div className="h-8 w-px bg-emerald-200 dark:bg-emerald-800" />
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Valor Total Acumulado</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {formatMoney(totalValorSelecionado)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Barra de Busca Tokenizada & Filtros */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <div className="relative flex-1 min-w-[240px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Pesquisar por descrição, categoria, valor, data ou forma de pagamento..."
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      className="pl-9"
                    />
                    {busca && (
                      <button
                        onClick={() => setBusca("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos Status</SelectItem>
                      <SelectItem value="pendente">Apenas Pendentes</SelectItem>
                      <SelectItem value="pago">Apenas Pagos</SelectItem>
                      <SelectItem value="cancelado">Apenas Cancelados</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos Tipos</SelectItem>
                      <SelectItem value="saida">Saídas</SelectItem>
                      <SelectItem value="entrada">Entradas</SelectItem>
                    </SelectContent>
                  </Select>

                  {categorias.length > 0 && (
                    <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todas Categorias</SelectItem>
                        {categorias.map((cat) => (
                          <SelectItem key={cat.id} value={String(cat.id)}>
                            {cat.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Tokens de Lançamentos Selecionados (Chips) */}
                {selectedIds.size > 0 && (
                  <div className="p-3 rounded-lg border bg-gray-50 dark:bg-neutral-900/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Tokens Selecionados ({selectedIds.size}):
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-red-600 hover:bg-red-50"
                        onClick={limparSelecao}
                      >
                        Limpar Seleção
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                      {lancamentosSelecionados.map((item) => (
                        <Badge
                          key={item.id}
                          variant="secondary"
                          className="pl-2 pr-1 py-1 flex items-center gap-1.5 bg-white dark:bg-neutral-800 border shadow-sm text-xs"
                        >
                          <span className="font-semibold text-gray-900 dark:text-white truncate max-w-[200px]">
                            {item.descricao}
                          </span>
                          <span className="text-gray-400">·</span>
                          <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                            {formatMoney(item.valor)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removerToken(item.id)}
                            className="ml-1 rounded-full p-0.5 hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-400 hover:text-red-600 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Ações Rápidas de Seleção da Lista */}
              <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
                <span>
                  Exibindo <strong>{lancamentosFiltrados.length}</strong> de {lancamentos.length} lançamentos
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={selecionarTodosFiltrados}
                    disabled={lancamentosFiltrados.length === 0}
                  >
                    Selecionar Todos da Busca ({lancamentosFiltrados.length})
                  </Button>
                </div>
              </div>

              {/* Tabela / Lista Candidata de Seleção */}
              <div className="border rounded-xl overflow-hidden divide-y max-h-[340px] overflow-y-auto">
                {lancamentosFiltrados.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-medium">Nenhum lançamento encontrado para os filtros</p>
                  </div>
                ) : (
                  lancamentosFiltrados.map((lanc) => {
                    const isSelected = selectedIds.has(lanc.id);
                    const isEntrada = lanc.tipo === "Entrada" || lanc.tipo === "receita";

                    return (
                      <div
                        key={lanc.id}
                        onClick={() => toggleSelect(lanc.id)}
                        className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-emerald-50/70 dark:bg-emerald-950/40 border-l-4 border-l-emerald-600"
                            : "hover:bg-gray-50 dark:hover:bg-neutral-800/50"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(lanc.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isEntrada ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                            {isEntrada ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-sm truncate text-gray-900 dark:text-white">
                              {lanc.descricao || "Sem descrição"}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {lanc.categoria_nome || "Sem categoria"} · Vence {formatBrazilDate(lanc.data_vencimento || lanc.data_lancamento)} · {lanc.forma_pagamento || "Dinheiro"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`text-sm font-bold ${isEntrada ? "text-green-600" : "text-red-600"}`}>
                            {formatMoney(lanc.valor)}
                          </span>
                          <Badge className={
                            lanc.status === "Pago"
                              ? "bg-green-100 text-green-800"
                              : lanc.status === "Cancelado"
                              ? "bg-gray-100 text-gray-600"
                              : "bg-yellow-100 text-yellow-800"
                          }>
                            {lanc.status || "Pendente"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* ETAPA 2: Confirmação Detalhada */
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 dark:bg-amber-950/30 flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-bold text-amber-900 dark:text-amber-300">
                    Confirmar Alteração em Massa
                  </h4>
                  <p className="text-sm text-amber-800 dark:text-amber-400 mt-1">
                    Você está prestes a alterar o status de <strong>{selectedIds.size} lançamento(s)</strong> para{" "}
                    <Badge className="bg-emerald-700 text-white font-bold ml-1">{novoStatus}</Badge>.
                    O valor total acumulado nesta operação é de <strong>{formatMoney(totalValorSelecionado)}</strong>.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-300">
                  Lançamentos a serem alterados:
                </h4>
                <div className="border rounded-xl overflow-hidden divide-y max-h-[340px] overflow-y-auto">
                  {lancamentosSelecionados.map((lanc) => {
                    const isEntrada = lanc.tipo === "Entrada" || lanc.tipo === "receita";
                    return (
                      <div key={lanc.id} className="flex items-center justify-between p-3 bg-white dark:bg-neutral-800">
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                            {lanc.descricao}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {lanc.categoria_nome || "Sem categoria"} · Vence {formatBrazilDate(lanc.data_vencimento || lanc.data_lancamento)} · {lanc.forma_pagamento || "Dinheiro"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <span className={`text-sm font-bold ${isEntrada ? "text-green-600" : "text-red-600"}`}>
                            {formatMoney(lanc.valor)}
                          </span>
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <Badge variant="outline" className="opacity-70">{lanc.status || "Pendente"}</Badge>
                            <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                            <Badge className="bg-emerald-600 text-white">{novoStatus}</Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé de Ações */}
        {!executionResult && (
          <div className="p-4 border-t bg-gray-50/50 dark:bg-neutral-900/50 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (etapa === "confirmacao") {
                  setEtapa("selecao");
                } else {
                  handleClose(false);
                }
              }}
              disabled={isExecuting}
            >
              {etapa === "confirmacao" ? "Voltar à seleção" : "Cancelar"}
            </Button>

            {etapa === "selecao" ? (
              <Button
                type="button"
                onClick={() => setEtapa("confirmacao")}
                disabled={selectedIds.size === 0}
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
              >
                Avançar ({selectedIds.size} selecionados)
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={executarAlteracaoEmMassa}
                disabled={isExecuting}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Aplicando alterações...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Confirmar e Alterar ({selectedIds.size} lançamentos)
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
