import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { buildProductDisplayName } from "@/utils/productReference";

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

function mergeOcMetadata(currentMetadata = {}, incomingMetadata = {}, lojaId = null) {
  return {
    ...currentMetadata,
    ...incomingMetadata,
    loja_id: incomingMetadata.loja_id || lojaId || currentMetadata.loja_id || null,
  };
}

async function validarFornecedorDosItensOc(fornecedorId, itens = []) {
  if (!fornecedorId || !Array.isArray(itens) || itens.length === 0) {
    return;
  }

  const produtoIds = [...new Set(
    itens
      .map((item) => item.produto_id)
      .filter(Boolean)
  )];

  if (produtoIds.length === 0) {
    return;
  }

  const { data: produtos = [], error } = await supabase
    .from('produtos')
    .select('id, nome, fornecedor_id')
    .in('id', produtoIds);

  if (error) {
    throw new Error(`Erro ao validar fornecedor dos itens: ${error.message}`);
  }

  const produtosFornecedorDivergente = produtos.filter((produto) => {
    if (!produto?.id) return false;
    if (!produto?.fornecedor_id) return false;
    return String(produto.fornecedor_id) !== String(fornecedorId);
  });

  if (produtosFornecedorDivergente.length > 0) {
    const nomes = produtosFornecedorDivergente
      .map((produto) => produto.nome)
      .filter(Boolean)
      .join(', ');

    throw new Error(`A OC só pode conter itens do fornecedor selecionado. Produtos divergentes: ${nomes}`);
  }
}

/**
 * Serviço centralizado para operações de Compras
 * Padrão: Usa Base44 SDK para CRUD + lógica de automação
 * Inclui: Approval Workflow + Partial Receipts
 */

export const comprasService = {
  /**
   * Lista todas as OCs com opção de ordenação
   * @param {string} orderBy - Campo para ordenação (ex: '-data_pedido')
   * @returns {Promise<Array>}
   */
  async listOcs(orderBy = '-created_at') {
    try {
      const ocs = await base44.entities.ComprasOrden.filter({ deleted_at: null }, orderBy);
      return ocs || [];
    } catch (error) {
      console.error('Erro ao listar OCs:', error);
      throw error;
    }
  },

  /**
   * Busca uma OC pelo ID com seus itens relacionados
   * @param {string} ocId - UUID da OC
   * @returns {Promise<Object>}
   */
  async getOcDetalhes(ocId) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);
      
      // Buscar itens da OC
      const { data: itens } = await supabase
        .from('compras_oc_itens')
        .select('*')
        .eq('ordem_compra_id', ocId);
      
      return {
        ...oc,
        itens: itens || []
      };
    } catch (error) {
      console.error('Erro ao buscar detalhes da OC:', error);
      throw error;
    }
  },

  /**
   * Cria uma nova OC (Ordem de Compra)
   * @param {Object} data - { fornecedor_id, itens, centro_custo_id, data_previsao_entrega, observacoes }
   * @returns {Promise<Object>} OC criada
   */
  async createOc(data) {
    try {
      const {
        fornecedor_id,
        fornecedor_nome,
        itens = [], // Array de { produto_id, quantidade_pedida, preco_unitario }
        centro_custo_id,
        data_previsao_entrega,
        observacoes,
        loja_id,
        metadata = {},
        forma_pagamento_oc = 'a_vista',
        observacoes_aprovacao = null,
        anexos_aprovacao = [],
        anexo_fornecedor = [],
        anexos_financeiro = [],
      } = data;

      if (!fornecedor_id || itens.length === 0) {
        throw new Error('Fornecedor e itens são obrigatórios');
      }

      await validarFornecedorDosItensOc(fornecedor_id, itens);

      // Calcular valor total
      const valor_total = itens.reduce((sum, item) => 
        sum + (item.quantidade_pedida * item.preco_unitario), 0
      );

      // Gerar número do pedido
      const numeroOc = await this._gerarNumeroPedido();

      // Criar OC em status Rascunho com approval_status Pendente
      const novaOc = await base44.entities.ComprasOrden.create({
        numero_pedido: numeroOc,
        fornecedor_id,
        fornecedor_nome,
        centro_custo_id,
        data_previsao_entrega,
        observacoes,
        valor_total,
        status: 'Rascunho',
        approval_status: 'Pendente',
        forma_pagamento_oc,
        pagamento_status: 'nao_aplicavel',
        observacoes_aprovacao: observacoes_aprovacao || null,
        anexos_aprovacao: anexos_aprovacao || [],
        anexo_fornecedor: anexo_fornecedor || [],
        anexos_financeiro: anexos_financeiro || [],
        metadata: mergeOcMetadata({}, metadata, loja_id),
        data_pedido: new Date().toISOString().split('T')[0]
      });

      // Criar itens da OC
      for (const item of itens) {
        await base44.entities.ComprasOcItem.create({
          ordem_compra_id: novaOc.id,
          produto_id: item.produto_id,
          produto_nome: item.produto_nome,
          nome_completo_produto: item.nome_completo_produto || item.produto_nome || null,
          cor_item: item.cor_item || item.cor || null,
          descricao_personalizada: item.descricao_personalizada || null,
          tipo_item_oc: item.tipo_item_oc || 'ORDEM_COMUM_ENCOMENDA',
          origem_solicitacao: item.origem_solicitacao || 'VENDEDOR',
          pedido_origem_numero: item.pedido_origem_numero || null,
          reposicao_fabrica: item.reposicao_fabrica || false,
          motivo_assistencia: item.motivo_assistencia || null,
          possui_imagens_videos: item.possui_imagens_videos || false,
          anexos_item: item.anexos_item || [],
          quantidade_pedida: item.quantidade_pedida,
          preco_custo_item: item.preco_custo_item || null,
          markup_multiplicador: item.markup_multiplicador ? parseFloat(item.markup_multiplicador) : null,
          markup_percentual: item.markup_percentual ? parseFloat(item.markup_percentual) : null,
          preco_final_sugerido: item.preco_final_sugerido || null,
          preco_final_manual: item.preco_final_manual || null,
          preco_unitario: item.preco_unitario,
          preco_tabela: item.preco_tabela,
          quantidade_recebida: 0,
          status_recebimento: 'Pendente'
        });
      }

      // Atualizar SolicitacaoEncomenda se existir (vincular)
      if (data.solicitacoes_encomenda_ids) {
        for (const solicId of data.solicitacoes_encomenda_ids) {
          await supabase
            .from('solicitacoes_encomenda')
            .update({
              ordem_id: novaOc.id,
              status: 'em_compra',
            })
            .eq('id', solicId);
        }
      }

      return novaOc;
    } catch (error) {
      console.error('Erro ao criar OC:', error);
      throw error;
    }
  },

  /**
   * Submete uma OC para Aprovação
   * Transição: Rascunho → Aguardando Aprovação
   * @param {string} ocId - UUID da OC
   * @returns {Promise<Object>}
   */
  async submitForApproval(ocId) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);
      
      if (oc.status !== 'Rascunho') {
        throw new Error(`Só é possível enviar OCs em status "Rascunho" para aprovação. Status atual: ${oc.status}`);
      }

      return await base44.entities.ComprasOrden.update(ocId, {
        status: 'Aguardando Aprovacao',
        approval_status: 'Pendente',
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erro ao enviar OC para aprovação:', error);
      throw error;
    }
  },

  /**
   * Aprova uma OC
   * Transição: Aguardando Aprovação → Aguardando Envio
   * @param {string} ocId - UUID da OC
   * @param {Object} data - { comments? }
   * @returns {Promise<Object>}
   */
  async approveOc(ocId, data = {}) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);
      
      if (oc.status !== 'Aguardando Aprovacao') {
        throw new Error(`Só é possível aprovar OCs em status "Aguardando Aprovação". Status atual: ${oc.status}`);
      }

      // Aqui você pode adicionar lógica para obter o ID do usuário aprovador
      // Para agora, deixamos como null - a aplicação React passará o user_id
      const approvedBy = data.approved_by || null;

      return await base44.entities.ComprasOrden.update(ocId, {
        status: 'Aguardando Envio',
        approval_status: 'Aprovado',
        approved_by: approvedBy,
        approval_date: new Date().toISOString(),
        approval_comments: data.comments || '',
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erro ao aprovar OC:', error);
      throw error;
    }
  },

  /**
   * Rejeita uma OC
   * Transição: Aguardando Aprovação → Rascunho (para revisão)
   * @param {string} ocId - UUID da OC
   * @param {Object} data - { comments }
   * @returns {Promise<Object>}
   */
  async rejectOc(ocId, data = {}) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);
      
      if (oc.status !== 'Aguardando Aprovacao') {
        throw new Error(`Só é possível rejeitar OCs em status "Aguardando Aprovação". Status atual: ${oc.status}`);
      }

      const rejectedBy = data.rejected_by || null;

      return await base44.entities.ComprasOrden.update(ocId, {
        status: 'Rascunho', // Volta para rascunho para revisão
        approval_status: 'Rejeitado',
        approved_by: rejectedBy,
        approval_date: new Date().toISOString(),
        approval_comments: data.comments || '',
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erro ao rejeitar OC:', error);
      throw error;
    }
  },

  /**
   * Atualiza o status de uma OC com validação de transição
   * Estados válidos: Rascunho, Aguardando Aprovacao, Aguardando Envio, Pedido Enviado, 
   *                  Parcialmente Recebido, Recebido, Cancelada
   * @param {string} ocId - UUID da OC
   * @param {string} novoStatus - Novo status
   * @returns {Promise<Object>}
   */
  async updateOcStatus(ocId, novoStatus, trackingData = null) {
    try {
      const statusValidos = [
        'Rascunho',
        'Aguardando Aprovacao',
        'Aguardando Envio',
        'Pedido Enviado',
        'Parcialmente Recebido',
        'Recebido',
        'Cancelada'
      ];
      
      if (!statusValidos.includes(novoStatus)) {
        throw new Error(`Status inválido: ${novoStatus}`);
      }

      const oc = await base44.entities.ComprasOrden.get(ocId);
      
      // Validar transição de estado
      const transicoes = {
        'Rascunho': ['Aguardando Aprovacao', 'Pedido Enviado', 'Cancelada'],
        'Aguardando Aprovacao': ['Aguardando Envio', 'Rascunho', 'Cancelada'],
        'Aguardando Envio': ['Pedido Enviado', 'Rascunho', 'Cancelada'],
        'Pedido Enviado': ['Parcialmente Recebido', 'Recebido', 'Cancelada'],
        'Parcialmente Recebido': ['Recebido', 'Cancelada'],
        'Recebido': ['Cancelada'],
        'Cancelada': []
      };

      if (!transicoes[oc.status]?.includes(novoStatus)) {
        throw new Error(`Transição inválida de ${oc.status} para ${novoStatus}`);
      }

      const updateData = {
        status: novoStatus,
        updated_at: new Date().toISOString()
      };

      // Auto-capture send timestamp and channel when transitioning to 'Pedido Enviado'
      if (novoStatus === 'Pedido Enviado' && trackingData) {
        const metadataAtual = oc.metadata || {};
        const metadataNova = mergeOcMetadata(
          metadataAtual,
          {
            data_hora_enviado: trackingData.data_hora_enviado || new Date().toISOString(),
            canal_envio: trackingData.canal_envio || '',
            canal_solicitacao: trackingData.canal_solicitacao || metadataAtual.canal_solicitacao || '',
            quem_aceitou: trackingData.quem_aceitou || metadataAtual.quem_aceitou || '',
            pendencias: trackingData.pendencias || metadataAtual.pendencias || '',
          },
          metadataAtual.loja_id || null
        );
        updateData.metadata = metadataNova;
      }

      return await base44.entities.ComprasOrden.update(ocId, updateData);
    } catch (error) {
      console.error('Erro ao atualizar status da OC:', error);
      throw error;
    }
  },

  /**
   * Registra um recebimento de OC (com suporte a recebimentos parciais)
   * Atualiza estoque, histórico de recebimento e cria lançamento financeiro
   * @param {string} ocId - UUID da OC
   * @param {Object} dadosRecebimento - { itens_recebidos[{ item_id, quantidade_recebida }], chave_nfe?, observacoes? }
   * @returns {Promise<Object>}
   */
  async receberOc(ocId, dadosRecebimento) {
    if (!dadosRecebimento.request_id) throw new Error('Chave de idempotência do recebimento obrigatória');
    const { data, error } = await supabase.rpc('registrar_recebimento_oc', {
      p_ordem_compra_id: ocId,
      p_recebimento_id: dadosRecebimento.request_id,
      p_itens: dadosRecebimento.itens_recebidos || [],
      p_chave_nfe: dadosRecebimento.chave_nfe || null,
      p_observacoes: dadosRecebimento.observacoes || null,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Cancela uma OC
   * @param {string} ocId - UUID da OC
   * @param {string} motivo - Motivo do cancelamento
   * @returns {Promise<Object>}
   * @throws {Error} Se OC já foi recebida e contabilizou estoque
   */
  async cancelOc(ocId, motivo = '') {
    try {
      // Buscar OC para verificar seu status
      const oc = await base44.entities.ComprasOrden.get(ocId);

      // Validação: Não permite cancelar OCs que já foram recebidas
      if (oc.status === 'Recebido' || oc.status === 'Parcialmente Recebido') {
        throw new Error(
          `Não é possível cancelar uma OC que já foi recebida e teve a quantidade contabilizada no estoque. Status atual: ${oc.status}`
        );
      }

      return await base44.entities.ComprasOrden.update(ocId, {
        status: 'Cancelada',
        observacoes: `Cancelada: ${motivo}`,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erro ao cancelar OC:', error);
      throw error;
    }
  },

  /**
   * Edita uma OC (apenas se status = Rascunho)
   * @param {string} ocId - UUID da OC
   * @param {Object} dados - Dados a atualizar
   * @returns {Promise<Object>}
   */
  async editarOc(ocId, dados) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);
      
      if (!['Rascunho', 'Aguardando Envio'].includes(oc.status)) {
        throw new Error('Só é possível editar OCs em status "Rascunho" ou "Aguardando Envio"');
      }

      if (dados.itens) {
        await validarFornecedorDosItensOc(dados.fornecedor_id || oc.fornecedor_id, dados.itens);
      }

      return await base44.entities.ComprasOrden.update(ocId, {
        ...dados,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erro ao editar OC:', error);
      throw error;
    }
  },

  /**
   * Atualiza campos de acompanhamento da OC mesmo após envio ao fornecedor
   * @param {string} ocId
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async updateOcTracking(ocId, dados) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);
      const metadataAtual = oc.metadata || {};
      const metadataNova = mergeOcMetadata(
        metadataAtual,
        {
          pedido_faturado: dados.pedido_faturado,
          data_faturamento: dados.data_faturamento || null,
          vendedor_id: dados.metadata?.vendedor_id || metadataAtual.vendedor_id || null,
          vendedor_nome: dados.metadata?.vendedor_nome || metadataAtual.vendedor_nome || null,
          origem: dados.metadata?.origem || metadataAtual.origem || null,
        },
        dados.loja_id || metadataAtual.loja_id || null
      );

      return await base44.entities.ComprasOrden.update(ocId, {
        fornecedor_id: dados.fornecedor_id,
        fornecedor_nome: dados.fornecedor_nome,
        centro_custo_id: dados.centro_custo_id,
        data_previsao_entrega: dados.data_previsao_entrega,
        observacoes: dados.observacoes,
        metadata: metadataNova,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Erro ao atualizar acompanhamento da OC:', error);
      throw error;
    }
  },

  /**
   * Deleta uma OC (soft delete, apenas Rascunho)
   * @param {string} ocId - UUID da OC
   * @returns {Promise<void>}
   */
  async deleteOc(ocId) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);
      
      if (oc.status !== 'Rascunho') {
        throw new Error('Só é possível deletar OCs em status "Rascunho"');
      }

      // Deletar itens associados
      await supabase
        .from('compras_oc_itens')
        .delete()
        .eq('ordem_compra_id', ocId);

      // Soft delete da OC
      return await base44.entities.ComprasOrden.update(ocId, {
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erro ao deletar OC:', error);
      throw error;
    }
  },

  /**
   * Envia OC para aprovação de pagamento pelo master
   * Só aplicável para pagamentos não-a-vista
   * @param {string} ocId
   * @param {Object} data - { observacoes_aprovacao?, anexos_aprovacao? }
   * @returns {Promise<Object>}
   */
  async submitForPaymentApproval(ocId, data = {}) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);

      if (oc.pagamento_status === 'pago') {
        throw new Error('Este pedido já está marcado como pago');
      }

      return await base44.entities.ComprasOrden.update(ocId, {
        pagamento_status: 'pendente_aprovacao',
        observacoes_aprovacao: data.observacoes_aprovacao ?? oc.observacoes_aprovacao ?? null,
        anexos_aprovacao: data.anexos_aprovacao ?? oc.anexos_aprovacao ?? [],
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Erro ao enviar OC para aprovação de pagamento:', error);
      throw error;
    }
  },

  /**
   * Master aprova e registra pagamento de uma OC
   * @param {string} ocId
   * @param {Object} data - {
   *   pagamento_forma_final, pagamento_formas_multiplas?,
   *   pagamento_parcelas?, pagamento_valor_pago?,
   *   pagamento_data_pagamento?, pagamento_observacoes?,
   *   aprovado_por?
   * }
   * @returns {Promise<Object>}
   */
  async approvePayment(ocId, data = {}) {
    try {
      const oc = await base44.entities.ComprasOrden.get(ocId);

      if (oc.pagamento_status !== 'pendente_aprovacao') {
        throw new Error(`OC não está aguardando aprovação de pagamento. Status atual: ${oc.pagamento_status}`);
      }

      const ocAtualizada = await base44.entities.ComprasOrden.update(ocId, {
        pagamento_status: 'pago',
        pagamento_aprovado_por: data.aprovado_por || null,
        pagamento_aprovado_em: new Date().toISOString(),
        pagamento_forma_final: data.pagamento_forma_final || null,
        pagamento_formas_multiplas: data.pagamento_formas_multiplas || [],
        pagamento_parcelas: data.pagamento_parcelas || null,
        pagamento_valor_pago: data.pagamento_valor_pago || null,
        pagamento_data_pagamento: data.pagamento_data_pagamento || null,
        pagamento_observacoes: data.pagamento_observacoes || null,
        updated_at: new Date().toISOString(),
      });

      // Atualizar ou criar lançamento financeiro correspondente
      try {
        // Buscar por número de OC na descrição OU no campo origem
        const { data: lancamentosDesc } = await supabase
          .from('lancamentos_financeiros')
          .select('id, valor, status')
          .ilike('descricao', `%OC #${oc.numero_pedido}%`)
          .is('deleted_at', null)
          .limit(5);

        const { data: lancamentosOrigem } = await supabase
          .from('lancamentos_financeiros')
          .select('id, valor, status')
          .ilike('origem', `%OC#${oc.numero_pedido}%`)
          .is('deleted_at', null)
          .limit(5);

        const todosEncontrados = [...(lancamentosDesc || []), ...(lancamentosOrigem || [])];
        // Deduplica por id
        const unicos = Object.values(
          Object.fromEntries(todosEncontrados.map((l) => [l.id, l]))
        );

        const dataFormaDesc = data.pagamento_forma_final
          ? ` — ${data.pagamento_forma_final}`
          : '';
        const dataPagamento = data.pagamento_data_pagamento || new Date().toISOString().split('T')[0];

        if (unicos.length > 0) {
          // Atualiza o primeiro encontrado como Pago
          await base44.entities.LancamentoFinanceiro.update(unicos[0].id, {
            status: 'Pago',
            data_lancamento_real: dataPagamento,
            forma_pagamento: data.pagamento_forma_final || null,
            observacao: `Aprovado pelo master.${dataFormaDesc}${data.pagamento_observacoes ? ' ' + data.pagamento_observacoes : ''}`,
          });
        } else {
          // Lançamento ainda não existe (OC talvez não tenha sido totalmente recebida)
          const { data: categoriasCompra } = await supabase
            .from('categorias_financeiras')
            .select('id, nome')
            .eq('nome', 'Compras de Estoque')
            .single();

          const lancamentoPayload = {
            tipo: 'DESPESA',
            descricao: `Compra OC #${oc.numero_pedido}${dataFormaDesc}`,
            valor: data.pagamento_valor_pago || oc.valor_total,
            data_vencimento: dataPagamento,
            data_lancamento: new Date().toISOString().split('T')[0],
            data_lancamento_real: dataPagamento,
            status: 'Pago',
            origem: `OC#${oc.numero_pedido}`,
            numero_pedido: String(oc.numero_pedido),
            fornecedor_nome: oc.fornecedor_nome || null,
            forma_pagamento: data.pagamento_forma_final || null,
            observacao: `Lançamento gerado na aprovação de pagamento da OC ${oc.numero_pedido}.${data.pagamento_observacoes ? ' ' + data.pagamento_observacoes : ''}`,
          };
          if (categoriasCompra?.id) {
            lancamentoPayload.categoria_id = categoriasCompra.id;
            lancamentoPayload.categoria_nome = categoriasCompra.nome;
          }
          await base44.entities.LancamentoFinanceiro.create(lancamentoPayload);
        }
      } catch (financeiroError) {
        console.warn('Aviso: não foi possível atualizar lançamento financeiro:', financeiroError);
        // Não lança erro para não reverter a aprovação
      }

      return ocAtualizada;
    } catch (error) {
      console.error('Erro ao aprovar pagamento da OC:', error);
      throw error;
    }
  },

  /**
   * Atualiza apenas campos de anexo e pagamento de uma OC (qualquer status)
   * @param {string} ocId
   * @param {Object} dados - { forma_pagamento_oc?, anexo_fornecedor?, observacoes_aprovacao?, anexos_aprovacao?, anexos_financeiro? }
   * @returns {Promise<Object>}
   */
  async updateOcPaymentFields(ocId, dados) {
    try {
      const updatePayload = { updated_at: new Date().toISOString() };

      if (dados.forma_pagamento_oc !== undefined) {
        updatePayload.forma_pagamento_oc = dados.forma_pagamento_oc;
        // Reset controlado pela UI de acordo com as regras de auto aprovação
        if (dados.pagamento_status_reset === true) {
          updatePayload.pagamento_status = 'nao_aplicavel';
        }
      }
      if (dados.anexo_fornecedor !== undefined) updatePayload.anexo_fornecedor = dados.anexo_fornecedor;
      if (dados.observacoes_aprovacao !== undefined) updatePayload.observacoes_aprovacao = dados.observacoes_aprovacao;
      if (dados.anexos_aprovacao !== undefined) updatePayload.anexos_aprovacao = dados.anexos_aprovacao;
      if (dados.anexos_financeiro !== undefined) updatePayload.anexos_financeiro = dados.anexos_financeiro;

      return await base44.entities.ComprasOrden.update(ocId, updatePayload);
    } catch (error) {
      console.error('Erro ao atualizar campos de pagamento da OC:', error);
      throw error;
    }
  },

  /**
   * Gera número único de pedido (sequencial)
   * @returns {Promise<string>}
   */
  async _gerarNumeroPedido() {
    const ano = new Date().getFullYear();
    const { data: numero, error } = await supabase.rpc('proximo_numero_oc', { p_ano: ano });
    if (error || !Number.isSafeInteger(numero) || numero <= 0) throw error || new Error('Falha ao reservar número de OC');
    return 'OC-' + ano + '-' + String(numero).padStart(5, '0');
  }
};
