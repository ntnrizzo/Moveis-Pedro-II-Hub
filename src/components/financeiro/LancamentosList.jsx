import { toast } from "sonner";
import { financialErrorMessage } from "@/lib/financialCapabilities";
import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";
import { formatBrazilDate, formatBrazilDateTime } from "@/lib/dateBrazil";
import {
  buildCategoriaFilterValue,
  DEFAULT_RECORRENCIA_TIPO,
  encerrarEExcluirRecorrencia,
  getLancamentoCategoriaLabel,
  isLancamentoRecorrente,
  lancamentoMatchesCategoriaFilter,
  normalizeCategoriaId,
  RECORRENCIA_OPTIONS,
} from "@/lib/financeiroRecorrencia";
import AlteracaoEmMassaModal from "@/components/financeiro/AlteracaoEmMassaModal";
import {
  TrendingUp,
  TrendingDown,
  Trash2,
  Eye,
  DollarSign,
  Search,
  Filter,
  Receipt,
  Loader2,
  Pencil,
  Upload,
  Save,
  AlertTriangle,
  CheckSquare
} from "lucide-react";

// Formata dígitos digitados em moeda brasileira: "150050" → "1.500,50"
const formatCurrencyMask = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  const padded = digits.padStart(3, "0");
  const cents = padded.slice(-2);
  const intPart = padded.slice(0, -2).replace(/^0+(?=\d)/, "") || "0";
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${intFormatted},${cents}`;
};

// Normaliza texto para comparação insensível a maiúsculas/minúsculas, acentos e múltiplos espaços
const normalizeTextForComparison = (text) => {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos/diacríticos
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ") // Converte non-breaking e zero-width spaces
    .replace(/\s+/g, " ") // Colapsa múltiplos espaços em um único
    .trim()
    .toLowerCase();
};

// Faz o parsing seguro de valores digitados em moeda (aceita pt-BR "1.281,70" e float "1281.70")
const parseMoneyForComparison = (raw) => {
  if (typeof raw === "number") return raw;
  if (!raw) return NaN;
  let str = String(raw).trim().replace(/[^\d.,-]/g, "");
  if (!str) return NaN;
  if (str.includes(",") && str.includes(".")) {
    if (str.indexOf(".") < str.indexOf(",")) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (str.includes(",")) {
    str = str.replace(",", ".");
  }
  return parseFloat(str);
};

export default function LancamentosList({ lancamentos = [], categorias = [], isLoading, onlyModal = false }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user, can } = useAuth();
  const canManage = can("manage_financeiro");
  const canDelete = can("delete_financial_entry");
  const [selectedLancamento, setSelectedLancamento] = useState(null);
  const [isDetalhesOpen, setIsDetalhesOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [detalhesError, setDetalhesError] = useState("");
  const [uploadingAnexo, setUploadingAnexo] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

  // Estado do modal de confirmação rígida para excluir lançamentos pagos
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmNome, setDeleteConfirmNome] = useState("");
  const [deleteConfirmValor, setDeleteConfirmValor] = useState("");
  const [deleteConfirmError, setDeleteConfirmError] = useState("");
  const [detalhesForm, setDetalhesForm] = useState({
    tipo: "Entrada",
    categoria_id: "",
    categoria_nome: "",
    descricao: "",
    valor: "",
    data_lancamento: "",
    data_lancamento_real: "",
    data_vencimento: "",
    forma_pagamento: "Dinheiro",
    status: "Pendente",
    observacao: "",
    recorrente: false,
    recorrencia_tipo: DEFAULT_RECORRENCIA_TIPO,
    anexo_url: ""
  });

  // Filtros
  const [busca, setBusca] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [categoriaFiltro, setCategoriaFiltro] = useState("todos");

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

  const { data: paidAuditLogs = [] } = useQuery({
    queryKey: ['audit-mark-paid', user?.organization_id, user?.id],
    queryFn: async () => await base44.entities.AuditLog.list('-created_at') || [],
    staleTime: 30000,
  });

  const paidDeclarationByLancamento = useMemo(() => {
    const map = {};

    const toKey = (value) => String(value ?? "").trim();

    (paidAuditLogs || []).forEach((log) => {
      const action = log.acao || log.action;
      const tabela = log.tabela || log.table_name;
      if (action !== 'MARK_PAID') return;
      if (tabela && tabela !== 'lancamentos_financeiros') return;

      const recordId = log?.detalhes?.record_id || log.record_id || log.entity_id;
      const recordKey = toKey(recordId);
      if (!recordKey) return;

      const timestamp = log.created_at || log.timestamp;
      const ts = timestamp ? new Date(timestamp).getTime() : 0;
      const current = map[recordKey];

      if (!current || ts > current._ts) {
        map[recordKey] = {
          nome: log.usuario || log.user_name || 'Usuário desconhecido',
          em: timestamp,
          _ts: ts,
        };
      }
    });

    return map;
  }, [paidAuditLogs]);

  const selectedPaidDeclaration = useMemo(() => {
    const key = String(selectedLancamento?.id ?? "").trim();
    if (!key) return null;
    return paidDeclarationByLancamento[key] || null;
  }, [selectedLancamento, paidDeclarationByLancamento]);

  const categoriasFiltro = useMemo(() => {
    const seen = new Set();
    const options = [];

    categorias.forEach((categoria) => {
      const value = buildCategoriaFilterValue(categoria);
      if (!value || seen.has(value)) return;
      seen.add(value);
      options.push({ value, label: categoria.nome || "Sem nome" });
    });

    return options;
  }, [categorias]);

  const handleStatusChange = async (id, newStatus) => {
    if (!canManage) return;
    const lanc = lancamentos.find((item) => item.id === id);
    if (!lanc) return;

    const previousStatus = lanc.status || 'Pendente';
    const isMarkingAsPaid = newStatus === 'Pago' && previousStatus !== 'Pago';

    if (isMarkingAsPaid) {
      const confirmed = await confirm({
        title: 'Confirmar pagamento',
        message: `Confirmar ${lanc.descricao || 'conta'} (${lanc.categoria_nome || 'Sem categoria'} · ${formatMoney(lanc.valor)} · vence ${formatDate(lanc.data_vencimento)}) como pago?`,
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

  const normalizarTipo = (tipo) => {
    if (tipo === "receita" || tipo === "Entrada") return "Entrada";
    return "Saída";
  };

  const abrirDetalhes = (lanc) => {
    if (!onlyModal) {
      window.dispatchEvent(new CustomEvent("openLancamentoDetalhes", { detail: lanc }));
      return;
    }
    const tipoNormalizado = normalizarTipo(lanc.tipo);
    setSelectedLancamento(lanc);
    setIsEditing(false);
    setDetalhesError("");
    setDetalhesForm({
      tipo: tipoNormalizado,
      categoria_id: lanc.categoria_id || "",
      categoria_nome: lanc.categoria_nome || "",
      descricao: lanc.descricao || "",
      valor: String(lanc.valor ?? ""),
      data_lancamento: lanc.data_lancamento || "",
      data_lancamento_real: lanc.data_lancamento_real || "",
      data_vencimento: lanc.data_vencimento || "",
      forma_pagamento: lanc.forma_pagamento || "Dinheiro",
      status: lanc.status || "Pendente",
      observacao: lanc.observacao || "",
      recorrente: Boolean(lanc.recorrente),
      recorrencia_tipo: lanc.recorrencia_tipo || DEFAULT_RECORRENCIA_TIPO,
      anexo_url: lanc.anexo_url || ""
    });
    setIsDetalhesOpen(true);
  };

  useEffect(() => {
    if (!onlyModal) return;

    const handleOpenModal = (e) => {
      if (e.detail) abrirDetalhes(e.detail);
    };
    window.addEventListener("openLancamentoDetalhes", handleOpenModal);
    return () => window.removeEventListener("openLancamentoDetalhes", handleOpenModal);
  }, [onlyModal]);

  const handleCloseDetalhes = (open) => {
    setIsDetalhesOpen(open);
    if (!open) {
      setIsEditing(false);
      setDetalhesError("");
      setSelectedLancamento(null);
    }
  };

  const handleAnexoUpload = async (event) => {
    if (!canManage) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingAnexo(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setDetalhesForm((prev) => ({ ...prev, anexo_url: file_url }));
    } catch {
      setDetalhesError("Erro ao fazer upload do anexo. Tente novamente.");
    } finally {
      setUploadingAnexo(false);
    }
  };

  const handleSaveDetalhes = () => {
    if (!canManage) return;
    if (!selectedLancamento) return;
    setDetalhesError("");

    if (!detalhesForm.descricao?.trim()) {
      setDetalhesError("A descrição é obrigatória.");
      return;
    }

    const valorNumerico = parseFloat(detalhesForm.valor);
    if (Number.isNaN(valorNumerico) || valorNumerico <= 0) {
      setDetalhesError("Informe um valor válido maior que zero.");
      return;
    }

    if (!detalhesForm.data_lancamento) {
      setDetalhesError("A data do lançamento é obrigatória.");
      return;
    }

    if (detalhesForm.tipo === "Saída" && !detalhesForm.data_vencimento) {
      setDetalhesError("Informe a data de vencimento para lançamentos de saída.");
      return;
    }

    const categoriaSelecionada = categorias.find(
      (cat) => normalizeCategoriaId(cat.id) === normalizeCategoriaId(detalhesForm.categoria_id)
    );

    const payload = {
      ...detalhesForm,
      tipo: detalhesForm.tipo,
      categoria_nome: categoriaSelecionada?.nome || detalhesForm.categoria_nome || "",
      valor: valorNumerico,
      data_lancamento_real: detalhesForm.data_lancamento_real || null,
      data_vencimento: detalhesForm.data_vencimento || null,
    };

    updateMutation.mutate(
      { id: selectedLancamento.id, data: payload },
      {
        onSuccess: () => {
          setSelectedLancamento((prev) => (prev ? { ...prev, ...payload } : prev));
          setIsEditing(false);
        },
        onError: (error) => {
          setDetalhesError(financialErrorMessage(error));
        }
      }
    );
  };

  // Abre o modal rígido de exclusão (para qualquer lançamento)
  const handleDelete = (lanc) => {
    if (!canDelete) return;
    setSelectedLancamento(lanc);
    setDeleteConfirmNome("");
    setDeleteConfirmValor("");
    setDeleteConfirmError("");
    setDeleteConfirmOpen(true);
  };

  // Alias usado dentro do modal de detalhes
  const abrirDeletePago = () => {
    if (!canDelete) return;
    setDeleteConfirmNome("");
    setDeleteConfirmValor("");
    setDeleteConfirmError("");
    setDeleteConfirmOpen(true);
  };

  // Valida e executa a exclusão do lançamento
  const confirmarDeletePago = () => {
    if (!canDelete) return;
    const lanc = selectedLancamento;
    if (!lanc) return;

    const nomeEsperado = normalizeTextForComparison(lanc.descricao);
    const nomeDigitado = normalizeTextForComparison(deleteConfirmNome);
    const valorEsperado = Math.abs(lanc.valor || 0);

    if (!nomeDigitado || nomeDigitado !== nomeEsperado) {
      setDeleteConfirmError("O nome digitado não corresponde ao lançamento.");
      return;
    }

    const valorDigitado = parseMoneyForComparison(deleteConfirmValor);
    if (isNaN(valorDigitado) || Math.abs(valorDigitado - valorEsperado) > 0.01) {
      setDeleteConfirmError("O valor digitado não corresponde ao lançamento.");
      return;
    }

    setDeleteConfirmOpen(false);
    setIsDetalhesOpen(false);
    deleteMutation.mutate(lanc);
  };

  // Separar impostos/taxas por categoria
  const isImpostoOuTaxa = (lanc) => {
    const categoriaNome = (getLancamentoCategoriaLabel(lanc, categorias) || "").toLowerCase();
    return categoriaNome.includes("imposto") || categoriaNome.includes("taxa") || categoriaNome.includes("tributo");
  };

  // Aplicar filtros
  const filtrarLancamentos = (lista) => {
    return lista.filter(lanc => {
      // Busca
      if (busca) {
        const termo = busca.toLowerCase();
        const matchDescricao = lanc.descricao?.toLowerCase().includes(termo);
        const categoriaLabel = getLancamentoCategoriaLabel(lanc, categorias);
        const matchCategoria = categoriaLabel?.toLowerCase().includes(termo);
        if (!matchDescricao && !matchCategoria) return false;
      }
      // Tipo
      if (tipoFiltro !== "todos") {
        const isEntrada = lanc.tipo === 'Entrada' || lanc.tipo === 'receita';
        if (tipoFiltro === "entrada" && !isEntrada) return false;
        if (tipoFiltro === "saida" && isEntrada) return false;
      }
      // Status
      if (statusFiltro !== "todos" && lanc.status !== statusFiltro) return false;
      // Categoria
      if (!lancamentoMatchesCategoriaFilter(lanc, categoriaFiltro)) return false;
      return true;
    });
  };

  const lancamentosNormais = filtrarLancamentos(lancamentos.filter(l => !isImpostoOuTaxa(l)));
  const impostosTaxas = filtrarLancamentos(lancamentos.filter(l => isImpostoOuTaxa(l)));

  const totalImpostos = impostosTaxas.reduce((sum, l) => sum + Math.abs(l.valor || 0), 0);

  const getStatusBadge = (status) => {
    const styles = {
      'Pago': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      'Pendente': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      'Cancelado': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return <Badge className={`text-[10px] ${styles[status] || ''}`}>{status}</Badge>;
  };

  // Componente de Select editável para status
  const StatusSelect = ({ lanc }) => {
    // Bloquear edição se lançamento está vinculado a uma venda
    const isVinculadoVenda = lanc.venda_id || lanc.numero_pedido;

    if (isVinculadoVenda) {
      return (
        <div
          className="flex items-center gap-1 cursor-not-allowed"
          title="Status vinculado à venda. Para alterar, cancele a venda."
        >
          {getStatusBadge(lanc.status)}
          <span className="text-[8px] text-gray-400">🔒</span>
        </div>
      );
    }

    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Select
          value={lanc.status || 'Pendente'}
          onValueChange={(value) => handleStatusChange(lanc.id, value)}
          disabled={!canManage || updateMutation.isPending}
        >
          <SelectTrigger className="h-7 w-[100px] text-[10px] border-0 bg-transparent hover:bg-gray-100 dark:hover:bg-neutral-800">
            <SelectValue>
              {getStatusBadge(lanc.status)}
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
              <Badge className="bg-red-100 text-red-800 text-[10px]">Cancelado</Badge>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  };

  const formatDate = (date) => formatBrazilDate(date);
  const formatDateTime = (date) => formatBrazilDateTime(date);
  const formatMoney = (valor) => `R$ ${Math.abs(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-green-600" />
      </div>
    );
  }

  // Tabela compacta
  const TabelaLancamentos = ({ dados, titulo, icone: Icone, corIcone }) => (
    <Card className="border-0 shadow-lg">
      <CardHeader className="pb-3 border-b">
        <CardTitle className="text-base flex items-center gap-2">
          <Icone className={`w-4 h-4 ${corIcone}`} />
          {titulo}
          <Badge variant="secondary" className="ml-2">{dados.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {dados.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">Nenhum lançamento encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 dark:bg-neutral-800">
                  <TableHead className="w-[100px] text-xs">Data</TableHead>
                  <TableHead className="w-[120px] text-xs">Vencimento</TableHead>
                  <TableHead className="text-xs">Descrição</TableHead>
                  <TableHead className="text-xs">Categoria</TableHead>
                  <TableHead className="text-xs text-right">Valor</TableHead>
                  <TableHead className="text-xs text-center">Status</TableHead>
                  <TableHead className="text-xs text-right w-[80px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dados.map((lanc) => {
                  const isEntrada = lanc.tipo === 'Entrada' || lanc.tipo === 'receita';
                  return (
                    <TableRow
                      key={lanc.id}
                      className="hover:bg-gray-50 dark:hover:bg-neutral-800/50 cursor-pointer"
                      onClick={() => abrirDetalhes(lanc)}
                    >
                      <TableCell className="text-xs text-gray-600 dark:text-gray-400">
                        {formatDate(lanc.data_lancamento)}
                      </TableCell>
                      <TableCell className="text-xs text-gray-600 dark:text-gray-400">
                        {lanc.data_vencimento
                          ? formatDate(lanc.data_vencimento)
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isEntrada ? 'bg-green-100' : 'bg-red-100'}`}>
                            {isEntrada ? <TrendingUp className="w-3 h-3 text-green-600" /> : <TrendingDown className="w-3 h-3 text-red-600" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{lanc.descricao}</p>
                            {lanc.observacao && <p className="text-[10px] text-gray-400 truncate">{lanc.observacao}</p>}
                            {lanc.status === 'Pago' && paidDeclarationByLancamento[String(lanc.id)] && (
                              <p className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate">
                                Declarado como pago por {paidDeclarationByLancamento[String(lanc.id)].nome} as {formatDateTime(paidDeclarationByLancamento[String(lanc.id)].em)}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-500">{lanc.categoria_nome || '-'}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`text-sm font-bold ${isEntrada ? 'text-green-600' : 'text-red-600'}`}>
                          {isEntrada ? '+' : '-'}{formatMoney(lanc.valor)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <StatusSelect lanc={lanc} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirDetalhes(lanc);
                            }}
                          >
                            <Eye className="w-3 h-3 text-blue-500" />
                          </Button>
                          {lanc.anexo_url && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(lanc.anexo_url, '_blank');
                              }}
                            >
                              <Eye className="w-3 h-3 text-blue-500" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(lanc);
                            }}
                            disabled={!canDelete || deleteMutation.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (onlyModal) {
    return (
      <Dialog open={isDetalhesOpen} onOpenChange={handleCloseDetalhes}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <DialogTitle>Detalhes do lançamento</DialogTitle>
                <DialogDescription>
                  Visualize todas as informações e, se necessário, edite os dados do lançamento.
                </DialogDescription>
              </div>
              <Button
                type="button"
                disabled={!canManage}
                variant={isEditing ? "secondary" : "outline"}
                onClick={() => {
                  setDetalhesError("");
                  setIsEditing((prev) => !prev);
                }}
              >
                <Pencil className="w-4 h-4 mr-2" />
                {isEditing ? "Cancelar edição" : "Editar"}
              </Button>
            </div>
          </DialogHeader>

          {selectedLancamento && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.tipo}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, tipo: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Entrada">Entrada</SelectItem>
                        <SelectItem value="Saída">Saída</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.tipo}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Status</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.status}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, status: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pago">Pago</SelectItem>
                        <SelectItem value="Pendente">Pendente</SelectItem>
                        <SelectItem value="Cancelado">Cancelado</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div>{getStatusBadge(detalhesForm.status)}</div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Descrição</Label>
                {isEditing ? (
                  <Input
                    value={detalhesForm.descricao}
                    onChange={(e) => setDetalhesForm((prev) => ({ ...prev, descricao: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.descricao || "-"}</p>
                )}
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Valor (R$)</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={detalhesForm.valor}
                      onChange={(e) => setDetalhesForm((prev) => ({ ...prev, valor: e.target.value }))}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{formatMoney(detalhesForm.valor)}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Data do lançamento</Label>
                  {isEditing ? (
                    <Input
                      type="date" lang="pt-BR"
                      value={detalhesForm.data_lancamento || ""}
                      onChange={(e) => setDetalhesForm((prev) => ({ ...prev, data_lancamento: e.target.value }))}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(detalhesForm.data_lancamento)}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Data de vencimento</Label>
                  {isEditing ? (
                    <Input
                      type="date" lang="pt-BR"
                      value={detalhesForm.data_vencimento || ""}
                      onChange={(e) => setDetalhesForm((prev) => ({ ...prev, data_vencimento: e.target.value }))}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(detalhesForm.data_vencimento)}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Data de pagamento real</Label>
                {isEditing ? (
                  <Input
                    type="date" lang="pt-BR"
                    value={detalhesForm.data_lancamento_real || ""}
                    onChange={(e) => setDetalhesForm((prev) => ({ ...prev, data_lancamento_real: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(detalhesForm.data_lancamento_real)}</p>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Categoria</Label>
                  {isEditing ? (
                    <Select
                      value={normalizeCategoriaId(detalhesForm.categoria_id) || "sem-categoria"}
                      onValueChange={(value) => {
                        if (value === "sem-categoria") {
                          setDetalhesForm((prev) => ({ ...prev, categoria_id: "", categoria_nome: "" }));
                          return;
                        }
                        const categoria = categorias.find((cat) => normalizeCategoriaId(cat.id) === value);
                        setDetalhesForm((prev) => ({
                          ...prev,
                          categoria_id: value,
                          categoria_nome: categoria?.nome || prev.categoria_nome
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sem-categoria">Sem categoria</SelectItem>
                        {categorias.map((cat) => (
                          <SelectItem key={cat.id} value={normalizeCategoriaId(cat.id)}>{cat.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.categoria_nome || "-"}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Forma de pagamento</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.forma_pagamento || "Dinheiro"}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, forma_pagamento: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="Crédito">Crédito</SelectItem>
                        <SelectItem value="Débito">Débito</SelectItem>
                        <SelectItem value="Pix">Pix</SelectItem>
                        <SelectItem value="Transferência">Transferência</SelectItem>
                        <SelectItem value="Boleto">Boleto</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.forma_pagamento || "-"}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Observações</Label>
                {isEditing ? (
                  <Textarea
                    rows={3}
                    value={detalhesForm.observacao}
                    onChange={(e) => setDetalhesForm((prev) => ({ ...prev, observacao: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{detalhesForm.observacao || "-"}</p>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Recorrente</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.recorrente ? "sim" : "nao"}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, recorrente: value === "sim" }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sim">Sim</SelectItem>
                        <SelectItem value="nao">Não</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.recorrente ? "Sim" : "Não"}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Periodicidade</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.recorrencia_tipo || DEFAULT_RECORRENCIA_TIPO}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, recorrencia_tipo: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RECORRENCIA_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.recorrencia_tipo || "-"}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Comprovante / documento</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {detalhesForm.anexo_url ? (
                    <Button type="button" variant="outline" onClick={() => window.open(detalhesForm.anexo_url, "_blank")}>
                      <Eye className="w-4 h-4 mr-2" />
                      Ver anexo atual
                    </Button>
                  ) : (
                    <p className="text-sm text-gray-500">Sem anexo</p>
                  )}

                  {isEditing && (
                    <>
                      <Label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-sm hover:bg-gray-50">
                        <Upload className="w-4 h-4" />
                        {uploadingAnexo ? "Enviando..." : "Anexar comprovante"}
                        <Input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          disabled={uploadingAnexo}
                          onChange={handleAnexoUpload}
                        />
                      </Label>
                      {detalhesForm.anexo_url && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setDetalhesForm((prev) => ({ ...prev, anexo_url: "" }))}
                        >
                          Remover anexo
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 text-xs text-gray-500">
                <p><strong>ID:</strong> {selectedLancamento.id}</p>
                <p><strong>Criado em:</strong> {formatDate(selectedLancamento.created_at)}</p>
                <p><strong>Pago por:</strong> {selectedPaidDeclaration?.nome || '-'}</p>
                <p><strong>Pago em:</strong> {selectedPaidDeclaration?.em ? formatDateTime(selectedPaidDeclaration.em) : '-'}</p>
                <p><strong>Pedido:</strong> {selectedLancamento.numero_pedido || '-'}</p>
                <p><strong>Venda vinculada:</strong> {selectedLancamento.venda_id || '-'}</p>
              </div>

              {detalhesError && (
                <p className="text-sm text-red-600">{detalhesError}</p>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                {/* Botão destrutivo: só visível para lançamentos pagos e fora do modo edição */}
                {!isEditing && selectedLancamento?.status === "Pago" && (
                  <Button
                    type="button"
                    variant="destructive"
                    className="flex items-center gap-2 opacity-90 hover:opacity-100"
                    onClick={abrirDeletePago}
                    disabled={!canDelete || deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    Cancelar e Excluir
                  </Button>
                )}
                <div className="flex-1" />
                {isEditing && (
                  <Button type="button" onClick={handleSaveDetalhes} disabled={!canManage || updateMutation.isPending || uploadingAnexo}>
                    <Save className="w-4 h-4 mr-2" />
                    {updateMutation.isPending ? "Salvando..." : "Salvar alterações"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de Busca e Filtros */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar por descrição ou categoria..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
              <SelectTrigger className="w-[130px] h-9">
                <Filter className="w-3 h-3 mr-1" />
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="entrada">Entradas</SelectItem>
                <SelectItem value="saida">Saídas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFiltro} onValueChange={setStatusFiltro}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="Pago">Pago</SelectItem>
                <SelectItem value="Pendente">Pendente</SelectItem>
                <SelectItem value="Cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas Categorias</SelectItem>
                {categoriasFiltro.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex-1" />

            <Button
              type="button"
              disabled={!canManage}
              onClick={() => { if (canManage) setIsBulkModalOpen(true); }}
              variant="outline"
              className="h-9 gap-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/40 font-semibold"
            >
              <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Alterar em Massa
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Modal de Alteração em Massa */}
      <AlteracaoEmMassaModal
        open={isBulkModalOpen}
        onOpenChange={setIsBulkModalOpen}
        lancamentos={lancamentos}
        categorias={categorias}
      />

      {/* Tabela de Lançamentos Normais */}
      <TabelaLancamentos
        dados={lancamentosNormais}
        titulo="Lançamentos"
        icone={DollarSign}
        corIcone="text-green-600"
      />

      {/* Tabela de Impostos & Taxas */}
      {impostosTaxas.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <Receipt className="w-4 h-4" />
              Impostos & Taxas
            </h3>
            <span className="text-sm font-bold text-red-600">
              Total: {formatMoney(totalImpostos)}
            </span>
          </div>
          <TabelaLancamentos
            dados={impostosTaxas}
            titulo="Impostos & Taxas"
            icone={Receipt}
            corIcone="text-orange-600"
          />
        </div>
      )}

      <Dialog open={isDetalhesOpen} onOpenChange={handleCloseDetalhes}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <DialogTitle>Detalhes do lançamento</DialogTitle>
                <DialogDescription>
                  Visualize todas as informações e, se necessário, edite os dados do lançamento.
                </DialogDescription>
              </div>
              <Button
                type="button"
                disabled={!canManage}
                variant={isEditing ? "secondary" : "outline"}
                onClick={() => {
                  setDetalhesError("");
                  setIsEditing((prev) => !prev);
                }}
              >
                <Pencil className="w-4 h-4 mr-2" />
                {isEditing ? "Cancelar edição" : "Editar"}
              </Button>
            </div>
          </DialogHeader>

          {selectedLancamento && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.tipo}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, tipo: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Entrada">Entrada</SelectItem>
                        <SelectItem value="Saída">Saída</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.tipo}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Status</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.status}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, status: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pago">Pago</SelectItem>
                        <SelectItem value="Pendente">Pendente</SelectItem>
                        <SelectItem value="Cancelado">Cancelado</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div>{getStatusBadge(detalhesForm.status)}</div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Descrição</Label>
                {isEditing ? (
                  <Input
                    value={detalhesForm.descricao}
                    onChange={(e) => setDetalhesForm((prev) => ({ ...prev, descricao: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.descricao || "-"}</p>
                )}
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Valor (R$)</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={detalhesForm.valor}
                      onChange={(e) => setDetalhesForm((prev) => ({ ...prev, valor: e.target.value }))}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{formatMoney(detalhesForm.valor)}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Data do lançamento</Label>
                  {isEditing ? (
                    <Input
                      type="date" lang="pt-BR"
                      value={detalhesForm.data_lancamento || ""}
                      onChange={(e) => setDetalhesForm((prev) => ({ ...prev, data_lancamento: e.target.value }))}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(detalhesForm.data_lancamento)}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Data de vencimento</Label>
                  {isEditing ? (
                    <Input
                      type="date" lang="pt-BR"
                      value={detalhesForm.data_vencimento || ""}
                      onChange={(e) => setDetalhesForm((prev) => ({ ...prev, data_vencimento: e.target.value }))}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(detalhesForm.data_vencimento)}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Data de pagamento real</Label>
                {isEditing ? (
                  <Input
                    type="date" lang="pt-BR"
                    value={detalhesForm.data_lancamento_real || ""}
                    onChange={(e) => setDetalhesForm((prev) => ({ ...prev, data_lancamento_real: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(detalhesForm.data_lancamento_real)}</p>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Categoria</Label>
                  {isEditing ? (
                    <Select
                      value={normalizeCategoriaId(detalhesForm.categoria_id) || "sem-categoria"}
                      onValueChange={(value) => {
                        if (value === "sem-categoria") {
                          setDetalhesForm((prev) => ({ ...prev, categoria_id: "", categoria_nome: "" }));
                          return;
                        }
                        const categoria = categorias.find((cat) => normalizeCategoriaId(cat.id) === value);
                        setDetalhesForm((prev) => ({
                          ...prev,
                          categoria_id: value,
                          categoria_nome: categoria?.nome || prev.categoria_nome
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sem-categoria">Sem categoria</SelectItem>
                        {categorias.map((cat) => (
                          <SelectItem key={cat.id} value={normalizeCategoriaId(cat.id)}>{cat.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.categoria_nome || "-"}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Forma de pagamento</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.forma_pagamento || "Dinheiro"}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, forma_pagamento: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="Crédito">Crédito</SelectItem>
                        <SelectItem value="Débito">Débito</SelectItem>
                        <SelectItem value="Pix">Pix</SelectItem>
                        <SelectItem value="Transferência">Transferência</SelectItem>
                        <SelectItem value="Boleto">Boleto</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.forma_pagamento || "-"}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Observações</Label>
                {isEditing ? (
                  <Textarea
                    rows={3}
                    value={detalhesForm.observacao}
                    onChange={(e) => setDetalhesForm((prev) => ({ ...prev, observacao: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{detalhesForm.observacao || "-"}</p>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Recorrente</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.recorrente ? "sim" : "nao"}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, recorrente: value === "sim" }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sim">Sim</SelectItem>
                        <SelectItem value="nao">Não</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.recorrente ? "Sim" : "Não"}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Periodicidade</Label>
                  {isEditing ? (
                    <Select
                      value={detalhesForm.recorrencia_tipo || DEFAULT_RECORRENCIA_TIPO}
                      onValueChange={(value) => setDetalhesForm((prev) => ({ ...prev, recorrencia_tipo: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RECORRENCIA_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{detalhesForm.recorrencia_tipo || "-"}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Comprovante / documento</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {detalhesForm.anexo_url ? (
                    <Button type="button" variant="outline" onClick={() => window.open(detalhesForm.anexo_url, "_blank")}>
                      <Eye className="w-4 h-4 mr-2" />
                      Ver anexo atual
                    </Button>
                  ) : (
                    <p className="text-sm text-gray-500">Sem anexo</p>
                  )}

                  {isEditing && (
                    <>
                      <Label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-sm hover:bg-gray-50">
                        <Upload className="w-4 h-4" />
                        {uploadingAnexo ? "Enviando..." : "Anexar comprovante"}
                        <Input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          disabled={uploadingAnexo}
                          onChange={handleAnexoUpload}
                        />
                      </Label>
                      {detalhesForm.anexo_url && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setDetalhesForm((prev) => ({ ...prev, anexo_url: "" }))}
                        >
                          Remover anexo
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 text-xs text-gray-500">
                <p><strong>ID:</strong> {selectedLancamento.id}</p>
                <p><strong>Criado em:</strong> {formatDate(selectedLancamento.created_at)}</p>
                <p><strong>Pago por:</strong> {selectedPaidDeclaration?.nome || '-'}</p>
                <p><strong>Pago em:</strong> {selectedPaidDeclaration?.em ? formatDateTime(selectedPaidDeclaration.em) : '-'}</p>
                <p><strong>Pedido:</strong> {selectedLancamento.numero_pedido || '-'}</p>
                <p><strong>Venda vinculada:</strong> {selectedLancamento.venda_id || '-'}</p>
              </div>

              {detalhesError && (
                <p className="text-sm text-red-600">{detalhesError}</p>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                {/* Botão destrutivo: só visível para lançamentos pagos e fora do modo edição */}
                {!isEditing && selectedLancamento?.status === "Pago" && (
                  <Button
                    type="button"
                    variant="destructive"
                    className="flex items-center gap-2 opacity-90 hover:opacity-100"
                    onClick={abrirDeletePago}
                    disabled={!canDelete || deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    Cancelar e Excluir
                  </Button>
                )}
                <div className="flex-1" />
                {isEditing && (
                  <Button type="button" onClick={handleSaveDetalhes} disabled={!canManage || updateMutation.isPending || uploadingAnexo}>
                    <Save className="w-4 h-4 mr-2" />
                    {updateMutation.isPending ? "Salvando..." : "Salvar alterações"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de confirmação rígida: excluir lançamento */}
      <Dialog open={deleteConfirmOpen} onOpenChange={(open) => {
        if (!open) setDeleteConfirmOpen(false);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <DialogTitle className="text-red-700 dark:text-red-400">Excluir lançamento</DialogTitle>
                <DialogDescription>
                  Esta ação é <strong>irreversível</strong>. O lançamento será permanentemente excluído.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedLancamento && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <p><span className="font-semibold text-gray-700 dark:text-gray-300">Lançamento:</span> {selectedLancamento.descricao}</p>
                    <p><span className="font-semibold text-gray-700 dark:text-gray-300">Valor:</span> {formatMoney(selectedLancamento.valor)}</p>
                    <p><span className="font-semibold text-gray-700 dark:text-gray-300">Status:</span> {selectedLancamento.status || "Pendente"}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-700 dark:text-red-300 flex-shrink-0"
                    onClick={() => {
                      setDeleteConfirmNome(selectedLancamento.descricao || "");
                      const val = Math.abs(selectedLancamento.valor || 0);
                      setDeleteConfirmValor(formatCurrencyMask(String(Math.round(val * 100))));
                      setDeleteConfirmError("");
                    }}
                  >
                    Preencher campos
                  </Button>
                </div>
              </div>

              {isLancamentoRecorrente(selectedLancamento) && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    Atenção: Lançamento Recorrente
                  </p>
                  <p>
                    Ao confirmar, esta ocorrência e <strong>todas as ocorrências futuras desta recorrência serão encerradas/excluídas</strong> a partir desta data ({formatBrazilDate(selectedLancamento.data_vencimento || selectedLancamento.data_lancamento)}).
                  </p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Os lançamentos recorrentes anteriores a esta data continuarão mantidos no seu histórico.
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  1. Digite o <span className="font-bold">nome exato</span> do lançamento para confirmar:
                </Label>
                <Input
                  placeholder={selectedLancamento.descricao}
                  value={deleteConfirmNome}
                  onChange={(e) => { setDeleteConfirmNome(e.target.value); setDeleteConfirmError(""); }}
                  className="border-red-300 focus:ring-red-500"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  2. Digite o <span className="font-bold">valor exato</span> do lançamento (ex: {Math.abs(selectedLancamento.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}):
                </Label>
                <Input
                  placeholder="0,00"
                  value={deleteConfirmValor}
                  onChange={(e) => {
                    setDeleteConfirmValor(formatCurrencyMask(e.target.value));
                    setDeleteConfirmError("");
                  }}
                  className="border-red-300 focus:ring-red-500"
                />
              </div>

              {deleteConfirmError && (
                <p className="text-sm text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {deleteConfirmError}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteConfirmOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={confirmarDeletePago}
                  disabled={!canDelete || deleteMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {deleteMutation.isPending ? "Excluindo..." : "Confirmar exclusão"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}