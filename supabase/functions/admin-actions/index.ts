import { getAuthContext, requireAdmin, requireOrganization, deny } from "../_shared/authContext.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const returnError = (msg) => {
        console.error("Returning Error:", msg);
        return new Response(
            JSON.stringify({ error: msg }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    };

    try {
        const ctx = await getAuthContext(req);
        requireAdmin(ctx);
        const supabaseAdmin = ctx.adminClient;
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        // Gerador de senha simples e robusto
        const generatePassword = () => {
            const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
            let pass = "";
            const random = crypto.getRandomValues(new Uint32Array(10));
            for (let i = 0; i < 10; i++) {
                pass += chars.charAt(random[i] % chars.length);
            }
            return pass + "A1!";
        };

        let body;
        try {
            body = await req.json();
        } catch (e) {
            return returnError("Invalid JSON body");
        }

        const { action, ...payload } = body;

        // HANDLER: CRIAR CREDENCIAIS ou RESETAR SENHA
        if (action === 'create_credentials' || action === 'reset_password') {
            const { user_id } = payload;
            if (!user_id) return returnError('user_id required');

            // Buscar email e dados atuais do usuário alvo
            const { data: targetUser, error: targetError } = await supabaseAdmin
                .from('public_users')
                .select('email, full_name, matricula, primeiro_acesso, organization_id')
                .eq('id', user_id)
                .single();

            if (targetError || !targetUser) return returnError('Usuário alvo não encontrado na base pública.');

            requireOrganization(ctx, targetUser.organization_id);
            const tempPassword = generatePassword();
            const matricula = targetUser.matricula || ('MAT' + Math.floor(1000 + Math.random() * 9000));

            let finalUserId = user_id;
            let userWasCreated = false;
            let userWasSynced = false;

            const metadata = { matricula, full_name: targetUser.full_name, via_admin: true };

            // 1. Tentar atualizar por ID (Update PURO, sem mudar email para evitar trigger de confirmação)
            // Passamos email_confirm: true só para garantir que está ativo.
            const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
                user_id,
                {
                    password: tempPassword,
                    email_confirm: true,
                    user_metadata: metadata
                }
            );

            if (updateError) {
                console.log(`Update by ID ${user_id} failed:`, updateError.message);

                // FALHA NO UPDATE. Tentando CRIAR.
                try {
                    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${supabaseServiceKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            email: targetUser.email,
                            password: tempPassword,
                            email_confirm: true,
                            user_metadata: metadata,
                            id: user_id,
                            role: 'authenticated'
                        })
                    });

                    if (response.ok) {
                        console.log("Usuário Auth criado com sucesso via Raw API.");
                        userWasCreated = true;
                    } else {
                        // Se falhar a criação, verificar se é por EMAIL DUPLICADO
                        const errorData = await response.json();
                        const errorMsg = errorData.msg || errorData.error_description || "";

                        if (errorMsg.includes("already registered") || response.status === 422) {
                            // CENÁRIO SYNC: Email já existe, mas IDs não batem.
                            console.log("Email já existe. Tentando sincronizar ID...");

                            const { data: { users: usersList } } = await supabaseAdmin.auth.admin.listUsers();
                            const existingAuthUser = usersList.find(u => u.email === targetUser.email);

                            if (existingAuthUser) {
                                const { data: existingProfile, error: existingError } = await supabaseAdmin
                                    .from('public_users').select('organization_id').eq('id', existingAuthUser.id).single();
                                if (existingError || !existingProfile) deny(403, 'Identidade divergente requer reconciliação manual');
                                requireOrganization(ctx, existingProfile.organization_id);
                                console.log(`Usuário encontrado no Auth com ID: ${existingAuthUser.id}. Sincronizando...`);

                                // 1. Atualizar a senha deste usuário encontrado
                                const { error: recoveryUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
                                    existingAuthUser.id,
                                    {
                                        password: tempPassword,
                                        email_confirm: true,
                                        user_metadata: metadata
                                    }
                                );

                                if (recoveryUpdateError) {
                                    throw new Error("Falha ao atualizar senha do usuário recuperado: " + recoveryUpdateError.message);
                                }

                                // 2. Atualizar tabela pública para usar o ID do Auth
                                const { error: idMoveError } = await supabaseAdmin
                                    .from('public_users')
                                    .update({ id: existingAuthUser.id })
                                    .eq('id', user_id);

                                if (idMoveError) {
                                    throw new Error("Erro ao sincronizar ID na tabela pública: " + idMoveError.message);
                                }

                                finalUserId = existingAuthUser.id;
                                userWasSynced = true;
                                console.log("Sincronização concluída. ID atualizado.");

                            } else {
                                throw new Error("Email duplicado reportado, mas não encontrado na lista.");
                            }

                        } else {
                            throw new Error(`Erro ao criar usuário: ${errorMsg}`);
                        }
                    }

                } catch (createEx) {
                    if (createEx instanceof Response) return createEx;
                    return returnError("Exceção no processo de Create/Sync: " + createEx.message);
                }
            }

            // 3. Atualizar matrícula e FORÇAR primeiro_acesso = true
            const updateData: any = { primeiro_acesso: true };

            if (action === 'create_credentials' || !targetUser.matricula) {
                updateData.matricula = matricula;
            }

            const { error: publicUpdateError } = await supabaseAdmin
                .from('public_users')
                .update(updateData)
                .eq('id', finalUserId);

            if (publicUpdateError) {
                return returnError("Erro ao salvar flag primeiro_acesso: " + publicUpdateError.message);
            }

            // VERIFICAÇÃO FINAL
            const { data: verifyUser } = await supabaseAdmin
                .from('public_users')
                .select('primeiro_acesso')
                .eq('id', finalUserId)
                .single();

            if (!verifyUser?.primeiro_acesso) {
                // Retry
                await supabaseAdmin.from('public_users').update({ primeiro_acesso: true }).eq('id', finalUserId);
            }

            return new Response(
                JSON.stringify({
                    success: true,
                    senha_temporaria: tempPassword,
                    matricula: matricula,
                    debug_action: userWasCreated ? 'CREATED' : (userWasSynced ? 'SYNCED_ID' : 'UPDATED_ID'),
                    debug_primeiro_acesso: verifyUser?.primeiro_acesso,
                    whatsapp_enviado: false
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return returnError('Ação inválida: ' + action);

    } catch (error) {
        if (error instanceof Response) return error;
        return new Response(
            JSON.stringify({ error: "Erro Interno: " + error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
