/**
 * conferenciaCaixaService.js
 * 
 * Serviço centralizado para o módulo de Conferência de Caixa.
 * Responsável por:
 * - Aprovar conferência → cria entrega, montagens e lançamentos financeiros
 * - Devolver/rejeitar → volta a venda para edição do vendedor
 */

import { base44 } from '@/api/base44Client';
import { supabase } from '@/lib/supabase';
import { obterDataLocalString, adicionarDias } from '@/utils/dateUtils';
import { findCategoriaByNames } from '@/lib/financeiroRecorrencia';
import { formatarNome } from '@/utils/formatters';
import { createOperationalFinancialEntry } from '@/services/financialOperations';

// ─────────────────────────────────────────────────────────────
// Lançamentos Financeiros (extraído do PDV para reutilização)
// ─────────────────────────────────────────────────────────────
export const criarLancamentosVendaConferida = async (venda, taxas = [], categoriasFinanceiras = []) => {
  const hoje = obterDataLocalString();
  const pagamentos = venda.conferencia_caixa_pagamentos || venda.pagamentos || [];
  const formaPrimaria = pagamentos[0]?.forma_pagamento || 'Diversos';

  const categoriaRecebimento = findCategoriaByNames(categoriasFinanceiras, [
    'Recebimento de Parcela',
    'Venda de Produtos',
    'Vendas',
  ]);
  const criar = (sufixo, entry) => createOperationalFinancialEntry({
    sourceType: 'venda',
    sourceId: venda.id,
    operationKey: `venda:${venda.id}:${sufixo}`,
    entry: { ...entry, venda_id: venda.id, numero_pedido: venda.numero_pedido },
  });

  // 1. Receita Bruta da Venda
  await criar('receita', {
    descricao: `Venda #${venda.numero_pedido} - ${formatarNome(venda.cliente_nome)}`,
    valor: venda.valor_total + (venda.desconto || 0),
    tipo: 'receita',
    data_vencimento: hoje,
    data_lancamento: hoje,
    pago: venda.status === 'Pago' || venda.status === 'Pago & Retirado',
    categoria_id: categoriaRecebimento?.id || null,
    categoria_nome: categoriaRecebimento?.nome || 'Vendas',
    forma_pagamento: formaPrimaria,
    status: (venda.status === 'Pago' || venda.status === 'Pago & Retirado') ? 'Pago' : 'Pendente',
    observacao: `Pedido ${venda.numero_pedido} — conferido pelo caixa`,
  });

  // 2. Desconto (se houver)
  if ((venda.desconto || 0) > 0) {
    await criar('desconto', {
      descricao: `Desconto Venda #${venda.numero_pedido}`,
      valor: -venda.desconto,
      tipo: 'despesa',
      data_vencimento: hoje,
      data_lancamento: hoje,
      pago: true,
      categoria_nome: 'Descontos Concedidos',
      status: 'Pago',
      observacao: 'Desconto aplicado no PDV',
    });
  }

  // 3. Taxas de cartão (para cada pagamento)
  for (const [paymentIndex, pagamento] of pagamentos.entries()) {
    const taxa = (taxas || []).find((t) => {
      if (pagamento.forma_pagamento === 'Crédito' && pagamento.parcelas > 1) {
        return t.forma_pagamento === 'Crédito Parcelado';
      }
      return (
        t.forma_pagamento === pagamento.forma_pagamento ||
        t.forma_pagamento === pagamento.forma_pagamento?.replace(' 1x', '')
      );
    });

    if (taxa && taxa.valor > 0) {
      const valorTaxa =
        taxa.tipo_taxa === 'porcentagem'
          ? (pagamento.valor * taxa.valor) / 100
          : taxa.valor;

      if (valorTaxa > 0) {
        await criar(`taxa:${paymentIndex}`, {
          descricao: `Taxa ${pagamento.forma_pagamento} — Venda #${venda.numero_pedido}`,
          valor: -valorTaxa,
          tipo: 'despesa',
          data_vencimento: hoje,
          data_lancamento: hoje,
          pago: true,
          categoria_nome: 'Taxas de Cartão',
          forma_pagamento: pagamento.forma_pagamento,
          status: 'Pago',
          observacao: `${taxa.valor}${taxa.tipo_taxa === 'porcentagem' ? '%' : ' R$'} sobre R$ ${pagamento.valor?.toFixed(2)}`,
        });
      }
    }
  }
};

// ─────────────────────────────────────────────────────────────
// Criação de Entrega e Montagens
// ─────────────────────────────────────────────────────────────
const criarEntregaEMontagens = async (venda, prazosConfig = []) => {
  const prazoSelecionado = (prazosConfig || []).find((p) => {
    const label = `${p.quantidade_dias} dias ${p.tipo_dias === 'uteis' ? 'úteis' : 'corridos'}`;
    return p.identificador === venda.prazo_entrega || p.titulo === venda.prazo_entrega || label === venda.prazo_entrega;
  });
  const dias = prazoSelecionado?.quantidade_dias || 15;
  const tipoDias = prazoSelecionado?.tipo_dias || 'uteis';
  const dataBase = obterDataLocalString();
  const dataLimite = adicionarDias(dataBase, dias, tipoDias);

  const todosRetiram = (venda.itens || []).every((i) => i.tipo_entrega === 'retira');
  const enderecoEntrega = venda.endereco_entrega || `Retirado na loja: ${venda.loja}`;

  // Identificar tipo de montagem para o resumo da entrega
  const getTipoMontagemFinal = (item) => {
    if (item.tipo_montagem_padrao === 'nao_requer_montagem') return 'nao_requer_montagem';
    return item.tipo_montagem || null;
  };

  const itensParaMontagemInterna = (venda.itens || [])
    .filter((i) => getTipoMontagemFinal(i) === 'montado')
    .map((i) => ({ produto_nome: i.produto_nome, quantidade: i.quantidade, montado: false }));

  // Criar a entrega
  const entregaCriada = await base44.entities.Entrega.create({
    venda_id: venda.id,
    numero_pedido: venda.numero_pedido,
    cliente_nome: venda.cliente_nome,
    cliente_telefone: venda.cliente_telefone,
    endereco_entrega: enderecoEntrega,
    data_limite: obterDataLocalString(dataLimite),
    prazo_entrega: venda.prazo_entrega,
    data_liberacao: null,
    status: todosRetiram ? 'Retirado' : 'Pendente',
    tipo_montagem:
      (venda.itens || []).length === 1
        ? getTipoMontagemFinal(venda.itens[0])
        : 'Múltiplos Itens',
    montagem_status: (venda.itens || []).some((i) => {
      const tf = getTipoMontagemFinal(i);
      return tf === 'montado' || tf === 'montagem_cliente';
    })
      ? 'Pendente'
      : null,
    itens_montagem_interna: itensParaMontagemInterna,
    pagamento_na_entrega: venda.pagamento_na_entrega || false,
    valor_a_receber: venda.pagamento_na_entrega ? (venda.valor_pagamento_entrega || 0) : 0,
    forma_pagamento_entrega: venda.pagamento_na_entrega ? venda.forma_pagamento_entrega : null,
    loja_id: venda.loja_id || null,
    vendedor_id: venda.responsavel_id || null,
  });

  // Criar itens de montagem
  const montagensParaCriar = (venda.itens || [])
    .map((item) => {
      const tipoFinal = getTipoMontagemFinal(item);
      if (tipoFinal === 'montagem_cliente') {
        return {
          entrega_id: entregaCriada.id,
          venda_id: venda.id,
          produto_id: item.produto_id,
          produto_nome: item.produto_nome,
          quantidade: item.quantidade,
          tipo_montagem: 'terceirizada',
          status: 'pendente',
          cliente_nome: venda.cliente_nome,
          cliente_telefone: venda.cliente_telefone,
          endereco: enderecoEntrega,
          numero_pedido: venda.numero_pedido,
        };
      }
      if (tipoFinal === 'montado') {
        return {
          entrega_id: entregaCriada.id,
          venda_id: venda.id,
          produto_id: item.produto_id,
          produto_nome: item.produto_nome,
          quantidade: item.quantidade,
          tipo_montagem: 'interna',
          status: 'pendente',
          cliente_nome: venda.cliente_nome,
          cliente_telefone: venda.cliente_telefone,
          endereco: enderecoEntrega,
          numero_pedido: venda.numero_pedido,
        };
      }
      return null;
    })
    .filter(Boolean);

  if (montagensParaCriar.length > 0) {
    await Promise.all(
      montagensParaCriar.map((payload) => base44.entities.MontagemItem.create(payload))
    );
  }

  return entregaCriada;
};

// ─────────────────────────────────────────────────────────────
// APROVAR CONFERÊNCIA
// ─────────────────────────────────────────────────────────────
/**
 * Aprova a conferência de caixa de uma venda.
 * Executa: atualiza venda, cria entrega+montagens, cria lançamentos financeiros.
 *
 * @param {Object} params
 * @param {Object} params.venda - objeto da venda (com id, dados completos)
 * @param {Object} params.gerente - { id, nome } do gerente que está aprovando
 * @param {Array}  params.pagamentosConferidos - formas de pagamento confirmadas/alteradas
 * @param {string} params.observacao - observação opcional do gerente
 * @param {Array}  params.taxas - taxas financeiras configuradas
 * @param {Array}  params.categoriasFinanceiras - categorias financeiras
 * @param {Array}  params.prazosConfig - prazos de entrega configurados
 */
export const aprovarConferencia = async ({
  venda,
  gerente,
  pagamentosConferidos,
  observacao = '',
  taxas = [],
  categoriasFinanceiras = [],
  prazosConfig = [],
}) => {
  const agora = new Date().toISOString();

  // 1. Determinar novo status financeiro baseado nos pagamentos conferidos
  const totalPagamentos = (pagamentosConferidos || []).reduce(
    (sum, p) => sum + Number(p.valor || 0),
    0
  );
  const valorRestante = Math.max((venda.valor_total || 0) - totalPagamentos, 0);
  const novoStatus =
    valorRestante <= 0.01
      ? (venda.pagamento_na_entrega ? 'Pago & Retirado' : 'Pago')
      : 'Pagamento Pendente';

  const formaPagamentoResumo =
    pagamentosConferidos.length === 1
      ? pagamentosConferidos[0].forma_pagamento
      : pagamentosConferidos.length > 1
        ? 'Múltiplos'
        : venda.forma_pagamento || 'Diversos';

  // 2. Atualizar a venda: marcar como aprovada + salvar pagamentos conferidos
  const vendaAtualizada = await base44.entities.Venda.update(venda.id, {
    conferencia_caixa_status: 'aprovado',
    conferencia_caixa_at: agora,
    conferencia_caixa_por: gerente.nome,
    conferencia_caixa_por_id: gerente.id,
    conferencia_caixa_observacao: observacao || null,
    conferencia_caixa_pagamentos: pagamentosConferidos,
    // Atualizar também os pagamentos principais da venda
    pagamentos: pagamentosConferidos,
    forma_pagamento: formaPagamentoResumo,
    valor_pago: totalPagamentos,
    valor_restante: valorRestante,
    status: novoStatus,
  });

  // 3. Criar Entrega + Montagens
  await criarEntregaEMontagens({ ...venda, ...vendaAtualizada }, prazosConfig);

  // 4. Criar Lançamentos Financeiros
  await criarLancamentosVendaConferida(
    { ...venda, ...vendaAtualizada, pagamentos: pagamentosConferidos },
    taxas,
    categoriasFinanceiras
  );

  return vendaAtualizada;
};

// ─────────────────────────────────────────────────────────────
// DEVOLVER PARA O VENDEDOR
// ─────────────────────────────────────────────────────────────
/**
 * Devolve a venda para o vendedor editar.
 * Remove o status de conferência, adiciona observação do gerente.
 */
export const devolverParaVendedor = async ({ venda, gerente, motivo }) => {
  return base44.entities.Venda.update(venda.id, {
    conferencia_caixa_status: 'devolvido',
    conferencia_caixa_at: new Date().toISOString(),
    conferencia_caixa_por: gerente.nome,
    conferencia_caixa_por_id: gerente.id,
    conferencia_caixa_observacao: motivo || null,
  });
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
export const isAguardandoConferencia = (venda) =>
  venda?.conferencia_caixa_status === 'aguardando' ||
  venda?.conferencia_caixa_status === 'devolvido';

export const isConferido = (venda) =>
  venda?.conferencia_caixa_status === 'aprovado';
