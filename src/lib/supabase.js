import { auditSnapshot } from '@/utils/auditSnapshot';
import { createClient } from '@supabase/supabase-js';

// Configuração do Supabase
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL;
export const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    const missingVars = [];
    if (!supabaseUrl) missingVars.push('VITE_SUPABASE_URL/SUPABASE_URL');
    if (!supabaseKey) missingVars.push('VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY');
    throw new Error(`Configuração do Supabase ausente: ${missingVars.join(', ')}.`);
}

// Criar cliente com configurações que garantem persistência de autenticação
// Singleton para garantir que só exista uma instância do cliente Supabase no browser
if (!window.__supabase_instance) {
    window.__supabase_instance = createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: true, // Persiste a sessão no localStorage
            autoRefreshToken: true, // Atualiza automaticamente o token
            detectSessionInUrl: true, // Detecta sessão na URL (útil para email confirmations)
            storage: window.localStorage, // Usa localStorage explicitamente
            storageKey: 'moveis-pedro-ii-auth-token', // Chave única para evitar conflitos
        },
        global: {
            headers: {
                'x-client-info': 'moveis-pedro-ii-web',
            },
        },
    });
}

export const supabase = window.__supabase_instance;

// ============================================================================
// AUTH MODE ISOLATION - Separar sessão Operador SaaS vs Funcionário GestApp
// ============================================================================
const AUTH_MODE_KEY = 'active_auth_mode';
export const AUTH_MODES = Object.freeze({
    OPERATOR: 'operator',
    TENANT: 'tenant',
});

export function getActiveAuthMode() {
    try {
        return localStorage.getItem(AUTH_MODE_KEY) || null;
    } catch {
        return null;
    }
}

export function setActiveAuthMode(mode) {
    try {
        if (mode && Object.values(AUTH_MODES).includes(mode)) {
            localStorage.setItem(AUTH_MODE_KEY, mode);
        }
    } catch {
        // Ignora falhas de storage
    }
}

export function clearActiveAuthMode() {
    try {
        localStorage.removeItem(AUTH_MODE_KEY);
    } catch {
        // Ignora falhas de storage
    }
}

// Listener para refresh automático de sessão quando estiver prestes a expirar
supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'TOKEN_REFRESHED') {
        console.log('✅ Token renovado automaticamente');
    } else if (event === 'SIGNED_OUT') {
        console.log('🔒 Usuário deslogado');
    } else if (event === 'SIGNED_IN') {
        console.log('✅ Usuário logado');
    }
});

// O cliente Supabase configurado com autoRefreshToken: true já cuida do refresh
// automático de sessão em background e sempre que supabase.auth.getSession() for chamado.
// Isso evita deadlocks de concorrência com o navigator.locks no GoTrueClient.

// Mapa Completo: Entidade (Código) -> Tabela (Supabase)
const tableMap = {
    Campanha: 'campanhas',
    Cupom: 'cupons',
    Loja: 'lojas',
    Produto: 'produtos',
    Cliente: 'clientes',
    Venda: 'vendas',
    Entrega: 'entregas',
    Fornecedor: 'fornecedores',
    Orcamento: 'orcamentos',
    Devolucao: 'devolucoes',
    Parcela: 'parcelas',
    Vendedor: 'vendedores',
    ConfiguracaoComissao: 'configuracao_comissoes',
    AuditLog: 'audit_logs',
    LancamentoFinanceiro: 'lancamentos_financeiros',
    CategoriaFinanceira: 'categorias_financeiras',
    Montagem: 'montagens',
    ValorMontagem: 'valores_montagem',
    Colaborador: 'colaboradores',
    FolhaPagamento: 'folhas_pagamento',
    Ferias: 'ferias',
    Licenca: 'licencas',
    Vaga: 'vagas',
    Candidato: 'candidatos',
    AvaliacaoDesempenho: 'avaliacoes_desempenho',
    DocumentoRH: 'documentos_rh',

    PontoEletronico: 'ponto_eletronico',
    TransferenciaEstoque: 'transferencias_estoque',
    Inventario: 'inventarios',
    AlertaRecompra: 'alertas_recompra',
    Caminhao: 'caminhoes',
    Notificacao: 'notificacoes',
    MensagemChat: 'mensagens_chat',
    Cargo: 'cargos',
    User: 'public_users',
    ConfiguracaoTaxa: 'configuracao_taxas',
    Montador: 'montadores',
    MontagemItem: 'montagens_itens',
    NotaFiscalEntrada: 'notas_fiscais_entrada',
    ItemNotaFiscal: 'itens_nota_fiscal',
    NotaFiscalEmitida: 'notas_fiscais_emitidas',
    ItemNfeEmitida: 'itens_nfe_emitida',
    AssistenciaTecnica: 'assistencias_tecnicas',
    PedidoCompra: 'pedidos_compra',
    ItemPedidoCompra: 'itens_pedido_compra',
    CobrancaPix: 'cobrancas_pix',
    ConfiguracaoSistema: 'configuracoes_sistema',
    RolePermission: 'role_permissions',
    NPSLink: 'nps_links',
    NPSAvaliacao: 'nps_avaliacoes',
    MetaVenda: 'metas_vendas',
    RegraComissao: 'regras_comissao',
    ComissaoHistorico: 'comissoes_historico',
    ComissaoFechamentoMensal: 'comissoes_fechamento_mensal',
    NivelComissao: 'niveis_comissao',
    NivelComissaoFaixa: 'niveis_comissao_faixas',
    TokenGerencial: 'tokens_gerenciais',
    DescontoProdutoExcecao: 'desconto_produto_excecoes',
    LogUsoToken: 'log_uso_tokens',
    SolicitacaoCadastro: 'solicitacoes_cadastro_produto',
    PromocaoFornecedor: 'promocoes_fornecedor',
    HistoricoPrecos: 'historico_precos',
    ContaPagarCompras: 'compras_contas_pagar',
    SolicitacaoPreco: 'solicitacoes_preco',
    SolicitacaoEncomenda: 'solicitacoes_encomenda',
    ComprasOrden: 'compras_ordens',
    ComprasOcItem: 'compras_oc_itens',
    ComprasCentroCusto: 'compras_centro_custos',
    ComprasWorkflow: 'compras_workflows',
    MovimentacaoEstoque: 'movimentacoes_estoque',
    EstoqueMovimentacao: 'movimentacoes_estoque',
    PaymentProviderConfig: 'payment_provider_configs',
    PaymentTransaction: 'payment_transactions',
    SolicitacaoReposicao: 'solicitacoes_reposicao',
    ComprasRecebimentoHistorico: 'compras_recebimentos_historico'
};

// O Adaptador Mágico (Handler)
const createHandler = (tableName) => ({
    list: async (orderBy = null) => {
        let allData = [];
        let from = 0;
        const limit = 1000;
        let fetchMore = true;

        while (fetchMore) {
            let query = supabase.from(tableName).select('*').range(from, from + limit - 1);

            if (orderBy && typeof orderBy === 'string') {
                const isDesc = orderBy.startsWith('-');
                const field = isDesc ? orderBy.substring(1) : orderBy;
                    // audit_logs usa coluna 'timestamp' em vez de 'created_at'
                    const dbField = field === 'created_date' ? 'created_at' :
                        (field === 'created_at' && tableName === 'audit_logs') ? 'timestamp' :
                        field;
                query = query.order(dbField, { ascending: !isDesc });
            } else {
                // Ordenação padrão por ID para garantir consistência na paginação
                query = query.order('id', { ascending: true });
            }

            const { data, error } = await query;

            if (error) {
                console.error(`Erro Supabase (Listar ${tableName}):`, error);
                throw error;
            }

            if (data) {
                allData = [...allData, ...data];
                // Se retornou menos que o limite, acabou
                if (data.length < limit) {
                    fetchMore = false;
                } else {
                    from += limit;
                }
            } else {
                fetchMore = false;
            }

            // Safety break para evitar loop infinito em edge cases (ex: > 100k produtos)
            if (allData.length >= 100000) fetchMore = false;
        }

        return allData;
    },
    create: async (data) => {
        const payload = { ...data };

        if (tableName === 'clientes' && !payload.created_by) {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user?.id) {
                    payload.created_by = session.user.id;
                }
            } catch (e) {
                console.warn('[Supabase] Não foi possível definir created_by do cliente:', e);
            }
        }

        const { data: created, error } = await supabase.from(tableName).insert(payload).select().single();
        if (error) {
            console.error(`Erro Supabase (Criar em ${tableName}):`, error);
            throw error;
        }

        // Audit Log
        if (tableName !== 'audit_logs') {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const user = session?.user;
                if (user) {
                    supabase.from('audit_logs').insert({
                        table_name: tableName,
                        action: 'INSERT',
                        record_id: created.id,
                        new_data: auditSnapshot(created),
                        user_id: user.id
                    }).then(({ error: auditError }) => {
                        if (auditError) console.error("Erro Audit Log (Insert):", auditError);
                    });
                }
            } catch (e) {
                console.error("Erro ao registrar auditoria (Insert):", e);
            }
        }

        return created;
    },
    update: async (id, data) => {
        // Fetch old data for audit
        let oldData = null;
        if (tableName !== 'audit_logs') {
            try {
                const { data: current } = await supabase.from(tableName).select('*').eq('id', id).single();
                oldData = current;
            } catch (e) { /* ignore */ }
        }

        const { data: updated, error } = await supabase.from(tableName).update(data).eq('id', id).select().maybeSingle();
        if (error) {
            console.error(`Erro Supabase (Atualizar ${id} em ${tableName}):`, { code: error.code });
            throw error;
        }

        if (!updated) {
            throw new Error('Não foi possível salvar: o registro não existe mais ou seu usuário não tem permissão para alterá-lo nesta empresa.');
        }

        // Audit Log
        if (tableName !== 'audit_logs') {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const user = session?.user;
                if (user) {
                    supabase.from('audit_logs').insert({
                        table_name: tableName,
                        action: 'UPDATE',
                        record_id: id,
                        old_data: auditSnapshot(oldData),
                        new_data: auditSnapshot(updated),
                        user_id: user.id
                    }).then(({ error: auditError }) => {
                        if (auditError) console.error("Erro Audit Log (Update):", auditError);
                    });
                }
            } catch (e) {
                console.error("Erro ao registrar auditoria (Update):", e);
            }
        }

        return updated;
    },
    getById: async (id) => {
        const { data, error } = await supabase.from(tableName).select('*').eq('id', id).single();
        if (error) {
            console.error(`Erro Supabase (GetById ${id} em ${tableName}):`, error);
            throw error;
        }
        return data;
    },
    get: async (id) => {
        const { data, error } = await supabase.from(tableName).select('*').eq('id', id).single();
        if (error) {
            console.error(`Erro Supabase (Get ${id} em ${tableName}):`, error);
            throw error;
        }
        return data;
    },
    upsert: async (data, onConflict = 'id') => {
        const { data: upserted, error } = await supabase.from(tableName).upsert(data, { onConflict }).select().single();
        if (error) {
            console.error(`Erro Supabase (Upsert em ${tableName}):`, error);
            throw error;
        }

        // Audit Log
        if (tableName !== 'audit_logs') {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const user = session?.user;
                if (user) {
                    supabase.from('audit_logs').insert({
                        table_name: tableName,
                        action: 'UPSERT',
                        record_id: upserted.id,
                        new_data: auditSnapshot(upserted),
                        user_id: user.id
                    }).then(({ error: auditError }) => {
                        if (auditError) console.error("Erro Audit Log (Upsert):", auditError);
                    });
                }
            } catch (e) {
                console.error("Erro ao registrar auditoria (Upsert):", e);
            }
        }

        return upserted;
    },
    delete: async (id) => {
        // Fetch old data for audit
        let oldData = null;
        if (tableName !== 'audit_logs') {
            try {
                const { data: current } = await supabase.from(tableName).select('*').eq('id', id).single();
                oldData = current;
            } catch (e) { /* ignore */ }
        }

        const { error } = await supabase.from(tableName).delete().eq('id', id);
        if (error) {
            console.error(`Erro Supabase (Deletar ${id} em ${tableName}):`, error);
            throw error;
        }

        // Audit Log
        if (tableName !== 'audit_logs') {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const user = session?.user;
                if (user) {
                    supabase.from('audit_logs').insert({
                        table_name: tableName,
                        action: 'DELETE',
                        record_id: id,
                        old_data: auditSnapshot(oldData),
                        user_id: user.id
                    }).then(({ error: auditError }) => {
                        if (auditError) console.error("Erro Audit Log (Delete):", auditError);
                    });
                }
            } catch (e) {
                console.error("Erro ao registrar auditoria (Delete):", e);
            }
        }

        return true;
    },
    search: async ({ page = 1, limit = 100, filters = {}, search = '', orderBy = null }) => {
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabase.from(tableName).select('*', { count: 'estimated' });

        // Aplicar filtros (match exato)
        if (filters && typeof filters === 'object') {
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== 'todas') {
                    // Tratamento especial para booleanos convertidos em string
                    if (value === 'true') value = true;
                    if (value === 'false') value = false;
                    query = query.eq(key, value);
                }
            });
        }

        // Aplicar busca textual
        if (search) {
            const searchLower = search.toLowerCase();

            if (tableName === 'produtos') {
                const keywords = search.trim().split(/\s+/).filter(Boolean);
                keywords.forEach((kw) => {
                    query = query.or(
                        `nome.ilike.%${kw}%,` +
                        `codigo_barras.ilike.%${kw}%,` +
                        `categoria.ilike.%${kw}%,` +
                        `modelo_referencia.ilike.%${kw}%,` +
                        `fornecedor_nome.ilike.%${kw}%`
                    );
                });
            } else if (tableName === 'clientes') {
                query = query.or(`nome.ilike.%${search}%,cpf_cnpj.ilike.%${search}%,email.ilike.%${search}%`);
            } else {
                // Fallback genérico - tenta 'nome' se existir, senão pode dar erro se não tiver
                // O supabase ignora filtros em colunas inexistentes? Não, ele dá erro.
                // Vamos arriscar 'nome' pois é o mais comum.
                // TODO: Passar searchFields como argumento na chamada
                query = query.ilike('nome', `%${search}%`);
            }
        }

        // Ordenação
        if (orderBy && typeof orderBy === 'string') {
            const isDesc = orderBy.startsWith('-');
            const field = isDesc ? orderBy.substring(1) : orderBy;
            const dbField = field === 'created_date' ? 'created_at' : field;
            query = query.order(dbField, { ascending: !isDesc });
        } else {
            query = query.order('id', { ascending: true });
        }

        query = query.range(from, to);

        const { data, count, error } = await query;

        if (error) {
            console.error(`Erro Supabase (Search ${tableName}):`, error);
            throw error;
        }
        return { data, count };
    },
    filter: async (filters, orderBy = null) => {
        let allData = [];
        let from = 0;
        const limit = 1000;
        let fetchMore = true;

        while (fetchMore) {
            let query = supabase.from(tableName).select('*').range(from, from + limit - 1);

            // Aplicar filtros
            if (filters && typeof filters === 'object') {
                Object.entries(filters).forEach(([key, value]) => {
                    if (value === null) {
                        query = query.is(key, null);
                    } else if (value !== undefined) {
                        query = query.eq(key, value);
                    }
                });
            }

            // Aplicar ordenação
            if (orderBy && typeof orderBy === 'string') {
                const isDesc = orderBy.startsWith('-');
                const field = isDesc ? orderBy.substring(1) : orderBy;
                const dbField = field === 'created_date' ? 'created_at' : field;
                query = query.order(dbField, { ascending: !isDesc });
            } else {
                query = query.order('id', { ascending: true });
            }

            const { data, error } = await query;

            if (error) {
                console.error(`Erro Supabase (Filtrar ${tableName}):`, error);
                throw error;
            }

            if (data) {
                allData = [...allData, ...data];
                if (data.length < limit) {
                    fetchMore = false;
                } else {
                    from += limit;
                }
            } else {
                fetchMore = false;
            }
            // Safety break
            if (allData.length >= 100000) fetchMore = false;
        }

        return allData;
    }
});

// Objeto base44 (Proxy) - mantido para compatibilidade
export const base44 = {
    entities: new Proxy({}, {
        get: (target, prop) => {
            const tableName = tableMap[prop];
            if (!tableName) {
                // Entidade não mapeada - usando plural automático
                return createHandler(prop.toLowerCase() + 's');
            }
            return createHandler(tableName);
        }
    }),

    // Autenticação (Adaptado para Supabase Auth)
    auth: {
        me: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) return null;
            const { data: profile } = await supabase.from('public_users').select('*').eq('id', user.id).maybeSingle();
            return { ...user, ...profile };
        },

        // Atualizar dados do usuário logado
        updateMe: async (data) => {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) throw new Error('Usuário não autenticado');
            const { data: updated, error } = await supabase
                .from('public_users')
                .update(data)
                .eq('id', user.id)
                .select()
                .single();
            if (error) throw error;
            return updated;
        },

        signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
        login: (email, password) => supabase.auth.signInWithPassword({ email, password }),

        signUp: async ({ email, password }) => await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: window.location.origin
            }
        }),

        signOut: () => supabase.auth.signOut(),
        logout: () => supabase.auth.signOut(),

        onAuthStateChange: (callback) => supabase.auth.onAuthStateChange(callback),

        trackStep: (stepName, userId, details = {}) => {
            if (!userId) return;
            if (window.location.pathname.startsWith('/operador')) return;

            try {
                const step = {
                    action: stepName,
                    path: window.location.pathname + window.location.search,
                    timestamp: new Date().toISOString(),
                    ...details
                };

                // Fire and forget, sem await para não travar
                Promise.resolve(
                    supabase.rpc('track_user_footstep')
                ).catch(e => console.warn('[Telemetry] DB error:', e));
            } catch (e) {
                console.warn('[Telemetry] Erro ao gravar footstep:', e);
            }
        },
    },

    integrations: {
        Core: {
            UploadFile: async ({ file }) => {
                const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
                const { error } = await supabase.storage.from('publico').upload(fileName, file);
                if (error) throw error;
                const { data: { publicUrl } } = supabase.storage.from('publico').getPublicUrl(fileName);
                return { file_url: publicUrl };
            },
            InvokeLLM: async () => {
                // IA desativada
                return null;
            }
        }
    }
};

// Exportar tableMap para uso externo se necessário
export { tableMap };
