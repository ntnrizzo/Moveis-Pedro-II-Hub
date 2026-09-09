import { useAuth } from "@/hooks/useAuth";
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2, CheckCircle2, XCircle, ExternalLink,
  FileText, Building2, CalendarDays, Banknote
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { approvePurchaseOrderPayment } from "@/services/financialOperations";

function OcApprovalCard({ oc, categorias, currentUser }) {
  const { can } = useAuth();
  const solicitacao = oc.metadata?.solicitacao_financeiro || {};
  const [form, setForm] = useState({
    categoria_id: solicitacao.categoria_id || "",
    data_vencimento: solicitacao.data_vencimento || "",
    forma_pagamento: solicitacao.forma_pagamento || "",
    ja_pago: false,
    data_pagamento: "",
  });
  const [formError, setFormError] = useState("");
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const aprovaMutation = useMutation({
    mutationFn: async () => {
      if (!can("approve_payment_oc")) throw new Error("Sem permissão para aprovar pagamento de compras.");
      const categoriaObj = categorias.find(c => c.id === form.categoria_id);
      const ultimoAnexo = oc.anexos_financeiro?.[oc.anexos_financeiro.length - 1];
      const anexoUrl = ultimoAnexo?.url || solicitacao.anexo_url || "";
      await approvePurchaseOrderPayment({
        purchaseOrderId: oc.id,
        categoryId: form.categoria_id,
        dueDate: form.data_vencimento,
        paymentMethod: form.forma_pagamento,
        alreadyPaid: form.ja_pago,
        paymentDate: form.data_pagamento,
        observation: solicitacao.observacao || categoriaObj?.nome || null,
        attachmentUrl: anexoUrl,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compras"] });
      queryClient.invalidateQueries({ queryKey: ["compras-pendentes-aprovacao"] });
      queryClient.invalidateQueries({ queryKey: ["lancamentos-financeiros"] });
      toast.success(`OC #${oc.numero_pedido} aprovada e lançamento gerado.`);
    },
    onError: (err) => {
      toast.error(err?.message || "Erro ao aprovar pedido.");
    },
  });

  const cancelaMutation = useMutation({
    mutationFn: async () => {
      if (!can("approve_payment_oc")) throw new Error("Sem permissão para aprovar pagamento de compras.");
      await base44.entities.ComprasOrden.update(oc.id, {
        status: "Cancelada",
        pagamento_status: "nao_aplicavel",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compras"] });
      queryClient.invalidateQueries({ queryKey: ["compras-pendentes-aprovacao"] });
      toast.success(`Pedido OC #${oc.numero_pedido} cancelado.`);
    },
    onError: (err) => {
      toast.error(err?.message || "Erro ao cancelar pedido.");
    },
  });

  const handleAprovar = () => {
    setFormError("");
    if (!form.categoria_id) return setFormError("Selecione uma categoria para o lançamento.");
    if (!form.data_vencimento) return setFormError("Informe a data de vencimento.");
    aprovaMutation.mutate();
  };

  const handleCancelar = async () => {
    const ok = await confirm({
      title: "Cancelar e Excluir Pedido",
      message: `Confirma o cancelamento da OC #${oc.numero_pedido} de ${oc.fornecedor_nome}? Esta ação não poderá ser desfeita.`,
      confirmText: "Cancelar Pedido",
      cancelText: "Voltar",
    });
    if (ok) cancelaMutation.mutate();
  };

  const ultimoAnexo = oc.anexos_financeiro?.[oc.anexos_financeiro.length - 1];
  const anexo = ultimoAnexo || (solicitacao.anexo_url ? { url: solicitacao.anexo_url, nome: solicitacao.anexo_nome } : null);

  return (
    <Card className="border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-base font-mono">{oc.numero_pedido}</span>
              <Badge variant="outline" className="text-amber-700 border-amber-400 bg-amber-100">
                Aguardando Aprovação
              </Badge>
              <Badge variant="outline" className="text-gray-600">
                {oc.status}
              </Badge>
            </div>
            <div className="flex items-center gap-1 mt-1 text-sm text-gray-600">
              <Building2 className="w-3.5 h-3.5" />
              <span>{oc.fornecedor_nome}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-gray-900 dark:text-white">
              {Number(oc.valor_total || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </div>
            <div className="text-xs text-gray-500 flex items-center justify-end gap-1 mt-0.5">
              <CalendarDays className="w-3 h-3" />
              {oc.data_pedido ? new Date(oc.data_pedido + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Comprovante */}
        {anexo ? (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
            <FileText className="w-4 h-4 text-green-700 shrink-0" />
            <span className="text-sm text-green-800 truncate flex-1">{anexo.nome || "Comprovante de devolução"}</span>
            <a
              href={anexo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-700 hover:text-green-900 shrink-0"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-muted-foreground">
            Nenhum comprovante anexado
          </div>
        )}

        {/* Detalhe da devolução */}
        {solicitacao.detalhe_devolucao && (
          <div className="rounded-md bg-white dark:bg-neutral-900 border px-3 py-2 text-sm">
            <p className="text-xs font-semibold text-gray-500 mb-1">Detalhe da Devolução</p>
            <p className="text-gray-800 dark:text-gray-200">{solicitacao.detalhe_devolucao}</p>
          </div>
        )}

        {/* Observação */}
        {solicitacao.observacao && (
          <div className="rounded-md bg-white dark:bg-neutral-900 border px-3 py-2 text-sm">
            <p className="text-xs font-semibold text-gray-500 mb-1">Observação</p>
            <p className="text-gray-800 dark:text-gray-200">{solicitacao.observacao}</p>
          </div>
        )}

        {/* Formulário de aprovação */}
        <div className="rounded-md bg-white dark:bg-neutral-900 border p-3 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dados do Lançamento</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                Categoria <span className="text-red-500">*</span>
              </label>
              <Select value={form.categoria_id} onValueChange={v => setForm(f => ({ ...f, categoria_id: v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                Vencimento <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                lang="pt-BR"
                className="h-8 text-sm"
                value={form.data_vencimento}
                onChange={e => setForm(f => ({ ...f, data_vencimento: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Forma de Pagamento</label>
              <Input
                className="h-8 text-sm"
                value={form.forma_pagamento}
                onChange={e => setForm(f => ({ ...f, forma_pagamento: e.target.value }))}
              />
            </div>

            <div className="flex flex-col justify-end">
              <div className="flex items-center gap-2 h-8">
                <Checkbox
                  id={`pago-${oc.id}`}
                  checked={form.ja_pago}
                  onCheckedChange={v => setForm(f => ({ ...f, ja_pago: !!v }))}
                />
                <label
                  htmlFor={`pago-${oc.id}`}
                  className="text-sm cursor-pointer select-none flex items-center gap-1"
                >
                  <Banknote className="w-3.5 h-3.5 text-green-600" />
                  Já foi pago?
                </label>
              </div>
            </div>
          </div>

          {form.ja_pago && (
            <div>
              <label className="block text-xs font-medium mb-1">Data do Pagamento</label>
              <Input
                type="date"
                lang="pt-BR"
                className="h-8 text-sm max-w-[180px]"
                value={form.data_pagamento}
                onChange={e => setForm(f => ({ ...f, data_pagamento: e.target.value }))}
              />
            </div>
          )}

          {formError && <p className="text-red-600 text-xs">{formError}</p>}
        </div>

        {/* Ações */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-400"
            disabled={cancelaMutation.isPending || aprovaMutation.isPending}
            onClick={handleCancelar}
          >
            {cancelaMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4 mr-1.5" />
            )}
            Cancelar e Excluir Pedido
          </Button>

          <Button
            size="sm"
            className="bg-green-700 hover:bg-green-800 text-white"
            disabled={aprovaMutation.isPending || cancelaMutation.isPending}
            onClick={handleAprovar}
          >
            {aprovaMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
            )}
            {form.ja_pago ? "Aprovar (Pago)" : "Aprovar (Pendente)"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AprovacaoComprasTab({ ocs, categorias, isLoading, currentUser }) {
  const { can } = useAuth();
  if (!can('approve_payment_oc')) return null;
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!ocs || ocs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
        <CheckCircle2 className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-base font-medium">Nenhuma solicitação pendente</p>
        <p className="text-sm">Quando o setor de compras enviar uma solicitação, ela aparecerá aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {ocs.length} {ocs.length === 1 ? "solicitação aguardando" : "solicitações aguardando"} aprovação
      </p>
      {ocs.map(oc => (
        <OcApprovalCard
          key={oc.id}
          oc={oc}
          categorias={categorias}
          currentUser={currentUser}
        />
      ))}
    </div>
  );
}
