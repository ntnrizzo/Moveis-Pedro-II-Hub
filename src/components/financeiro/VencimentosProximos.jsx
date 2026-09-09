
import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { TrendingDown, Calendar, AlertTriangle, Clock, Siren, ChevronDown } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";
import { base44 } from "@/lib/supabase";
import { isStatusCancelado } from "@/utils/vendaStatus";
import { DEFAULT_RECORRENCIA_TIPO, isLancamentoSugestaoRecorrencia } from "@/lib/financeiroRecorrencia";

const fmt = (v) =>
  `R$ ${Math.abs(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function diffDays(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

function semanaLabel(date) {
  const d = new Date(date + "T00:00:00");
  const start = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const end = new Date(d);
  end.setDate(end.getDate() + 6 - ((end.getDay() + 6) % 7)); // domingo da semana
  // find monday
  const monday = new Date(d);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 6);
  return `Semana de ${monday.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} a ${friday.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

// Returns ISO week key "YYYY-Www" for grouping
function weekKey(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const monday = new Date(d);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function ItemRow({ lanc, onStatusChange, onEnableRecurring, updating, recurringUpdateId }) {
  const { can } = useAuth();
  const canManage = can("manage_financeiro");
  const venc = lanc.data_vencimento
    ? new Date(lanc.data_vencimento + "T00:00:00").toLocaleDateString("pt-BR")
    : "—";
  const podeSugerirRecorrencia = isLancamentoSugestaoRecorrencia(lanc);
  const salvandoRecorrencia = recurringUpdateId === lanc.id;

  return (
    <div 
      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800/60 group cursor-pointer"
      onClick={() => window.dispatchEvent(new CustomEvent("openLancamentoDetalhes", { detail: lanc }))}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
          <TrendingDown className="w-3.5 h-3.5 text-red-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {lanc.descricao || "—"}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {lanc.categoria_nome || "—"} · {lanc.forma_pagamento || "—"} · vence {venc}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-3 flex-shrink-0">
        <span className="text-sm font-bold text-red-600">{fmt(lanc.valor)}</span>
        {lanc.recorrente ? (
          <Badge className="bg-blue-100 text-blue-800 text-[10px]">Recorrente</Badge>
        ) : null}
        {podeSugerirRecorrencia ? (
          <Button
            type="button"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            disabled={!canManage || salvandoRecorrencia}
            onClick={(e) => {
              e.stopPropagation();
              onEnableRecurring(lanc);
            }}
          >
            {salvandoRecorrencia ? "Salvando..." : "Marcar recorrente"}
          </Button>
        ) : null}
        {lanc.status === "Pendente" ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Select
              value={lanc.status}
              onValueChange={(value) => onStatusChange(lanc, value)}
              disabled={!canManage || updating}
            >
              <SelectTrigger className="h-6 w-[90px] text-[10px] border-0 bg-transparent hover:bg-gray-100 dark:hover:bg-neutral-800">
                <SelectValue>
                  <Badge className="bg-yellow-100 text-yellow-800 text-[10px]">Pendente</Badge>
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
          </div>
        ) : (
          <Badge
            className={
              lanc.status === "Pago"
                ? "bg-green-100 text-green-800 text-[10px]"
                : isStatusCancelado(lanc.status)
                ? "bg-gray-100 text-gray-600 text-[10px]"
                : "bg-yellow-100 text-yellow-800 text-[10px]"
            }
          >
            {lanc.status || "Pendente"}
          </Badge>
        )}
      </div>
    </div>
  );
}

function Grupo({ titulo, icon: Icon, cor, items, total, onStatusChange, onEnableRecurring, updatingId, recurringUpdateId, defaultAberto = false }) {
  const [aberto, setAberto] = useState(defaultAberto);
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className="w-full flex items-center justify-between px-1 py-1 group"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${cor}`} />
          <span className={`text-xs font-semibold uppercase tracking-wide ${cor}`}>{titulo}</span>
          <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-red-600">{fmt(total)}</span>
          <span className="text-gray-300 text-xs">{aberto ? "▲" : "▼"}</span>
        </div>
      </button>
      {aberto && (
        <div className="border rounded-xl overflow-hidden divide-y dark:divide-neutral-700">
          {items.map((l) => (
            <ItemRow
              key={l.id}
              lanc={l}
              onStatusChange={onStatusChange}
              onEnableRecurring={onEnableRecurring}
              updating={updatingId === l.id}
              recurringUpdateId={recurringUpdateId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function VencimentosProximos({ lancamentos = [] }) {
  const hoje = startOfDay(new Date());
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user, can } = useAuth();
  const canManage = can("manage_financeiro");
  const [updatingId, setUpdatingId] = useState(null);
  const [recurringUpdateId, setRecurringUpdateId] = useState(null);
  const [visibleWeeks, setVisibleWeeks] = useState(3);

  const grupos = useMemo(() => {
    const pendentes = lancamentos.filter(
      (l) =>
        l.data_vencimento &&
        (l.tipo === "Saída" || l.tipo === "saida") &&
        l.status !== "Pago" &&
        !isStatusCancelado(l.status)
    );

    const atrasados = [];
    const hojeItems = [];
    const amanha = [];
    const ate3 = [];
    const de3a5 = [];
    const semanas = {};

    pendentes.forEach((l) => {
      const dias = diffDays(hoje, new Date(l.data_vencimento + "T00:00:00"));
      if (dias < 0) {
        atrasados.push(l);
      } else if (dias === 0) {
        hojeItems.push(l);
      } else if (dias === 1) {
        amanha.push(l);
      } else if (dias <= 3) {
        ate3.push(l);
      } else if (dias <= 5) {
        de3a5.push(l);
      } else {
        const key = weekKey(l.data_vencimento);
        if (!semanas[key]) semanas[key] = [];
        semanas[key].push(l);
      }
    });

    const semanasOrdenadas = Object.entries(semanas)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        key,
        label: semanaLabel(key),
        items: items.sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento)),
        total: items.reduce((s, i) => s + Math.abs(i.valor || 0), 0),
      }));

    return { atrasados, hojeItems, amanha, ate3, de3a5, semanasOrdenadas };
  }, [lancamentos, hoje]);

  const totalAtrasados = grupos.atrasados.reduce((s, l) => s + Math.abs(l.valor || 0), 0);
  const totalHoje = grupos.hojeItems.reduce((s, l) => s + Math.abs(l.valor || 0), 0);
  const totalAmanha = grupos.amanha.reduce((s, l) => s + Math.abs(l.valor || 0), 0);
  const totalAte3 = grupos.ate3.reduce((s, l) => s + Math.abs(l.valor || 0), 0);
  const totalDe3a5 = grupos.de3a5.reduce((s, l) => s + Math.abs(l.valor || 0), 0);

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => base44.entities.LancamentoFinanceiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lancamentos-financeiros"] });
      setUpdatingId(null);
    },
    onError: () => setUpdatingId(null)
  });

  const recorrenciaMutation = useMutation({
    mutationFn: async ({ id, data }) => base44.entities.LancamentoFinanceiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lancamentos-financeiros"] });
      setRecurringUpdateId(null);
    },
    onError: () => setRecurringUpdateId(null)
  });

  const handleStatusChange = async (lanc, newStatus) => {
    if (!canManage) return;
    if (lanc.status === newStatus) return;
    const previousStatus = lanc.status || "Pendente";
    const isMarkingAsPaid = newStatus === "Pago" && previousStatus !== "Pago";
    let confirmed = true;
    if (isMarkingAsPaid) {
      confirmed = await confirm({
        title: "Confirmar pagamento",
        message: `Confirmar ${lanc.descricao || "conta"} (${lanc.categoria_nome || "Sem categoria"} · R$ ${Math.abs(lanc.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · vence ${lanc.data_vencimento}) como pago?`,
        confirmText: "Confirmar pagamento",
        cancelText: "Cancelar",
        variant: "default",
      });
    }
    if (!confirmed) return;
    setUpdatingId(lanc.id);
    updateMutation.mutate(
      { id: lanc.id, data: { status: newStatus } },
      {
        onSuccess: async () => {
          if (!isMarkingAsPaid) return;
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
                to_status: newStatus,
              },
            });
            queryClient.invalidateQueries({ queryKey: ["audit-mark-paid"] });
          } catch (error) {
            // erro de log não bloqueia
          }
        },
        onError: () => setUpdatingId(null)
      }
    );
  };

  const handleEnableRecurring = async (lanc) => {
    if (!canManage) return;
    if (!lanc?.id || lanc.recorrente) return;

    const confirmed = await confirm({
      title: "Ativar recorrência",
      message: `Marcar ${lanc.descricao || "lançamento"} como recorrente para gerar os próximos vencimentos automaticamente?`,
      confirmText: "Ativar",
      cancelText: "Cancelar",
      variant: "default",
    });

    if (!confirmed) return;
    setRecurringUpdateId(lanc.id);

    recorrenciaMutation.mutate({
      id: lanc.id,
      data: {
        recorrente: true,
        recorrencia_tipo: lanc.recorrencia_tipo || DEFAULT_RECORRENCIA_TIPO,
      },
    });
  };

  const temAlgum =
    grupos.atrasados.length > 0 ||
    grupos.hojeItems.length > 0 ||
    grupos.amanha.length > 0 ||
    grupos.ate3.length > 0 ||
    grupos.de3a5.length > 0 ||
    grupos.semanasOrdenadas.length > 0;

  if (!temAlgum) return null;

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="pb-3 border-b">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="w-4 h-4 text-orange-500" />
          Vencimentos Próximos
          <span className="text-xs text-gray-400 font-normal">(saídas pendentes)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <Grupo
          titulo="Atrasados"
          icon={Siren}
          cor="text-red-700"
          items={grupos.atrasados}
          total={totalAtrasados}
          onStatusChange={handleStatusChange}
          onEnableRecurring={handleEnableRecurring}
          updatingId={updatingId}
          recurringUpdateId={recurringUpdateId}
        />
        <Grupo
          titulo="Vencendo hoje"
          icon={AlertTriangle}
          cor="text-red-600"
          items={grupos.hojeItems}
          total={totalHoje}
          onStatusChange={handleStatusChange}
          onEnableRecurring={handleEnableRecurring}
          updatingId={updatingId}
          recurringUpdateId={recurringUpdateId}
        />
        <Grupo
          titulo="Vencendo amanhã"
          icon={AlertTriangle}
          cor="text-red-600"
          items={grupos.amanha}
          total={totalAmanha}
          onStatusChange={handleStatusChange}
          onEnableRecurring={handleEnableRecurring}
          updatingId={updatingId}
          recurringUpdateId={recurringUpdateId}
        />
        <Grupo
          titulo="Próximos 3 dias"
          icon={Clock}
          cor="text-orange-500"
          items={grupos.ate3}
          total={totalAte3}
          onStatusChange={handleStatusChange}
          onEnableRecurring={handleEnableRecurring}
          updatingId={updatingId}
          recurringUpdateId={recurringUpdateId}
        />
        <Grupo
          titulo="De 3 a 5 dias"
          icon={Clock}
          cor="text-yellow-600"
          items={grupos.de3a5}
          total={totalDe3a5}
          onStatusChange={handleStatusChange}
          onEnableRecurring={handleEnableRecurring}
          updatingId={updatingId}
          recurringUpdateId={recurringUpdateId}
        />
        {grupos.semanasOrdenadas.slice(0, visibleWeeks).map((sem) => (
          <Grupo
            key={sem.key}
            titulo={sem.label}
            icon={Calendar}
            cor="text-gray-500"
            items={sem.items}
            total={sem.total}
            onStatusChange={handleStatusChange}
            onEnableRecurring={handleEnableRecurring}
            updatingId={updatingId}
            recurringUpdateId={recurringUpdateId}
            defaultAberto={false}
          />
        ))}
        {visibleWeeks < grupos.semanasOrdenadas.length && (
          <div className="pt-2 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVisibleWeeks((prev) => prev + 3)}
              className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 gap-1"
            >
              <ChevronDown className="w-3 h-3" />
              Exibir mais
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
