import { toast } from "sonner";
import { financialErrorMessage } from "@/lib/financialCapabilities";
import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";
import { formatBrazilDate } from "@/lib/dateBrazil";
import { 
  RefreshCw, 
  Calendar, 
  CheckCircle, 
  AlertCircle,
  Clock,
  Eye,
  Trash2,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import {
  addRecorrenciaToDate,
  buildRecurringOccurrenceKey,
  encerrarEExcluirRecorrencia,
  getRecorrenciaAnchorDate,
  getRecorrenciaTipo,
  isLancamentoRecorrente,
  isRecurringOccurrenceDuplicate,
} from "@/lib/financeiroRecorrencia";

export default function RecorrentesManager({ lancamentos }) {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const autoProcessedRef = useRef(false);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user, can } = useAuth();
  const canManage = can("manage_financeiro");
  const canDelete = can("delete_financial_entry");
  const generationScope = `${user?.id}:${user?.organization_id}:${canManage}`;
  const latestScope = useRef(generationScope);
  latestScope.current = generationScope;
  useEffect(() => () => { latestScope.current = null; }, []);
  useEffect(() => { autoProcessedRef.current = false; }, [generationScope]);

  const createMutation = useMutation({
    mutationFn: (data) => {
      if (!canManage) throw new Error("Sem permissão para gerar recorrências.");
      return base44.entities.LancamentoFinanceiro.create({ ...data, organization_id: user.organization_id });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      if (!canManage) throw new Error("Sem permissão para alterar lançamentos.");
      return base44.entities.LancamentoFinanceiro.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
    },
    onError: error => toast.error(financialErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (target) => {
      if (!canDelete) throw new Error("Somente administrador pode excluir lançamentos.");
      if (typeof target === "object" && target !== null) {
        if (isLancamentoRecorrente(target)) {
          return await encerrarEExcluirRecorrencia(target, base44);
        }
        return await base44.entities.LancamentoFinanceiro.delete(target.id);
      }
      return await base44.entities.LancamentoFinanceiro.delete(target);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
    },
    onError: error => toast.error(financialErrorMessage(error)),
  });

  const handleStatusChange = async (id, newStatus) => {
    if (!canManage) return;
    const lanc = lancamentos.find((item) => item.id === id);
    if (!lanc) return;

    const previousStatus = lanc.status || 'Pendente';
    const isMarkingAsPaid = newStatus === 'Pago' && previousStatus !== 'Pago';

    if (isMarkingAsPaid) {
      const confirmed = await confirm({
        title: 'Confirmar pagamento',
        message: `Confirmar ${lanc.descricao || 'lançamento'} (${formatBrazilDate(lanc.data_vencimento || lanc.data_lancamento)} · R$ ${Number(lanc.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) como pago?`,
        confirmText: 'Confirmar pagamento',
        cancelText: 'Cancelar',
        variant: 'default',
      });

      if (!confirmed) return;
    }

    updateMutation.mutate(
      { id, data: { status: newStatus } },
      {
        onSuccess: async () => {
          if (!isMarkingAsPaid) return;

          try {
            await base44.entities.AuditLog.create({
              acao: 'MARK_PAID',
              usuario: user?.full_name || user?.nome || user?.email || 'Usuário desconhecido',
              user_id: user?.id || null,
              tabela: 'lancamentos_financeiros',
              detalhes: {
                record_id: id,
                descricao: lanc.descricao || null,
                categoria: lanc.categoria_nome || null,
                valor: lanc.valor ?? null,
                data_vencimento: lanc.data_vencimento || null,
                from_status: previousStatus,
                to_status: newStatus,
              },
            });
            queryClient.invalidateQueries({ queryKey: ['audit-mark-paid'] });
          } catch (error) {
            console.error('Erro ao registrar declaração de pagamento:', error);
          }
        }
      }
    );
  };

  const handleDelete = async (lanc) => {
    if (!canDelete) return;
    const dataRef = formatBrazilDate(lanc.data_vencimento || lanc.data_lancamento);
    const confirmed = await confirm({
      title: 'Excluir e encerrar recorrência',
      message: `Atenção: Ao excluir "${lanc.descricao}", esta ocorrência e TODAS as ocorrências futuras desta recorrência serão encerradas a partir de ${dataRef}.\n\nLançamentos recorrentes anteriores a esta data serão mantidos no histórico. Deseja continuar?`,
      confirmText: 'Excluir e Encerrar Recorrência',
      cancelText: 'Cancelar',
      variant: 'destructive',
    });

    if (!confirmed) return;
    deleteMutation.mutate(lanc);
  };

  const abrirDetalhes = (lanc) => {
    window.dispatchEvent(new CustomEvent("openLancamentoDetalhes", { detail: lanc }));
  };

  const gerarLancamentosRecorrentes = async () => {
    if (!canManage) return;
    setProcessing(true);
    setResult(null);

    try {
      const hoje = new Date();
      const limiteData = new Date(hoje);
      limiteData.setDate(limiteData.getDate() + 90);
      const limiteIso = limiteData.toISOString().slice(0, 10);
      const recorrentes = lancamentos.filter(l => l.recorrente === true);
      
      let gerados = 0;
      let ignorados = 0;
      const detalhes = [];
      const lancamentosAtualizados = [...lancamentos];

      for (const lanc of recorrentes) {
        if (latestScope.current !== generationScope) return;
        const tipoRecorrencia = getRecorrenciaTipo(lanc.recorrencia_tipo);
        const dataBase = getRecorrenciaAnchorDate(lanc);
        if (!dataBase) {
          ignorados++;
          continue;
        }

        let competencia = addRecorrenciaToDate(dataBase, tipoRecorrencia);
        if (!competencia) {
          ignorados++;
          continue;
        }

        while (competencia && competencia <= limiteIso) {
          if (latestScope.current !== generationScope) return;
          if (!isRecurringOccurrenceDuplicate(lanc, competencia, lancamentosAtualizados)) {
            const origemRef = buildRecurringOccurrenceKey(lanc.id, competencia);
            const novoLancamento = await createMutation.mutateAsync({
              tipo: lanc.tipo,
              categoria_id: lanc.categoria_id,
              categoria_nome: lanc.categoria_nome,
              descricao: lanc.descricao,
              valor: lanc.valor,
              data_lancamento: competencia,
              data_vencimento: competencia,
              forma_pagamento: lanc.forma_pagamento,
              status: 'Pendente',
              observacao: `Gerado automaticamente de lançamento com recorrência (${tipoRecorrencia})`,
              recorrente: false,
              anexo_url: lanc.anexo_url,
              origem_tipo: 'recorrencia',
              origem_ref: origemRef || null,
            });

            lancamentosAtualizados.push(novoLancamento);

            gerados++;
            detalhes.push({
              descricao: lanc.descricao,
              data: competencia,
              valor: lanc.valor
            });
          } else {
            ignorados++;
          }

          competencia = addRecorrenciaToDate(competencia, tipoRecorrencia);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
      
      setResult({
        success: true,
        gerados,
        ignorados,
        total: recorrentes.length,
        detalhes
      });

    } catch (error) {
      console.error('Erro ao gerar lançamentos:', error);
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setProcessing(false);
    }
  };

  useEffect(() => {
    if (!canManage || autoProcessedRef.current || !lancamentos.some(l => l.recorrente === true)) return;
    const timer = setTimeout(() => {
      if (latestScope.current !== generationScope) return;
      autoProcessedRef.current = true;
      void gerarLancamentosRecorrentes();
    }, 1000);
    return () => clearTimeout(timer);
  }, [lancamentos, canManage, generationScope]);

  const recorrentes = lancamentos.filter(l => l.recorrente === true);

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Lançamentos Recorrentes
          </CardTitle>
          <Badge variant="outline" className="text-emerald-700 border-emerald-600 bg-emerald-50">
            {recorrentes.length} ativo(s)
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#f0f9ff' }}>
          <Clock className="w-5 h-5 mt-0.5" style={{ color: '#07593f' }} />
          <div className="flex-1">
            <h4 className="font-semibold mb-1" style={{ color: '#07593f' }}>
              Geração Automática
            </h4>
            <p className="text-sm" style={{ color: '#8B8B8B' }}>
              Os lançamentos recorrentes são verificados e gerados automaticamente quando você acessa esta página.
              Novos lançamentos são criados com status &quot;Pendente&quot; para revisão.
            </p>
          </div>
        </div>

        {result && (
          result.success ? (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <AlertDescription className="ml-2">
                <div className="space-y-2">
                  <p className="font-semibold text-green-800">
                    Processamento concluído!
                  </p>
                  <div className="text-sm text-green-700">
                    <p>• {result.gerados} lançamento(s) gerado(s)</p>
                    <p>• {result.ignorados} já existente(s)</p>
                    <p>• {result.total} recorrente(s) verificado(s)</p>
                  </div>
                  {result.detalhes.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="font-semibold text-green-800">Lançamentos gerados:</p>
                      {result.detalhes.slice(0, 5).map((det, idx) => (
                        <p key={idx} className="text-sm text-green-700">
                          • {det.descricao} - {formatBrazilDate(det.data)} - R$ {Number(det.valor || 0).toFixed(2)}
                        </p>
                      ))}
                      {result.detalhes.length > 5 && (
                        <p className="text-sm text-green-700">
                          ... e mais {result.detalhes.length - 5} lançamento(s)
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="bg-red-50 border-red-200">
              <AlertCircle className="h-5 w-5 text-red-600" />
              <AlertDescription className="ml-2 text-red-800">
                Erro ao processar lançamentos: {result.error}
              </AlertDescription>
            </Alert>
          )
        )}

        {recorrentes.length > 0 ? (
          <div className="space-y-3">
            <h4 className="font-semibold" style={{ color: '#07593f' }}>
              Lançamentos Recorrentes Ativos:
            </h4>
            {recorrentes.map((lanc) => {
              const isEntrada = lanc.tipo === 'Entrada' || lanc.tipo === 'receita';
              const isUpdating = updateMutation.isPending && updateMutation.variables?.id === lanc.id;

              return (
                <div 
                  key={lanc.id}
                  className="flex items-center justify-between p-3.5 rounded-lg border hover:bg-gray-50 dark:hover:bg-neutral-800/50 transition-colors cursor-pointer group"
                  style={{ borderColor: '#E5E0D8' }}
                  onClick={() => abrirDetalhes(lanc)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0 mr-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isEntrada ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {isEntrada ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold truncate text-gray-900 dark:text-white" style={{ color: '#07593f' }}>
                          {lanc.descricao}
                        </p>
                        <Badge variant="outline" className="text-[10px] shrink-0 border-emerald-600 text-emerald-700 bg-emerald-50">
                          {lanc.recorrencia_tipo || 'Mensal'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs mt-0.5 text-gray-500">
                        <span className={`font-semibold ${isEntrada ? 'text-green-600' : 'text-red-600'}`}>
                          R$ {Number(lanc.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                        <span>·</span>
                        <span>Vence em {formatBrazilDate(lanc.data_vencimento || lanc.data_lancamento)}</span>
                        {lanc.categoria_nome && (
                          <>
                            <span>·</span>
                            <span className="truncate">{lanc.categoria_nome}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={lanc.status || 'Pendente'}
                      onValueChange={(val) => handleStatusChange(lanc.id, val)}
                      disabled={!canManage || isUpdating}
                    >
                      <SelectTrigger className="h-7 text-xs border-0 bg-transparent hover:bg-gray-100 dark:hover:bg-neutral-800">
                        <SelectValue>
                          <Badge className={
                            lanc.status === 'Pago'
                              ? 'bg-green-100 text-green-800'
                              : lanc.status === 'Cancelado'
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-yellow-100 text-yellow-800'
                          }>
                            {lanc.status || 'Pendente'}
                          </Badge>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pago">
                          <Badge className="bg-green-100 text-green-800 text-[10px]">Pago</Badge>
                        </SelectItem>
                        <SelectItem value="Pendente">
                          <Badge className="bg-yellow-100 text-yellow-800 text-[10px]">Pendente</Badge>
                        </SelectItem>
                        <SelectItem value="Cancelado">
                          <Badge className="bg-gray-100 text-gray-600 text-[10px]">Cancelado</Badge>
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                      title="Visualizar/Editar detalhes"
                      onClick={(e) => {
                        e.stopPropagation();
                        abrirDetalhes(lanc);
                      }}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                      title="Excluir lançamento"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(lanc);
                      }}
                      disabled={!canDelete || deleteMutation.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8" style={{ color: '#8B8B8B' }}>
            <Calendar className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>Nenhum lançamento recorrente cadastrado</p>
            <p className="text-sm mt-1">
              Marque um lançamento como recorrente ao criá-lo para que seja gerado automaticamente
            </p>
          </div>
        )}

        <div className="flex justify-end pt-4 border-t" style={{ borderColor: '#E5E0D8' }}>
          <Button
            onClick={gerarLancamentosRecorrentes}
            disabled={!canManage || processing || recorrentes.length === 0}
            variant="outline"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${processing ? 'animate-spin' : ''}`} />
            {processing ? 'Processando...' : 'Gerar Manualmente'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}