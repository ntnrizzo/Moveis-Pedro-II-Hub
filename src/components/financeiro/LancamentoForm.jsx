import { useAuth } from "@/hooks/useAuth";
import { financialErrorMessage } from "@/lib/financialCapabilities";
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Upload, Plus, Tag, ChevronDown } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import CategoriasManager from "./CategoriasManager";
import { getBrazilTodayISO } from "@/lib/dateBrazil";
import { verificarConciliacao } from "@/lib/conciliacaoInteligente";
import ConciliacaoAlertModal from "./ConciliacaoAlertModal";
import { DEFAULT_RECORRENCIA_TIPO, RECORRENCIA_OPTIONS } from "@/lib/financeiroRecorrencia";

const CATEGORIAS_PADRAO = {
  Entrada: ["Venda de Produtos", "Recebimento de Parcela", "Comissão Recebida", "Serviço de Montagem", "Devolução Recebida"],
  Saída: ["Aluguel", "Energia Elétrica", "Água e Saneamento", "Telefone / Internet", "Compra de Fornecedor", "Salário / Folha", "Comissão Paga", "Marketing / Publicidade", "Manutenção", "Transporte / Frete", "Material de Escritório", "Imposto / Taxa", "Software / Assinatura"],
};

const isoToDisplay = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const maskDateInput = (raw) => {
  let v = raw.replace(/\D/g, "").slice(0, 8);
  if (v.length >= 5) v = v.slice(0, 2) + "/" + v.slice(2, 4) + "/" + v.slice(4);
  else if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
  return v;
};

const displayToIso = (display) => {
  if (display.length !== 10) return "";
  const [d, m, y] = display.split("/");
  if (!d || !m || !y || y.length !== 4) return "";
  return `${y}-${m}-${d}`;
};

const formatCurrencyFromDigits = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";

  const padded = digits.padStart(3, "0");
  const cents = padded.slice(-2);
  const integerPart = padded.slice(0, -2).replace(/^0+(?=\d)/, "") || "0";
  const integerFormatted = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return `${integerFormatted},${cents}`;
};

const parseCurrencyToNumber = (formattedValue) => {
  if (!formattedValue) return NaN;
  const normalized = String(formattedValue)
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");

  return parseFloat(normalized);
};

export default function LancamentoForm({ categorias }) {
  const { user, can } = useAuth();
  const canManage = can("manage_financeiro");
  const todayBrazilISO = getBrazilTodayISO();

  const [formData, setFormData] = useState({
    tipo: "Entrada",
    categoria_id: "",
    descricao: "",
    valor: "",
    data_lancamento: todayBrazilISO,
    data_vencimento: "",
    forma_pagamento: "Boleto",
    status: "Pago",
    observacao: "",
    recorrente: false,
    recorrencia_tipo: DEFAULT_RECORRENCIA_TIPO
  });
  const [validationError, setValidationError] = useState("");
  const [conciliacaoState, setConciliacaoState] = useState(null); // { duplicatas, payload }

  const [uploading, setUploading] = useState(false);
  const [categoriaModo, setCategoriaModo] = useState("select");
  const [outrosNome, setOutrosNome] = useState("");
  const [isCreatingCategoria, setIsCreatingCategoria] = useState(false);
  const [displayDates, setDisplayDates] = useState({
    data_lancamento: isoToDisplay(todayBrazilISO),
    data_vencimento: "",
  });

  const handleDateChange = (field, raw) => {
    const masked = maskDateInput(raw);
    setDisplayDates(prev => ({ ...prev, [field]: masked }));
    const iso = displayToIso(masked);
    if (iso || masked === "") setFormData(prev => ({ ...prev, [field]: iso }));
  };

  const queryClient = useQueryClient();

  const { data: todosLancamentos = [] } = useQuery({
    queryKey: ['lancamentos-financeiros', user?.organization_id, user?.id],
    queryFn: async () => await base44.entities.LancamentoFinanceiro.list('-data_lancamento') || [],
    staleTime: 60000,
  });

  const withTimeout = async (promise, ms, label) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Tempo limite excedido ao ${label}. Tente novamente.`)), ms);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data) => {
      if (!canManage) throw new Error("Sem permissão para criar lançamentos.");
      return await withTimeout(
        base44.entities.LancamentoFinanceiro.create({ ...data, organization_id: user.organization_id }),
        15000,
        'salvar o lançamento'
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
      setFormData({
        tipo: "Entrada",
        categoria_id: "",
        descricao: "",
        valor: "",
        data_lancamento: todayBrazilISO,
        data_vencimento: "",
        forma_pagamento: "Boleto",
        status: "Pago",
        observacao: "",
        recorrente: false,
        recorrencia_tipo: DEFAULT_RECORRENCIA_TIPO
      });
      setValidationError("");
      setCategoriaModo("select");
      setOutrosNome("");
      setDisplayDates({ data_lancamento: isoToDisplay(todayBrazilISO), data_vencimento: "" });
    },
    onError: (err) => {
      const message = financialErrorMessage(err);
      setValidationError(message);
      console.error("Erro ao criar lançamento:", err);
    }
  });

  const handleFileUpload = async (e) => {
    if (!canManage) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData({ ...formData, anexo_url: file_url });
    } catch (error) {
      console.error("Erro ao fazer upload:", error);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setValidationError("");

    if (formData.tipo === "Saída" && !formData.data_vencimento) {
      setValidationError("Informe a data de vencimento para lançamentos de saída.");
      return;
    }

    let finalCategoriaId = formData.categoria_id;
    let finalCategoriaNome = categorias.find(c => c.id === finalCategoriaId)?.nome || "";

    if (categoriaModo === "outros") {
      const nome = outrosNome.trim();
      if (!nome) {
        setValidationError("Informe o nome da nova categoria.");
        return;
      }

      setIsCreatingCategoria(true);
      try {
        const newCat = await withTimeout(
          base44.entities.CategoriaFinanceira.create({
            organization_id: user.organization_id,
            nome,
            tipo: formData.tipo,
            cor: "#6B7280"
          }),
          10000,
          'criar a categoria'
        );

        queryClient.invalidateQueries({ queryKey: ['categorias-financeiras'] });
        finalCategoriaId = newCat.id;
        finalCategoriaNome = nome;
      } catch (err) {
        console.error("Erro ao criar categoria:", err);
        setValidationError(financialErrorMessage(err));
        return;
      } finally {
        setIsCreatingCategoria(false);
      }
    }

    if (!finalCategoriaId) {
      setValidationError("Selecione uma categoria para continuar.");
      return;
    }

    const valorNumerico = parseCurrencyToNumber(formData.valor);
    if (Number.isNaN(valorNumerico) || valorNumerico <= 0) {
      setValidationError("Informe um valor válido maior que zero.");
      return;
    }

    const payload = {
      ...formData,
      categoria_id: finalCategoriaId,
      categoria_nome: finalCategoriaNome,
      valor: valorNumerico,
      data_vencimento: formData.data_vencimento || null
    };

    // Conciliação inteligente: verificar duplicatas antes de salvar
    const { duplicatas } = verificarConciliacao(payload, todosLancamentos);
    if (duplicatas.length > 0) {
      setConciliacaoState({ duplicatas, payload });
      return;
    }

    createMutation.mutate(payload);
  };

  const categoriasFiltered = categorias.filter(c => 
    c.tipo === formData.tipo || c.tipo === 'Ambos'
  );

  const sugestoesFaltando = (CATEGORIAS_PADRAO[formData.tipo] || []).filter(
    nome => !categoriasFiltered.some(c => c.nome.toLowerCase() === nome.toLowerCase())
  );

  return (
  <div className="space-y-4">
    {conciliacaoState && (
      <ConciliacaoAlertModal
        open
        duplicatas={conciliacaoState.duplicatas}
        novoValor={conciliacaoState.payload.valor}
        novoDescricao={conciliacaoState.payload.descricao}
        onConfirm={() => {
          const p = conciliacaoState.payload;
          setConciliacaoState(null);
          createMutation.mutate(p);
        }}
        onCancel={() => setConciliacaoState(null)}
      />
    )}
    <Card className="border-0 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Novo Lançamento
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tipo">Tipo *</Label>
              <Select
                value={formData.tipo}
                onValueChange={(value) => {
                  setFormData({
                    ...formData,
                    tipo: value,
                    categoria_id: "",
                    data_vencimento: value === "Saída" ? formData.data_vencimento : ""
                  });
                  setValidationError("");
                  setCategoriaModo("select");
                  setOutrosNome("");
                }}
                required
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Entrada">Entrada</SelectItem>
                  <SelectItem value="Saída">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Categoria *</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {categoriasFiltered.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, categoria_id: cat.id });
                      setCategoriaModo("select");
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      formData.categoria_id === cat.id && categoriaModo === "select"
                        ? formData.tipo === "Saída"
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-green-700 text-white border-green-700"
                        : formData.tipo === "Saída"
                          ? "bg-white text-gray-700 border-gray-300 hover:border-red-500 hover:text-red-600"
                          : "bg-white text-gray-700 border-gray-300 hover:border-green-600 hover:text-green-700"
                    }`}
                  >
                    {cat.nome}
                  </button>
                ))}
                {sugestoesFaltando.map(nome => (
                  <button
                    key={nome}
                    type="button"
                    onClick={() => {
                      setCategoriaModo("outros");
                      setOutrosNome(nome);
                      setFormData({ ...formData, categoria_id: "" });
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border border-dashed transition-colors ${
                      categoriaModo === "outros" && outrosNome === nome
                        ? formData.tipo === "Saída"
                          ? "bg-red-600 text-white border-red-600 border-solid"
                          : "bg-green-700 text-white border-green-700 border-solid"
                        : formData.tipo === "Saída"
                          ? "bg-gray-50 text-gray-600 border-gray-300 hover:border-red-500 hover:text-red-600"
                          : "bg-gray-50 text-gray-600 border-gray-300 hover:border-green-600 hover:text-green-700"
                    }`}
                  >
                    + {nome}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setCategoriaModo("outros");
                    setOutrosNome("");
                    setFormData({ ...formData, categoria_id: "" });
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    categoriaModo === "outros" && !sugestoesFaltando.includes(outrosNome)
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white text-orange-600 border-orange-300 hover:bg-orange-50"
                  }`}
                >
                  Outros
                </button>
              </div>
              {categoriaModo === "outros" && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    placeholder="Nome da nova categoria..."
                    value={outrosNome}
                    onChange={(e) => setOutrosNome(e.target.value)}
                    className="flex-1"
                    autoFocus
                  />
                  <span className="text-xs text-gray-400">Será criada ao salvar</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="descricao">Descrição *</Label>
            <Input
              id="descricao"
              value={formData.descricao}
              onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
              placeholder="Ex: Venda de produtos, Pagamento de fornecedor..."
              required
            />
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="valor">Valor (R$) *</Label>
              <Input
                id="valor"
                type="text"
                inputMode="numeric"
                value={formData.valor}
                onChange={(e) => setFormData({ ...formData, valor: formatCurrencyFromDigits(e.target.value) })}
                placeholder="0,00"
                required
              />
            </div>

            <div>
              <Label htmlFor="data">Data *</Label>
              <Input
                id="data"
                type="text"
                value={displayDates.data_lancamento}
                onChange={(e) => handleDateChange("data_lancamento", e.target.value)}
                placeholder="dd/mm/aaaa"
                maxLength={10}
                required
              />
            </div>

            <div>
              <Label htmlFor="forma_pagamento">Forma de Pagamento *</Label>
              <Select
                value={formData.forma_pagamento}
                onValueChange={(value) => setFormData({ ...formData, forma_pagamento: value })}
                required
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
            </div>
          </div>

          {formData.tipo === "Saída" && (
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="data_vencimento">Data de Vencimento *</Label>
                <Input
                  id="data_vencimento"
                  type="text"
                  value={displayDates.data_vencimento}
                  onChange={(e) => {
                    handleDateChange("data_vencimento", e.target.value);
                    if (validationError) setValidationError("");
                  }}
                  placeholder="dd/mm/aaaa"
                  maxLength={10}
                  required={formData.tipo === "Saída"}
                />
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="status">Status *</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
                required
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
            </div>

            <div>
              <Label htmlFor="anexo">Comprovante/Nota Fiscal</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="anexo"
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                {uploading && <span className="text-sm" style={{ color: '#8B8B8B' }}>Enviando...</span>}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="observacao">Observações</Label>
            <Textarea
              id="observacao"
              value={formData.observacao}
              onChange={(e) => setFormData({ ...formData, observacao: e.target.value })}
              rows={3}
              placeholder="Informações adicionais sobre este lançamento..."
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="recorrente"
              checked={formData.recorrente}
              onCheckedChange={(checked) => setFormData({ ...formData, recorrente: checked })}
            />
            <Label htmlFor="recorrente" className="cursor-pointer">
              Automatizar próximos vencimentos
            </Label>
          </div>

          {formData.recorrente && (
            <div>
              <Label htmlFor="recorrencia_tipo">Tipo de Recorrência</Label>
              <Select
                value={formData.recorrencia_tipo}
                onValueChange={(value) => setFormData({ ...formData, recorrencia_tipo: value })}
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
              <p className="text-xs text-gray-500 mt-2">
                O lançamento continua normal na lista e será usado como atalho para gerar os próximos vencimentos automaticamente.
              </p>
            </div>
          )}

          {createMutation.isSuccess && (
            <Alert className="bg-green-50 border-green-200">
              <AlertDescription className="text-green-800">
                Lançamento criado com sucesso!
              </AlertDescription>
            </Alert>
          )}

          {validationError && (
            <Alert className="bg-red-50 border-red-200">
              <AlertDescription className="text-red-700">
                {validationError}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFormData({
                  tipo: "Entrada",
                  categoria_id: "",
                  descricao: "",
                  valor: "",
                  data_lancamento: todayBrazilISO,
                  data_vencimento: "",
                  forma_pagamento: "Boleto",
                  status: "Pago",
                  observacao: "",
                  recorrente: false,
                  recorrencia_tipo: DEFAULT_RECORRENCIA_TIPO
                });
                setValidationError("");
                setCategoriaModo("select");
                setOutrosNome("");
                setDisplayDates({ data_lancamento: isoToDisplay(todayBrazilISO), data_vencimento: "" });
              }}
            >
              Limpar
            </Button>
            <Button
              type="submit"
              disabled={!canManage || createMutation.isPending || isCreatingCategoria}
              style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
            >
              {createMutation.isPending || isCreatingCategoria ? 'Salvando...' : 'Criar Lançamento'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    {/* ── Categorias (cascata colapsável) ─────────────────────── */}
    <Collapsible>
      <Card className="border-0 shadow-md">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none pb-3 hover:bg-gray-50 dark:hover:bg-neutral-800 rounded-xl transition-colors">
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-300">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-green-600" />
                Gerenciar Categorias
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 transition-transform [[data-state=open]_&]:rotate-180" />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <CategoriasManager categorias={categorias} />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  </div>
  );
}
