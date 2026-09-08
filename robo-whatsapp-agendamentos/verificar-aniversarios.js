const { getBotJobHeaders } = require('./jobAuth');
require("dotenv").config();
const { createClient } = require('@supabase/supabase-js');

// Configuração Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Busca clientes que fazem aniversário hoje para uma organização específica
 */
async function buscarAniversariantesHoje(orgId) {
    const hoje = new Date();
    const dia = hoje.getDate();
    const mes = hoje.getMonth() + 1;

    try {
        const { data: clientes, error } = await supabase
            .from('clientes')
            .select('*')
            .eq('organization_id', orgId)
            .not('data_nascimento', 'is', null)
            .not('telefone', 'is', null);

        if (error) throw error;

        // Filtra localmente por dia e mês
        const aniversariantes = (clientes || []).filter(cliente => {
            if (!cliente.data_nascimento) return false;
            const [, mes_nasc, dia_nasc] = cliente.data_nascimento.split('-').map(Number);
            return dia_nasc === dia && mes_nasc === mes;
        });

        return aniversariantes;
    } catch (error) {
        console.error(`❌ [Org: ${orgId}] Erro ao buscar aniversariantes:`, error.message);
        return [];
    }
}

/**
 * Cria cupom personalizado para o cliente dentro da sua organização
 */
async function criarCupomAniversario(cliente, orgId) {
    try {
        const primeiroNome = (cliente.nome_completo || 'CLIENTE').split(' ')[0].toUpperCase();
        const codigoCupom = `${primeiroNome}10`;

        // Verifica se cupom já existe para esta organização
        const { data: existente } = await supabase
            .from('cupons')
            .select('id')
            .eq('organization_id', orgId)
            .eq('codigo', codigoCupom)
            .single();

        if (existente) {
            return codigoCupom;
        }

        const validade = new Date();
        validade.setDate(validade.getDate() + 30);

        const { error } = await supabase
            .from('cupons')
            .insert({
                organization_id: orgId,
                codigo: codigoCupom,
                tipo: 'porcentagem',
                valor: 10,
                validade: validade.toISOString().split('T')[0],
                quantidade_usada: 0,
                ativo: true
            });

        if (error) {
            console.error(`❌ [Org: ${orgId}] Erro ao criar cupom ${codigoCupom}:`, error.message);
            return null;
        }

        return codigoCupom;
    } catch (error) {
        console.error(`❌ [Org: ${orgId}] Erro ao criar cupom:`, error.message);
        return null;
    }
}

/**
 * Busca lojas ativas da organização
 */
async function buscarLojasAtivas(orgId) {
    try {
        const { data: lojas, error } = await supabase
            .from('lojas')
            .select('*')
            .eq('organization_id', orgId)
            .eq('ativa', true);

        if (error) throw error;
        return lojas || [];
    } catch (error) {
        console.error(`❌ [Org: ${orgId}] Erro ao buscar lojas:`, error.message);
        return [];
    }
}

/**
 * Envia mensagem de aniversário via bot WhatsApp com contexto de tenant
 */
async function enviarMensagemAniversario(cliente, cupomCodigo, lojas, orgId) {
    try {
        const PORT = process.env.PORT || 3001;


        const headers = await getBotJobHeaders(orgId);

        const response = await fetch(`http://localhost:${PORT}/enviar-mensagem-aniversario`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                telefone: cliente.telefone,
                nome: cliente.nome_completo,
                cupom_codigo: cupomCodigo,
                lojas: lojas,
                organization_id: orgId
            })
        });

        return response.ok;
    } catch (error) {
        console.error(`❌ [Org: ${orgId}] Erro ao enviar mensagem para ${cliente.nome_completo}:`, error.message);
        return false;
    }
}

/**
 * Executa a verificação para todas as organizações ativas
 */
async function executarVerificacaoAniversarios() {
    console.log('🎉 === [CRON] INICIANDO VERIFICAÇÃO DE ANIVERSÁRIOS MULTI-TENANT ===');
    console.log(`⏰ Hora: ${new Date().toLocaleString('pt-BR')}\n`);

    try {
        // Buscar todas as organizações
        const { data: orgs, error: orgsError } = await supabase
            .from('organizations')
            .select('id, name');

        if (orgsError) throw orgsError;

        const listaOrgs = orgs && orgs.length > 0 ? orgs : [{ id: DEFAULT_ORG_ID, name: 'Móveis Pedro II' }];

        for (const org of listaOrgs) {
            const orgId = org.id;
            console.log(`🏢 [CRON Aniversários] Processando organização: ${org.name} (${orgId})...`);

            const aniversariantes = await buscarAniversariantesHoje(orgId);
            if (aniversariantes.length === 0) {
                console.log(`ℹ️ [Org: ${org.name}] Nenhum aniversariante hoje.`);
                continue;
            }

            console.log(`🎂 [Org: ${org.name}] ${aniversariantes.length} aniversariante(s) encontrado(s).`);
            const lojas = await buscarLojasAtivas(orgId);

            for (const cliente of aniversariantes) {
                const cupom = await criarCupomAniversario(cliente, orgId);
                const enviado = await enviarMensagemAniversario(cliente, cupom, lojas, orgId);

                if (enviado) {
                    console.log(`✅ [Org: ${org.name}] Parabéns enviado para: ${cliente.nome_completo}`);
                }

                // Pausa entre envios para evitar rate limit
                await new Promise(r => setTimeout(r, 2500));
            }
        }

        console.log('🎉 === [CRON] VERIFICAÇÃO DE ANIVERSÁRIOS CONCLUÍDA ===\n');
    } catch (err) {
        console.error('💥 Erro geral no cron de aniversários:', err.message);
    }
}

// Permite execução direta via CLI: node verificar-aniversarios.js
if (require.main === module) {
    executarVerificacaoAniversarios().then(() => process.exit(0));
}

module.exports = executarVerificacaoAniversarios;
