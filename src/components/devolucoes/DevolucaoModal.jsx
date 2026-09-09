
import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44, supabase } from "@/lib/supabase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertCircle, Loader2, Plus, Trash2, Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useLojas } from "@/hooks/useLojas";
import { resolveStockField } from "@/utils/stockUtils";
import BuscaProdutoAvancada from "@/components/vendas/BuscaProdutoAvancada";
import {
  isInstallmentPaymentMethod,
  normalizePaymentItem,
  validatePaymentSplit,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHOD_OPTIONS_DELIVERY,
} from "@/services/paymentOrchestrator";
import { createOperationalFinancialEntry } from '@/services/financialOperations';

export default function DevolucaoModal({ isOpen, onClose, onSave, devolucao, devolucoes = [], vendas = [], produtos = [], fornecedores = [], isLoading }) {

  const { user } = useAuth();
  const { data: lojasData = [] } = useLojas();
  const submitLockRef = useRef(false);

  const createInitialFormData = () => ({
    venda_id: "",
    numero_pedido: "",
    cliente_nome: "",
    data_devolucao: new Date().toISOString().split('T')[0],
    tipo: "Devolução",
    itens_devolvidos: [],
    itens_troca: [],
    valor_devolvido: 0,
    valor_diferenca: 0,
    status: "Pendente",
    observacoes: "",
    destino_estoque: "",
    destino_troco: "",
    justificativa_financeira: "",
    forma_pagamento_diferenca: "",
    pagamento_diferenca_parcelas: 1,
    pagamento_diferenca_valor: 0,
    pagamento_diferenca_ativo: false,
    pagamentos_diferenca: [],
    organization_id: user?.organization_id || null,
  });

  const [formData, setFormData] = useState(createInitialFormData());
  const [vendaSelecionada, setVendaSelecionada] = useState(null);
  const [entregue, setEntregue] = useState(false);
  const [verificandoEntrega, setVerificandoEntrega] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [valorEditadoManual, setValorEditadoManual] = useState(false);
  const [produtoTrocaSelecionadoId, setProdutoTrocaSelecionadoId] = useState("");
  const [quantidadeTrocaInput, setQuantidadeTrocaInput] = useState(1);
  const [buscaVenda, setBuscaVenda] = useState("");
  const [openVendaBusca, setOpenVendaBusca] = useState(false);
  const [novoPagamentoDiferenca, setNovoPagamentoDiferenca] = useState({ forma: "", valor: "", parcelas: 1 });

  // Estados para PainelPagamento na Devolução
  const [descontoDiferenca, setDescontoDiferenca] = useState(0);
  const [observacoesDiferenca, setObservacoesDiferenca] = useState("");
  const [pagamentoEntregaDiferenca, setPagamentoEntregaDiferenca] = useState({ ativo: false, valor: 0, forma: '', parcelas: 1 });
  const [cupomAplicadoDiferenca, setCupomAplicadoDiferenca] = useState(null);
  const [tokenGerencialDiferenca, setTokenGerencialDiferenca] = useState(null);
  const [margemDescontoDiferenca, setMargemDescontoDiferenca] = useState(0);

  // Permissões de aprovação baseadas no role do usuário
  useEffect(() => {
    const cargo = user?.cargo || user?.role || '';
    setCanApprove(cargo === 'Administrador' || cargo === 'Gerente' || cargo === 'admin' || cargo === 'manager');
  }, [user]);

  // Lojas disponíveis como destino de estoque
  const lojasDestino = useMemo(() => {
    return lojasData.map(l => l.nome).filter(Boolean);
  }, [lojasData]);

  // Vendas disponíveis para seleção (apenas com status de entregue ou finalizadas)
  const vendasParaSelecao = useMemo(() => {
    return (vendas || []).filter(v =>
      v.status === 'Entregue' ||
      v.status === 'Finalizada' ||
      v.status === 'Pago' ||
      v.status === 'Aprovada'
    );
  }, [vendas]);

  // Filtragem das vendas baseada na busca digitada
  const vendasFiltradasBusca = useMemo(() => {
    const termo = String(buscaVenda || '').trim().toLowerCase();
    if (termo.length < 2) return [];
    return (vendas || []).filter(v =>
      String(v.numero_pedido || '').toLowerCase().includes(termo) ||
      String(v.cliente_nome || '').toLowerCase().includes(termo)
    ).slice(0, 20);
  }, [vendas, buscaVenda]);

  // Itens da venda selecionada
  const itensVendaSelecionada = useMemo(() => {
    if (!vendaSelecionada) return [];
    return Array.isArray(vendaSelecionada.itens)
      ? vendaSelecionada.itens
      : Array.isArray(vendaSelecionada.itens_venda)
        ? vendaSelecionada.itens_venda
        : [];
  }, [vendaSelecionada]);

  // Produtos disponíveis para troca (com estoque > 0)
  const getEstoqueDisponivelProduto = (produto) => {
    if (!produto) return 0;

    const estoqueCampos = Object.entries(produto)
      .filter(([key, value]) => key.startsWith('estoque_') && typeof value !== 'object')
      .map(([, value]) => Number(value || 0))
      .filter((value) => Number.isFinite(value));

    const estoquePrincipal = Number(produto.quantidade_estoque || 0);
    const estoqueBase = estoqueCampos.length > 0
      ? Math.max(estoquePrincipal, ...estoqueCampos)
      : estoquePrincipal;
    const reservado = Number(produto.quantidade_reservada || 0);

    return Math.max(0, estoqueBase - reservado);
  };

  // Produtos disponíveis para troca
  const produtosTrocaDisponiveis = useMemo(() => {
    return (produtos || [])
      .filter((p) => p.ativo !== false)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }));
  }, [produtos]);

  // Valor da diferença da troca (derivado do formData)
  const valorDiferenca = Number(formData.valor_diferenca || 0);

  // Pagamentos da diferença (derivado do formData)
  const pagamentosDiferenca = useMemo(() => {
    return Array.isArray(formData.pagamentos_diferenca) ? formData.pagamentos_diferenca : [];
  }, [formData.pagamentos_diferenca]);

  // Validação dos pagamentos da diferença
  const validacaoPagamentoDiferenca = useMemo(() => {
    const totalPago = pagamentosDiferenca.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    const acrescimos = pagamentosDiferenca.reduce((acc, p) => acc + Number(p.acrescimo || 0), 0);
    const subtotal = valorDiferenca + acrescimos;
    const total = Math.max(0, subtotal - descontoDiferenca);
    const pago = totalPago + (pagamentoEntregaDiferenca.ativo ? pagamentoEntregaDiferenca.valor : 0);
    const restante = Math.max(0, total - pago);
    
    const errors = [];
    if (restante > 0.009) {
      errors.push(`Faltam R$ ${restante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para cobrir a diferença.`);
    }
    return {
      ok: errors.length === 0,
      totalPago,
      restante,
      errors,
    };
  }, [pagamentosDiferenca, valorDiferenca, descontoDiferenca, pagamentoEntregaDiferenca]);

  const valoresPainelDiferenca = useMemo(() => {
    const acrescimos = pagamentosDiferenca.reduce((acc, p) => acc + Number(p.acrescimo || 0), 0);
    const subtotal = valorDiferenca + acrescimos;
    const total = Math.max(0, subtotal - descontoDiferenca);
    const pago = pagamentosDiferenca.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    const restante = Math.max(0, total - pago);
    return { subtotal, total, pago, restante };
  }, [valorDiferenca, descontoDiferenca, pagamentosDiferenca]);

  // Calcula quantidade já devolvida de um produto em outras devoluções da mesma venda
  const getQuantidadeJaDevolvida = (vendaId, produtoId) => {
    if (!vendaId || !produtoId) return 0;
    return (devolucoes || [])
      .filter(d =>
        d.venda_id === vendaId &&
        d.status !== 'Rejeitada' &&
        (!devolucao || d.id !== devolucao.id)
      )
      .reduce((acc, d) => {
        const itens = Array.isArray(d.itens_devolvidos) ? d.itens_devolvidos : [];
        const item = itens.find(i => i.produto_id === produtoId);
        return acc + Number(item?.quantidade || 0);
      }, 0);
  };

  const getQuantidadeMaximaDevolucao = (item) => {
    const vendida = Number(item?.quantidade || 0);
    const jaDevolvida = getQuantidadeJaDevolvida(formData.venda_id, item?.produto_id);
    return Math.max(0, vendida - jaDevolvida);
  };

  const calcularTotalItensDevolvidos = (itens) => {
    return (itens || []).reduce((acc, item) => {
      const preco = Number(item.preco_unitario || 0);
      const quantidade = Number(item.quantidade || 0);
      return acc + (preco * quantidade);
    }, 0);
  };

  const calcularTotalItensTroca = (itens) => {
    return (itens || []).reduce((acc, item) => {
      const preco = Number(item.preco_unitario || 0);
      const quantidade = Number(item.quantidade || 0);
      return acc + (preco * quantidade);
    }, 0);
  };

  const recomputarValores = (nextItensDevolvidos, nextItensTroca, forceValor = false) => {
    const totalDevolvidoCalculado = calcularTotalItensDevolvidos(nextItensDevolvidos);
    const totalTrocaCalculado = calcularTotalItensTroca(nextItensTroca);
    const valorDevolvidoFinal = (valorEditadoManual && !forceValor)
      ? Number(formData.valor_devolvido || 0)
      : totalDevolvidoCalculado;

    return {
      valor_devolvido: valorDevolvidoFinal,
      valor_diferenca: totalTrocaCalculado - valorDevolvidoFinal
    };
  };

  useEffect(() => {
    if (devolucao) {
      setFormData({
        ...createInitialFormData(),
        ...devolucao,
        itens_devolvidos: (devolucao.itens_devolvidos || []).map((item, index) => ({
          ...item,
          item_key: item.item_key || `${item.produto_id || 'sem-produto'}_${index}`,
          quantidade_maxima: Number(item.quantidade_maxima || item.quantidade || 0)
        })),
        itens_troca: (devolucao.itens_troca || []).map((item) => ({
          ...item,
          quantidade: Number(item.quantidade || 0)
        })),
        justificativa_financeira: devolucao.justificativa_financeira || '',
        destino_estoque: devolucao.destino_estoque || '',
        destino_troco: devolucao.destino_troco || '',
        pagamentos_diferenca: Array.isArray(devolucao.pagamentos_diferenca)
          ? devolucao.pagamentos_diferenca
          : typeof devolucao.pagamentos_diferenca === 'string'
            ? (() => {
                try {
                  const parsed = JSON.parse(devolucao.pagamentos_diferenca);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : []
      });
      const venda = vendas?.find(v => v.id === devolucao.venda_id);
      setVendaSelecionada(venda);
      setEntregue(true);
      setValorEditadoManual(Boolean(Number(devolucao.valor_devolvido || 0)));
      setProdutoTrocaSelecionadoId("");
      setQuantidadeTrocaInput(1);
      setBuscaVenda("");
    } else {
      setFormData(createInitialFormData());
      setVendaSelecionada(null);
      setEntregue(false);
      setValorEditadoManual(false);
      setProdutoTrocaSelecionadoId("");
      setQuantidadeTrocaInput(1);
      setBuscaVenda("");
    }
  }, [devolucao, vendas, isOpen]);
  useEffect(() => {
    if (valorDiferenca <= 0 && pagamentosDiferenca.length > 0) {
      setFormData((prev) => ({ ...prev, pagamentos_diferenca: [] }));
      setNovoPagamentoDiferenca({ forma: "", valor: "", parcelas: 1 });
    }
  }, [valorDiferenca, pagamentosDiferenca.length]);

  useEffect(() => {
    if (!isOpen) return;
    if (!formData.destino_estoque) return;

    const destinoExisteNasLojas = lojasDestino.includes(formData.destino_estoque);
    if (!destinoExisteNasLojas) {
      setFormData((prev) => ({ ...prev, destino_estoque: '' }));
    }
  }, [isOpen, lojasDestino, formData.destino_estoque]);

  const handleVendaChange = async (vendaId) => {
    const venda = vendas?.find(v => v.id === vendaId);
    if (!venda) return;

    setVendaSelecionada(venda);
    setVerificandoEntrega(true);
    setEntregue(false);

    try {
      const { data: entregas, error } = await supabase
        .from('entregas')
        .select('id')
        .eq('venda_id', vendaId)
        .eq('status', 'Entregue');

      if (error) throw error;
      setEntregue(entregas && entregas.length > 0);
    } catch (err) {
      console.error("Erro ao verificar entrega:", err);
      setEntregue(true);
    } finally {
      setVerificandoEntrega(false);
    }

    setFormData({
      ...createInitialFormData(),
      venda_id: vendaId,
      numero_pedido: venda.numero_pedido,
      cliente_nome: venda.cliente_nome,
      destino_estoque: lojasDestino.includes(venda.loja) ? venda.loja : '',
      itens_devolvidos: [],
      itens_troca: []
    });
    setValorEditadoManual(false);
    setProdutoTrocaSelecionadoId("");
    setQuantidadeTrocaInput(1);
    setBuscaVenda("");
  };

  const adicionarItemDevolucao = (item, index) => {
    const itemKey = `${item.produto_id || 'sem-produto'}_${index}`;
    const jaAdicionado = formData.itens_devolvidos.find(i => i.item_key === itemKey);
    if (jaAdicionado) return;

    const quantidadeMaxima = getQuantidadeMaximaDevolucao(item);
    if (quantidadeMaxima <= 0) return;

    const precoUnitario = Number(item.preco_unitario || 0) || (
      Number(item.subtotal || 0) > 0 && Number(item.quantidade || 0) > 0
        ? Number(item.subtotal || 0) / Number(item.quantidade || 0)
        : 0
    );

    const nextItensDevolvidos = [...formData.itens_devolvidos, {
      item_key: itemKey,
      produto_id: item.produto_id,
      produto_nome: item.produto_nome,
      quantidade: 1,
      quantidade_maxima: quantidadeMaxima,
      quantidade_vendida: Number(item.quantidade || 0),
      preco_unitario: precoUnitario,
      subtotal: Number(item.subtotal || 0),
      motivo: ""
    }];

    const novosValores = recomputarValores(nextItensDevolvidos, formData.itens_troca);

    setFormData({
      ...formData,
      itens_devolvidos: nextItensDevolvidos,
      ...novosValores
    });
  };

  const atualizarItemDevolucao = (index, field, value) => {
    const itensAtualizados = [...formData.itens_devolvidos];
    const itemAtual = itensAtualizados[index];

    if (!itemAtual) return;

    if (field === 'quantidade') {
      const quantidade = Math.max(1, Math.min(
        Number(itemAtual.quantidade_maxima || itemAtual.quantidade_vendida || 1),
        Number(value || 1)
      ));
      itensAtualizados[index].quantidade = quantidade;
    } else {
      itensAtualizados[index][field] = value;
    }

    const novosValores = recomputarValores(itensAtualizados, formData.itens_troca);

    setFormData({
      ...formData,
      itens_devolvidos: itensAtualizados,
      ...novosValores
    });
  };

  const removerItemDevolucao = (index) => {
    const nextItens = formData.itens_devolvidos.filter((_, i) => i !== index);
    const novosValores = recomputarValores(nextItens, formData.itens_troca);

    setFormData({
      ...formData,
      itens_devolvidos: nextItens,
      ...novosValores
    });
  };

  const adicionarItemTroca = () => {
    if (!produtoTrocaSelecionadoId) return;

    const produto = (produtos || []).find((p) => p.id === produtoTrocaSelecionadoId);
    if (!produto) return;

    const quantidade = Math.max(1, Number(quantidadeTrocaInput || 1));
    const precoUnitario = Number(produto.preco_venda || produto.preco || 0);

    const nextItensTroca = [
      ...(formData.itens_troca || []),
      {
        produto_id: produto.id,
        produto_nome: produto.nome,
        quantidade,
        preco_unitario: precoUnitario
      }
    ];

    const novosValores = recomputarValores(formData.itens_devolvidos, nextItensTroca);

    setFormData({
      ...formData,
      itens_troca: nextItensTroca,
      ...novosValores
    });

    setProdutoTrocaSelecionadoId("");
    setQuantidadeTrocaInput(1);
  };

  const atualizarItemTroca = (index, quantidadeInput) => {
    const nextItensTroca = [...(formData.itens_troca || [])];
    const quantidade = Math.max(1, Number(quantidadeInput || 1));
    if (!nextItensTroca[index]) return;
    nextItensTroca[index].quantidade = quantidade;

    const novosValores = recomputarValores(formData.itens_devolvidos, nextItensTroca);
    setFormData({
      ...formData,
      itens_troca: nextItensTroca,
      ...novosValores
    });
  };

  const removerItemTroca = (index) => {
    const nextItensTroca = (formData.itens_troca || []).filter((_, i) => i !== index);
    const novosValores = recomputarValores(formData.itens_devolvidos, nextItensTroca);

    setFormData({
      ...formData,
      itens_troca: nextItensTroca,
      ...novosValores
    });
  };

  const adicionarPagamentoDiferenca = () => {
    const valorInformado = Number(String(novoPagamentoDiferenca.valor || '').replace(',', '.'));
    const formaSelecionada = String(novoPagamentoDiferenca.forma || '').trim();
    const parcelas = Math.max(1, Number(novoPagamentoDiferenca.parcelas || 1));

    if (!formaSelecionada || !Number.isFinite(valorInformado) || valorInformado <= 0) return;

    const formaResolvida = formaSelecionada === 'Crédito'
      ? (parcelas > 1 ? 'Crédito Parcelado' : 'Crédito 1x')
      : formaSelecionada;

    const proximoPagamento = normalizePaymentItem({
      forma_pagamento: formaResolvida,
      valor: valorInformado,
      parcelas,
    }, pagamentosDiferenca.length + 1);

    const nextPagamentos = [...pagamentosDiferenca, proximoPagamento];
    setFormData((prev) => ({ ...prev, pagamentos_diferenca: nextPagamentos, pagamento_diferenca_ativo: true }));
    setNovoPagamentoDiferenca({ forma: '', valor: '', parcelas: 1 });
  };

  const removerPagamentoDiferenca = (index) => {
    const nextPagamentos = pagamentosDiferenca.filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, pagamentos_diferenca: nextPagamentos }));
  };

  const vendaSelecionadaLabel = useMemo(() => {
    const vendaAtual = vendas?.find((v) => v.id === formData.venda_id) || vendaSelecionada;
    if (!vendaAtual) return "Buscar pedido por numero ou cliente";
    return `#${vendaAtual.numero_pedido} - ${vendaAtual.cliente_nome}`;
  }, [formData.venda_id, vendaSelecionada, vendas]);

  const produtoTrocaSelecionado = useMemo(() => {
    return produtosTrocaDisponiveis.find((p) => p.id === produtoTrocaSelecionadoId) || null;
  }, [produtoTrocaSelecionadoId, produtosTrocaDisponiveis]);

  const validarDadosBase = () => {
    if (!formData.venda_id) {
      throw new Error('Selecione uma venda.');
    }

    if (formData.itens_devolvidos.length === 0) {
      throw new Error('Adicione pelo menos um item para devolução.');
    }

    if (!formData.destino_estoque) {
      throw new Error('Selecione o destino do estoque devolvido.');
    }

    if (!lojasDestino.includes(formData.destino_estoque)) {
      throw new Error('Destino do estoque inválido. Selecione uma loja cadastrada em Configurações.');
    }

    for (const item of formData.itens_devolvidos) {
      const quantidade = Number(item.quantidade || 0);
      const maximo = Number(item.quantidade_maxima || 0);
      if (!Number.isFinite(quantidade) || quantidade <= 0) {
        throw new Error(`Quantidade inválida para o item ${item.produto_nome}.`);
      }
      if (quantidade > maximo) {
        throw new Error(`Quantidade de devolução do item ${item.produto_nome} excede o permitido.`);
      }
    }

    if (formData.tipo === 'Troca' && (!Array.isArray(formData.itens_troca) || formData.itens_troca.length === 0)) {
      throw new Error('Na troca, selecione ao menos um item que sai do estoque (reposição).');
    }

    if (formData.tipo === 'Troca' && valorDiferenca > 0) {
      if (!String(formData.forma_pagamento_diferenca || '').trim()) {
        throw new Error('Informe como a diferença da troca foi paga.');
      }

      if (String(formData.forma_pagamento_diferenca || '').includes('Crédito') && Number(formData.pagamento_diferenca_parcelas || 1) < 1) {
        throw new Error('Informe a quantidade de parcelas da diferença da troca.');
      }

      if (!validacaoPagamentoDiferenca.ok || validacaoPagamentoDiferenca.restante > 0) {
        throw new Error('A diferença da troca precisa estar totalmente paga antes de finalizar.');
      }
    }

    if (formData.tipo === 'Troca' && valorDiferenca < 0 && !String(formData.destino_troco || '').trim()) {
      throw new Error('Informe o destino do troco: devolução em dinheiro ou crédito na loja.');
    }
  };

  const validarFinanceiroAprovacao = () => {
    const valorDevolvido = Number(formData.valor_devolvido || 0);
    const valorPago = Number(vendaSelecionada?.valor_pago || 0);
    if (valorDevolvido < 0) {
      throw new Error('O valor devolvido não pode ser negativo.');
    }
    if (valorDevolvido > valorPago) {
      throw new Error('O valor devolvido não pode ultrapassar o valor já pago na venda.');
    }
    if (valorDevolvido > 0 && !String(formData.justificativa_financeira || '').trim()) {
      throw new Error('Informe a justificativa financeira para registrar a devolução no financeiro.');
    }
  };

  const atualizarEstoqueAprovacao = async () => {
    const campoDestino = resolveStockField(formData.destino_estoque);

    for (const item of formData.itens_devolvidos) {
      const produto = produtos.find(p => p.id === item.produto_id);
      if (produto) {
        const quantidade = Number(item.quantidade || 0);
        const estoqueAntes = Number(produto.quantidade_estoque || 0);
        const updates = {
          quantidade_estoque: estoqueAntes + quantidade,
          quantidade_reservada: Math.max(0, Number(produto.quantidade_reservada || 0) - quantidade),
        };

        if (campoDestino && Object.prototype.hasOwnProperty.call(produto, campoDestino)) {
          updates[campoDestino] = Number(produto[campoDestino] || 0) + quantidade;
        }

        await base44.entities.Produto.update(produto.id, updates);

        try {
          await supabase.from('movimentacoes_estoque').insert({
            produto_id: produto.id,
            evento_tipo: 'devolucao_entrada',
            modulo_origem: 'vendas',
            quantidade,
            estoque_antes_total: estoqueAntes,
            estoque_depois_total: estoqueAntes + quantidade,
            usuario_id: user?.id || null,
            usuario_nome: user?.nome || user?.full_name || user?.email || null,
            usuario_cargo: user?.cargo || null,
            cliente_nome: formData.cliente_nome || null,
            referencia_id: formData.venda_id,
            referencia_numero: formData.numero_pedido || null,
            loja_origem: formData.destino_estoque || null,
            observacao: item.motivo || null,
            organization_id: user?.organization_id
          });
        } catch (auditErr) {
          console.warn('Falha ao registrar movimentação de devolução:', auditErr);
        }
      }
    }

    if (formData.tipo === 'Troca' && formData.itens_troca.length > 0) {
      for (const item of formData.itens_troca) {
        const produto = produtos.find(p => p.id === item.produto_id);
        if (!produto) continue;

        const quantidade = Number(item.quantidade || 0);
        const estoqueAntes = Number(produto.quantidade_estoque || 0);
        if (quantidade <= 0) continue;
        if (estoqueAntes < quantidade) {
          throw new Error(`Estoque insuficiente para o item de troca ${item.produto_nome}.`);
        }

        await base44.entities.Produto.update(produto.id, {
          quantidade_estoque: estoqueAntes - quantidade
        });

        try {
          await supabase.from('movimentacoes_estoque').insert({
            produto_id: produto.id,
            evento_tipo: 'troca_saida',
            modulo_origem: 'vendas',
            quantidade,
            estoque_antes_total: estoqueAntes,
            estoque_depois_total: estoqueAntes - quantidade,
            usuario_id: user?.id || null,
            usuario_nome: user?.nome || user?.full_name || user?.email || null,
            usuario_cargo: user?.cargo || null,
            cliente_nome: formData.cliente_nome || null,
            referencia_id: formData.venda_id,
            referencia_numero: formData.numero_pedido || null,
            loja_origem: formData.destino_estoque || null,
            organization_id: user?.organization_id
          });
        } catch (auditErr) {
          console.warn('Falha ao registrar movimentação de troca:', auditErr);
        }
      }
    }
  };

  const criarLancamentosFinanceirosAprovacao = async () => {
    const lancamentosIds = [];
    const valorDevolvido = Number(formData.valor_devolvido || 0);
    const valorDiferenca = Number(formData.valor_diferenca || 0);

    const createLancamento = (suffix, payload) => {
      if (!devolucao?.id) throw new Error('Salve a devolução antes de gerar os lançamentos.');
      return createOperationalFinancialEntry({
        sourceType: 'devolucao',
        sourceId: devolucao.id,
        operationKey: `devolucao:${devolucao.id}:${suffix}`,
        entry: payload,
      });
    };

    if (valorDevolvido > 0) {
      const lancamentoPrincipal = await createLancamento('principal', {
        descricao: `Devolução #${formData.numero_pedido} - ${formData.cliente_nome}`,
        valor: -valorDevolvido,
        tipo: 'despesa',
        data_vencimento: formData.data_devolucao,
        data_lancamento: formData.data_devolucao,
        pago: false,
        categoria_nome: 'Devoluções de Venda',
        status: 'Pendente',
        observacao: `Justificativa financeira: ${String(formData.justificativa_financeira || '').trim()}. Destino do estoque: ${formData.destino_estoque}.`,
        venda_id: formData.venda_id,
        devolucao_id: devolucao?.id || null,
        origem_tipo: 'devolucao',
        origem_id: devolucao?.id || null,
        origem_ref: formData.numero_pedido || null,
      });
      lancamentosIds.push(lancamentoPrincipal.id);
    }

    if (formData.tipo === 'Troca' && valorDiferenca > 0) {
      const resumoPagamentos = (pagamentosDiferenca || [])
        .map((pagamento) => `${pagamento.forma_pagamento} R$ ${Number(pagamento.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
        .join(' + ');

      const lancamentoDiferenca = await createLancamento('diferenca', {
        descricao: `Diferença de Troca #${formData.numero_pedido} - ${formData.cliente_nome}`,
        valor: valorDiferenca,
        tipo: 'receita',
        data_vencimento: formData.data_devolucao,
        data_lancamento: formData.data_devolucao,
        pago: true,
        categoria_nome: 'Trocas de Venda',
        status: 'Pago',
        forma_pagamento: pagamentosDiferenca[0]?.forma_pagamento || 'Diversos',
        observacao: `Diferença paga na troca via ${resumoPagamentos || 'N/A'}. Justificativa: ${String(formData.justificativa_financeira || '').trim() || 'N/A'}`,
        venda_id: formData.venda_id,
        devolucao_id: devolucao?.id || null,
        origem_tipo: 'devolucao_troca',
        origem_id: devolucao?.id || null,
        origem_ref: formData.numero_pedido || null,
      });
      lancamentosIds.push(lancamentoDiferenca.id);
    }

    if (formData.tipo === 'Troca' && valorDiferenca < 0 && formData.destino_troco === 'devolver') {
      const trocoADevolver = Math.abs(valorDiferenca);
      const lancamentoTroco = await createLancamento('troco', {
        descricao: `Troco a devolver - Troca #${formData.numero_pedido} - ${formData.cliente_nome}`,
        valor: trocoADevolver,
        tipo: 'despesa',
        data_vencimento: formData.data_devolucao,
        data_lancamento: formData.data_devolucao,
        pago: false,
        categoria_nome: 'Devoluções de Venda',
        status: 'Pendente',
        forma_pagamento: 'Dinheiro',
        observacao: `Valor a ser devolvido ao cliente ${formData.cliente_nome} referente à troca do pedido ${formData.numero_pedido}.`,
        venda_id: formData.venda_id,
        devolucao_id: devolucao?.id || null,
        origem_tipo: 'devolucao_troca_troco',
        origem_id: devolucao?.id || null,
        origem_ref: formData.numero_pedido || null,
      });
      lancamentosIds.push(lancamentoTroco.id);
    }

    return lancamentosIds;
  };

  const handleSavePendente = async () => {
    validarDadosBase();

    const recalculo = recomputarValores(formData.itens_devolvidos, formData.itens_troca);
    const payload = {
      ...formData,
      ...recalculo,
      status: devolucao?.status === 'Rejeitada' ? 'Rejeitada' : 'Pendente',
      organization_id: formData.organization_id || user?.organization_id
    };

    await onSave(payload);
  };

  const handleApprove = async () => {
    if (!devolucao) {
      alert('Salve a devolução como pendente antes de aprovar.');
      return;
    }
    if (submitLockRef.current) return;

    submitLockRef.current = true;
    setIsApproving(true);

    try {
      const devolucaoAtual = await base44.entities.Devolucao.read(devolucao.id);
      if (!devolucaoAtual) {
        throw new Error('Devolução não encontrada para aprovação.');
      }
      if (devolucaoAtual.status === 'Aprovada' || devolucaoAtual.status === 'Processada') {
        throw new Error('Essa devolução já foi aprovada/processada anteriormente.');
      }

      validarDadosBase();
      validarFinanceiroAprovacao();

      const recalculo = recomputarValores(formData.itens_devolvidos, formData.itens_troca, true);
      await atualizarEstoqueAprovacao();
      const lancamentosIds = await criarLancamentosFinanceirosAprovacao();

      if (formData.tipo === 'Troca' && valorDiferenca < 0 && formData.destino_troco === 'credito_loja') {
        const trocoEmCredito = Math.abs(valorDiferenca);
        const clienteId = vendaSelecionada?.cliente_id;
        if (clienteId) {
          try {
            const clienteAtual = await base44.entities.Cliente.read(clienteId);
            const saldoAtual = Number(clienteAtual?.saldo_credito || 0);
            await base44.entities.Cliente.update(clienteId, {
              saldo_credito: saldoAtual + trocoEmCredito
            });
          } catch (creditErr) {
            console.warn('Erro ao registrar crédito no cliente:', creditErr);
          }
        } else {
          console.warn('cliente_id não encontrado na venda; crédito não foi registrado no cadastro.');
        }
      }

      const updatedData = {
        ...formData,
        ...recalculo,
        pagamento_diferenca_ativo: valorDiferenca > 0,
        pagamento_diferenca_valor: valorDiferenca > 0 ? valorDiferenca : 0,
        status: 'Aprovada',
        aprovado_por: user?.email || user?.nome || user?.full_name || 'Sistema',
        data_aprovacao: new Date().toISOString(),
        processado_por: user?.email || user?.nome || user?.full_name || 'Sistema',
        data_processamento: new Date().toISOString(),
        financeiro_lancamento_id: lancamentosIds[0] || null,
        financeiro_lancamentos_ids: lancamentosIds,
        organization_id: formData.organization_id || user?.organization_id
      };

      await onSave(updatedData);
    } catch (error) {
      alert(error?.message || 'Erro ao aprovar devolução.');
      console.error('Erro ao aprovar devolução:', error);
    } finally {
      submitLockRef.current = false;
      setIsApproving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    try {
      await handleSavePendente();
    } catch (error) {
      alert(error?.message || 'Erro ao salvar devolução.');
      console.error('Erro ao salvar devolução:', error);
    } finally {
      submitLockRef.current = false;
    }
  };

  const handleReject = async () => {
    const updatedData = {
      ...formData,
      status: 'Rejeitada'
    };
    await onSave(updatedData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle style={{ color: '#07593f' }}>
            {devolucao ? "Detalhes da Devolução/Troca" : "Nova Devolução/Troca"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="venda">Selecionar Venda *</Label>
                <Popover open={openVendaBusca} onOpenChange={setOpenVendaBusca}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={openVendaBusca}
                      disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                      className="w-full h-10 justify-between text-left font-normal"
                    >
                      <span className="truncate">{vendaSelecionadaLabel}</span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[460px] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Digite ao menos 2 letras para buscar pedido"
                        value={buscaVenda}
                        onValueChange={setBuscaVenda}
                      />
                      <CommandList>
                        {String(buscaVenda || '').trim().length < 2 ? (
                          <CommandEmpty>Digite 2 ou mais caracteres para buscar.</CommandEmpty>
                        ) : vendasFiltradasBusca.length === 0 ? (
                          <CommandEmpty>Nenhum pedido encontrado.</CommandEmpty>
                        ) : (
                          <CommandGroup>
                            {vendasFiltradasBusca.map((venda) => (
                              <CommandItem
                                key={venda.id}
                                value={`${venda.numero_pedido || ''} ${venda.cliente_nome || ''}`}
                                onSelect={() => {
                                  handleVendaChange(venda.id);
                                  setOpenVendaBusca(false);
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${formData.venda_id === venda.id ? 'opacity-100' : 'opacity-0'}`} />
                                <span className="truncate">#{venda.numero_pedido} - {venda.cliente_nome}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label htmlFor="tipo">Tipo *</Label>
                <Select
                  value={formData.tipo}
                  onValueChange={(value) => setFormData({ ...formData, tipo: value })}
                  required
                  disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Devolução">Devolução</SelectItem>
                    <SelectItem value="Troca">Troca</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {vendaSelecionada && (
              <>
                <Alert className={`border-2 ${entregue ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-300'}`}>
                  <AlertDescription>
                    <div className="flex flex-wrap gap-4 items-center">
                      <div>
                        <strong>Cliente:</strong> {vendaSelecionada.cliente_nome}
                      </div>
                      <div>
                        <strong>Total da Venda:</strong> R$ {vendaSelecionada.valor_total?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </div>
                      <div>
                        <strong>Status Entrega:</strong> {verificandoEntrega ? <Loader2 className="w-3 h-3 animate-spin inline ml-1" /> : (entregue ? <Badge className="bg-green-600 ml-1">Entregue</Badge> : <Badge variant="destructive" className="ml-1">Não Entregue</Badge>)}
                      </div>
                      {!entregue && !verificandoEntrega && (
                        <div className="w-full mt-2 text-amber-700 font-medium flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          A troca/devolução pode ser registrada mesmo antes da entrega.
                        </div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>

                <div className="border rounded-lg p-4" style={{ borderColor: '#E5E0D8' }}>
                  <h4 className="font-semibold mb-3" style={{ color: '#07593f' }}>
                    {formData.tipo === 'Troca'
                      ? 'Itens que ENTRAM no estoque (retorno do cliente)'
                      : 'Selecionar Itens para Devolução'}
                  </h4>
                  <div className="space-y-2">
                    {itensVendaSelecionada.map((item, index) => {
                      const quantidadeDisponivel = getQuantidadeMaximaDevolucao(item);
                      const itemJaAdicionado = formData.itens_devolvidos.some(i => i.item_key === `${item.produto_id || 'sem-produto'}_${index}`);

                      return (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <div>
                          <p className="font-medium">{item.produto_nome}</p>
                          <p className="text-sm" style={{ color: '#8B8B8B' }}>
                            Vendido: {item.quantidade} | Disponível p/ devolver: {quantidadeDisponivel}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => adicionarItemDevolucao(item, index)}
                          disabled={(devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada') || itemJaAdicionado || quantidadeDisponivel <= 0}
                          style={{ backgroundColor: '#f38a4c' }}
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Adicionar
                        </Button>
                      </div>
                    );
                    })}
                  </div>
                </div>

                {formData.itens_devolvidos.length > 0 && (
                  <div className="border rounded-lg p-4" style={{ borderColor: '#07593f' }}>
                    <h4 className="font-semibold mb-3" style={{ color: '#07593f' }}>
                      {formData.tipo === 'Troca' ? 'Itens de ENTRADA selecionados' : 'Itens Selecionados'}
                    </h4>
                    <div className="space-y-3">
                      {formData.itens_devolvidos.map((item, index) => (
                        <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded">
                          <div className="flex-1">
                            <p className="font-medium">{item.produto_nome}</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                              <Input
                                type="number"
                                min={1}
                                max={item.quantidade_maxima || 1}
                                value={item.quantidade}
                                onChange={(e) => atualizarItemDevolucao(index, 'quantidade', e.target.value)}
                                disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                                placeholder="Quantidade"
                              />
                              <Input
                                value={(Number(item.preco_unitario || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                disabled
                              />
                              <Input
                                value={(Number(item.quantidade || 0) * Number(item.preco_unitario || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                disabled
                              />
                            </div>
                            <Input
                              placeholder="Motivo da devolução/troca"
                              value={item.motivo}
                              onChange={(e) => atualizarItemDevolucao(index, 'motivo', e.target.value)}
                              className="mt-2"
                              disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removerItemDevolucao(index)}
                            className="text-red-600"
                            disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {formData.tipo === 'Troca' && (
                  <div className="border rounded-lg p-4" style={{ borderColor: '#f38a4c' }}>
                    <h4 className="font-semibold mb-3" style={{ color: '#07593f' }}>
                      Itens que SAEM do estoque (reposição para cliente)
                    </h4>

                    <p className="text-xs text-gray-500 mb-3">
                      Selecione aqui os itens que serão entregues no lugar do item retornado.
                    </p>

                    <BuscaProdutoAvancada
                      produtos={produtosTrocaDisponiveis}
                      fornecedores={fornecedores}
                      onSelectProduto={(produtoSelecionado) => {
                        setProdutoTrocaSelecionadoId(produtoSelecionado.id);
                      }}
                    />

                    {produtoTrocaSelecionado && (
                      <div className="mt-3 p-3 rounded border bg-amber-50 border-amber-200">
                        <p className="text-sm font-semibold text-gray-900">Item selecionado: {produtoTrocaSelecionado.nome}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          Fornecedor: {produtoTrocaSelecionado.fornecedor_nome || 'Nao informado'}
                          {' | '}Categoria: {produtoTrocaSelecionado.categoria || 'Outros'}
                          {' | '}Estoque: {Math.max(0, Number(produtoTrocaSelecionado.quantidade_estoque || 0) - Number(produtoTrocaSelecionado.quantidade_reservada || 0))}
                        </p>
                      </div>
                    )}

                    <div className="grid md:grid-cols-[140px,120px] gap-2 mt-3">
                      <Input
                        type="number"
                        min={1}
                        value={quantidadeTrocaInput}
                        onChange={(e) => setQuantidadeTrocaInput(Math.max(1, Number(e.target.value || 1)))}
                        disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                      />

                      <Button
                        type="button"
                        onClick={adicionarItemTroca}
                        disabled={!produtoTrocaSelecionadoId || (devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada')}
                        style={{ backgroundColor: '#f38a4c' }}
                      >
                        Adicionar
                      </Button>
                    </div>

                    {(formData.itens_troca || []).length > 0 && (
                      <div className="space-y-2 mt-3">
                        {formData.itens_troca.map((item, index) => (
                          <div key={`${item.produto_id}_${index}`} className="grid md:grid-cols-[1fr,120px,180px,56px] gap-2 items-center p-2 rounded bg-gray-50">
                            <p className="text-sm font-medium">{item.produto_nome}</p>
                            <Input
                              type="number"
                              min={1}
                              value={item.quantidade}
                              onChange={(e) => atualizarItemTroca(index, e.target.value)}
                              disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                            />
                            <Input
                              value={(Number(item.quantidade || 0) * Number(item.preco_unitario || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              disabled
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-red-600"
                              onClick={() => removerItemTroca(index)}
                              disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                    {formData.tipo === 'Troca' && valorDiferenca > 0 && (
                      <div className="border rounded-lg p-4" style={{ borderColor: '#3b82f6' }}>
                        <h4 className="font-semibold mb-3" style={{ color: '#07593f' }}>
                          Pagamento da diferença
                        </h4>

                        <Alert className="mb-4 border-orange-200 bg-orange-50 text-orange-900">
                          <AlertDescription>
                            O cliente ficou com um item mais caro. Registre aqui como a diferença de R$ {valorDiferenca.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} foi paga.
                          </AlertDescription>
                        </Alert>

                        <div className="grid md:grid-cols-[1fr,140px] gap-2">
                          <div>
                            <Label htmlFor="forma_pagamento_diferenca">Forma de pagamento da diferença *</Label>
                            <Select
                              value={formData.forma_pagamento_diferenca || ''}
                              onValueChange={(value) => setFormData((prev) => ({
                                ...prev,
                                forma_pagamento_diferenca: value,
                                pagamento_diferenca_ativo: true,
                                pagamento_diferenca_parcelas: value.includes('Crédito') ? Math.max(1, Number(prev.pagamento_diferenca_parcelas || 1)) : 1,
                                pagamento_diferenca_valor: valorDiferenca
                              }))}
                              disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione a forma de pagamento" />
                              </SelectTrigger>
                              <SelectContent>
                                {PAYMENT_METHOD_OPTIONS_DELIVERY.map((method) => (
                                  <SelectItem key={method} value={method}>{method}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label htmlFor="valor_diferenca_pagamento">Valor</Label>
                            <Input
                              id="valor_diferenca_pagamento"
                              value={valorDiferenca.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              disabled
                            />
                          </div>
                        </div>

                        {String(formData.forma_pagamento_diferenca || '').includes('Crédito') && (
                          <div className="mt-3 w-full md:w-44">
                            <Label htmlFor="pagamento_diferenca_parcelas">Parcelas *</Label>
                            <Select
                              value={String(formData.pagamento_diferenca_parcelas || 1)}
                              onValueChange={(value) => setFormData((prev) => ({
                                ...prev,
                                pagamento_diferenca_parcelas: Number(value),
                                pagamento_diferenca_ativo: true,
                                pagamento_diferenca_valor: valorDiferenca
                              }))}
                              disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="1x" />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 12 }).map((_, i) => (
                                  <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}x</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        <div className="mt-3">
                          <Label htmlFor="pagamento_diferenca_observacao">Observação do pagamento</Label>
                          <Textarea
                            id="pagamento_diferenca_observacao"
                            value={formData.pagamento_diferenca_observacao || ''}
                            onChange={(e) => setFormData((prev) => ({ ...prev, pagamento_diferenca_observacao: e.target.value, pagamento_diferenca_ativo: true }))}
                            rows={2}
                            placeholder="Ex: pago via Pix no ato, parcela no cartão, etc."
                            disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                          />
                        </div>

                        <div className="mt-3 flex gap-2 flex-wrap">
                          <Button
                            type="button"
                            onClick={adicionarPagamentoDiferenca}
                            disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                            style={{ backgroundColor: '#07593f' }}
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Adicionar pagamento
                          </Button>
                        </div>

                        {pagamentosDiferenca.length > 0 && (
                          <div className="space-y-2 mt-4">
                            {pagamentosDiferenca.map((pagamento, index) => (
                              <div key={`${pagamento.attempt_id || index}`} className="flex justify-between items-center p-3 bg-gray-50 rounded border">
                                <div>
                                  <p className="font-medium text-sm">{pagamento.forma_pagamento}</p>
                                  {pagamento.parcelas > 1 && <p className="text-xs text-blue-600">{pagamento.parcelas}x</p>}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-semibold">R$ {Number(pagamento.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-red-600"
                                    onClick={() => removerPagamentoDiferenca(index)}
                                    disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {!validacaoPagamentoDiferenca.ok && validacaoPagamentoDiferenca.errors.length > 0 && (
                          <Alert className="mt-4 border-amber-200 bg-amber-50">
                            <AlertDescription className="text-amber-800 text-sm">
                              {validacaoPagamentoDiferenca.errors[0]}
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}
              </>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="data_devolucao">Data *</Label>
                <Input
                  id="data_devolucao"
                  type="date" lang="pt-BR"
                  value={formData.data_devolucao}
                  onChange={(e) => setFormData({ ...formData, data_devolucao: e.target.value })}
                  required
                  disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                />
              </div>
              <div>
                <Label htmlFor="status">Status *</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                  disabled
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pendente">Pendente</SelectItem>
                    <SelectItem value="Aprovada">Aprovada</SelectItem>
                    <SelectItem value="Rejeitada">Rejeitada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="destino_estoque">Destino do Estoque *</Label>
                <Select
                  value={formData.destino_estoque || ''}
                  onValueChange={(value) => setFormData({ ...formData, destino_estoque: value })}
                  disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {lojasDestino.length === 0 ? (
                      <SelectItem value="_sem_lojas" disabled>Nenhuma loja cadastrada ativa</SelectItem>
                    ) : (
                      lojasDestino.map((loja) => (
                        <SelectItem key={loja} value={loja}>{loja}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="justificativa_financeira">Justificativa Financeira *</Label>
                <Textarea
                  id="justificativa_financeira"
                  value={formData.justificativa_financeira || ''}
                  onChange={(e) => setFormData({ ...formData, justificativa_financeira: e.target.value })}
                  rows={2}
                  placeholder="Descreva o motivo financeiro da devolução/troca"
                  disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="valor_devolvido">Valor Devolvido (R$)</Label>
                <Input
                  id="valor_devolvido"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.valor_devolvido}
                  onChange={(e) => {
                    setValorEditadoManual(true);
                    const valor = Number(e.target.value || 0);
                    const valorTroca = calcularTotalItensTroca(formData.itens_troca);
                    setFormData({
                      ...formData,
                      valor_devolvido: valor,
                      valor_diferenca: valorTroca - valor
                    });
                  }}
                  disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                />
              </div>

              <div>
                <Label htmlFor="valor_diferenca">Diferença da Troca (R$)</Label>
                <Input
                  id="valor_diferenca"
                  type="number"
                  value={Number(formData.valor_diferenca || 0).toFixed(2)}
                  disabled
                />
              </div>
            </div>
      {formData.tipo === 'Troca' && valorDiferenca > 0 && (
        <div className="border rounded-lg p-4" style={{ borderColor: '#3b82f6' }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h4 className="font-semibold" style={{ color: '#07593f' }}>
                Pagamento da diferença
              </h4>
              <p className="text-xs text-gray-500">
                A troca gerou uma diferença de R$ {valorDiferenca.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Registre aqui como o cliente pagou.
              </p>
            </div>
            <div className="text-right text-xs">
              <p className="text-gray-500">Pago</p>
              <p className="font-semibold text-green-700">R$ {validacaoPagamentoDiferenca.totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              <p className="text-gray-500">Restante</p>
              <p className={`font-semibold ${validacaoPagamentoDiferenca.restante > 0 ? 'text-red-600' : 'text-green-700'}`}>
                R$ {validacaoPagamentoDiferenca.restante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label>Forma de pagamento</Label>
              <Select
                value={novoPagamentoDiferenca.forma}
                onValueChange={(value) => setNovoPagamentoDiferenca((prev) => ({ ...prev, forma: value }))}
                disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a forma" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS.map((method) => (
                    <SelectItem key={method} value={method}>{method}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Valor do pagamento</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={novoPagamentoDiferenca.valor}
                onChange={(e) => setNovoPagamentoDiferenca((prev) => ({ ...prev, valor: e.target.value }))}
                disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                placeholder={`Até R$ ${valorDiferenca.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
              />
            </div>
          </div>

          {isInstallmentPaymentMethod(novoPagamentoDiferenca.forma) && (
            <div className="mt-3 max-w-[160px]">
              <Label>Parcelas</Label>
              <Select
                value={String(novoPagamentoDiferenca.parcelas || 1)}
                onValueChange={(value) => setNovoPagamentoDiferenca((prev) => ({ ...prev, parcelas: Number(value) }))}
                disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="1x" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }).map((_, index) => (
                    <SelectItem key={index + 1} value={String(index + 1)}>
                      {index + 1}x
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="mt-3">
            <Button
              type="button"
              onClick={adicionarPagamentoDiferenca}
              disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
              style={{ backgroundColor: '#07593f' }}
            >
              <Plus className="w-4 h-4 mr-1" />
              Adicionar pagamento
            </Button>
          </div>

          {pagamentosDiferenca.length > 0 && (
            <div className="space-y-2 mt-4">
              {pagamentosDiferenca.map((pagamento, index) => (
                <div key={`${pagamento.attempt_id || index}`} className="flex justify-between items-center p-3 bg-gray-50 rounded border">
                  <div>
                    <p className="font-medium text-sm">{pagamento.forma_pagamento}</p>
                    {pagamento.parcelas > 1 && <p className="text-xs text-blue-600">{pagamento.parcelas}x</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">R$ {Number(pagamento.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-red-600"
                      onClick={() => removerPagamentoDiferenca(index)}
                      disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!validacaoPagamentoDiferenca.ok && validacaoPagamentoDiferenca.errors.length > 0 && (
            <Alert className="mt-4 border-amber-200 bg-amber-50">
              <AlertDescription className="text-amber-800 text-sm">
                {validacaoPagamentoDiferenca.errors[0]}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

            {formData.tipo === 'Troca' && valorDiferenca < 0 && (
              <div className="border rounded-lg p-4" style={{ borderColor: '#6366f1' }}>
                <h4 className="font-semibold mb-3" style={{ color: '#07593f' }}>
                  Destino do troco
                </h4>
                <Alert className="mb-4 border-blue-200 bg-blue-50 text-blue-900">
                  <AlertDescription>
                    A loja deve R$ {Math.abs(valorDiferenca).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ao cliente (o item da troca é mais barato). Escolha como proceder.
                  </AlertDescription>
                </Alert>
                <div className="grid md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, destino_troco: 'devolver' }))}
                    disabled={Boolean(devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada')}
                    className={`p-4 rounded-lg border-2 text-left transition-all w-full ${formData.destino_troco === 'devolver' ? 'border-green-600 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}
                  >
                    <p className="font-semibold text-sm">Devolver dinheiro</p>
                    <p className="text-xs text-gray-500 mt-1">Gera um lançamento financeiro de despesa pendente a pagar ao cliente.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, destino_troco: 'credito_loja' }))}
                    disabled={Boolean(devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada')}
                    className={`p-4 rounded-lg border-2 text-left transition-all w-full ${formData.destino_troco === 'credito_loja' ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
                  >
                    <p className="font-semibold text-sm">Crédito na loja</p>
                    <p className="text-xs text-gray-500 mt-1">O saldo fica no cadastro do cliente e é descontado automaticamente na próxima compra no PDV.</p>
                  </button>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="observacoes">Observações</Label>
              <Textarea
                id="observacoes"
                value={formData.observacoes}
                onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                rows={3}
                disabled={devolucao && devolucao.status !== 'Pendente' && devolucao.status !== 'Rejeitada'}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>

            {devolucao && canApprove && devolucao.status === 'Pendente' && (
              <>
                <Button
                  type="button"
                  onClick={handleReject}
                  variant="destructive"
                  disabled={isLoading || isApproving}
                >
                  Rejeitar
                </Button>
                <Button
                  type="button"
                  onClick={handleApprove}
                  disabled={isLoading || isApproving || (formData.tipo === 'Troca' && valorDiferenca > 0 && (!formData.forma_pagamento_diferenca || validacaoPagamentoDiferenca.restante > 0)) || (formData.tipo === 'Troca' && valorDiferenca < 0 && !formData.destino_troco)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isApproving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Aprovando...
                    </>
                  ) : 'Aprovar'}
                </Button>
              </>
            )}

            {(!devolucao || devolucao.status === 'Pendente' || devolucao.status === 'Rejeitada') && (
              <Button
                type="submit"
                disabled={isLoading || isApproving || !formData.venda_id || formData.itens_devolvidos.length === 0 || (formData.tipo === 'Troca' && valorDiferenca > 0 && !formData.forma_pagamento_diferenca) || (formData.tipo === 'Troca' && valorDiferenca < 0 && !formData.destino_troco)}
                style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  devolucao ? "Salvar Pendente" : "Criar Devolução"
                )}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
