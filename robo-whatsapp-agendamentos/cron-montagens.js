const { getBotJobHeaders } = require('./jobAuth');
// cron-montagens.js
// Cron job para enviar lembretes de montagem às 8h da manhã com isolamento multi-tenant

const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Enviar lembretes às 8h todos os dias
cron.schedule('0 8 * * *', async () => {
    console.log('⏰ [CRON Montagens] Verificando montagens do dia por organização...');

    try {
        const hoje = new Date().toISOString().split('T')[0];
        const PORT = process.env.PORT || 3001;


        // 1. Listar todas as organizações
        const { data: orgs, error: orgsError } = await supabase
            .from('organizations')
            .select('id, name');

        if (orgsError) throw orgsError;

        const listaOrgs = orgs && orgs.length > 0 ? orgs : [{ id: DEFAULT_ORG_ID, name: 'Móveis Pedro II' }];

        for (const org of listaOrgs) {
            const orgId = org.id;

            // 2. Buscar montagens do dia para esta organização
            const { data: montagens, error } = await supabase
                .from('montagens_itens')
                .select('*')
                .eq('organization_id', orgId)
                .eq('data_agendada', hoje)
                .eq('notificacao_lembrete_enviada', false)
                .in('status', ['agendada', 'confirmada']);

            if (error) {
                console.error(`❌ [Org: ${org.name}] Erro ao buscar montagens:`, error.message);
                continue;
            }

            if (!montagens || montagens.length === 0) continue;

            console.log(`📋 [Org: ${org.name}] Encontradas ${montagens.length} montagens para hoje.`);

            for (const montagem of montagens) {
                if (!montagem.cliente_telefone) continue;

                try {
                    const headers = await getBotJobHeaders(orgId);

                    const response = await fetch(`http://localhost:${PORT}/lembrete-montagem`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            telefone: montagem.cliente_telefone,
                            nome: montagem.cliente_nome,
                            horario: montagem.horario_agendado,
                            organization_id: orgId
                        })
                    });

                    if (response.ok) {
                        await supabase
                            .from('montagens_itens')
                            .update({ notificacao_lembrete_enviada: true })
                            .eq('id', montagem.id);

                        console.log(`✅ [Org: ${org.name}] Lembrete enviado para: ${montagem.cliente_nome}`);
                    }

                    await new Promise(r => setTimeout(r, 3000));
                } catch (e) {
                    console.error(`❌ [Org: ${org.name}] Erro ao enviar lembrete para ${montagem.cliente_nome}:`, e.message);
                }
            }
        }

        console.log('✅ [CRON] Lembretes de montagem finalizados');
    } catch (error) {
        console.error('❌ Erro no cron de montagens:', error.message);
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

console.log('📅 Cron de lembretes de montagem ativo (8h diariamente com isolamento por organização)');

module.exports = {};
