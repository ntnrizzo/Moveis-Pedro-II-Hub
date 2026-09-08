import { identityKey } from '@/utils/identityStorage';
import localforage from 'localforage';
import { supabase } from '@/api/base44Client';
import { base44 } from '@/api/base44Client';
import { applyDeliveryPayment } from '@/utils/deliveryPayment';

export const deliveryOfflineDB = localforage.createInstance({
    name: 'moveis_pedro_ii',
    storeName: 'delivery_offline_queue'
});

async function currentOwner() {
    const { data: { session } } = await supabase.auth.getSession();
    const organizationId = localStorage.getItem('current_organization_id');
    const userId = session?.user?.id;
    identityKey('delivery', organizationId, userId);
    return { organizationId, userId };
}
async function verifyOwner(owner) {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || user?.id !== owner.userId) throw new Error('Sessão divergente da entrega offline');
    const { data: profile } = await supabase.from('public_users').select('organization_id, ativo').eq('id', user.id).single();
    if (!profile?.ativo || profile.organization_id !== owner.organizationId) throw new Error('Organização divergente da entrega offline');
}

/**
 * Salva uma finalização de entrega na fila offline
 */
export const saveDeliveryToOfflineQueue = async (entregaId, payload) => {
    try {
        const owner = await currentOwner();
        await deliveryOfflineDB.setItem(identityKey(`delivery_${entregaId}`, owner.organizationId, owner.userId), {
            owner,
            entregaId,
            payload, // { updateData, fotosOfflineList }
            timestamp: Date.now(),
            status: 'pending'
        });
        return true;
    } catch (error) {
        console.error('Erro ao salvar entrega na fila offline:', error);
        return false;
    }
};

/**
 * Retorna as entregas pendentes
 */
export const getOfflineDeliveries = async () => {
    try {
        const owner = await currentOwner();
        const suffix = `:${owner.organizationId}:${owner.userId}`;
        const keys = (await deliveryOfflineDB.keys()).filter(key => key.endsWith(suffix));
        const items = await Promise.all(keys.map(key => deliveryOfflineDB.getItem(key)));
        return items.filter(item => item?.owner?.organizationId === owner.organizationId && item?.owner?.userId === owner.userId).sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
        console.error('Erro ao buscar entregas offline:', error);
        return [];
    }
};

/**
 * Remove uma entrega concluída da fila
 */
export const removeOfflineDelivery = async (entregaId, savedOwner = null) => {
    try {
        const owner = savedOwner || await currentOwner();
        await deliveryOfflineDB.removeItem(identityKey(`delivery_${entregaId}`, owner.organizationId, owner.userId));
        return true;
    } catch (error) {
        console.error(`Erro ao remover a entrega ${entregaId} da fila:`, error);
        return false;
    }
};

/**
 * Sincroniza todas as entregas pendentes (uploads p/ Storage + banco)
 */
export const syncOfflineDeliveries = async () => {
    const queue = await getOfflineDeliveries();
    let synchronized = 0;

    for (const item of queue) {
        try {
            console.log(`[OfflineSync] Tentando sincronizar entrega ${item.entregaId}...`);
            await verifyOwner(item.owner);
            const { data: delivery, error: deliveryError } = await supabase.from('entregas').select('id')
                .eq('id', item.entregaId).eq('organization_id', item.owner.organizationId).single();
            if (deliveryError || !delivery) throw new Error('Entrega fora da organização');
            const payload = item.payload;
            const finalUpdateData = { ...payload.updateData };

            // Se houver fotos que faltaram fazer upload para o Storage
            if (payload.fotosOfflineList && payload.fotosOfflineList.length > 0) {
                const fotosUploadadas = [];
                for (let i = 0; i < payload.fotosOfflineList.length; i++) {
                    const foto = payload.fotosOfflineList[i];

                    // Convert base64 to blob
                    const response = await fetch(foto.dataUrl);
                    const blob = await response.blob();
                    const fileName = `entregas/${item.entregaId}/${Date.now()}_foto_${i + 1}.jpg`;

                    const { error } = await supabase.storage
                        .from('comprovantes')
                        .upload(fileName, blob, {
                            contentType: 'image/jpeg',
                            cacheControl: '3600'
                        });

                    if (error) {
                        console.error('Erro no upload de foto da entrega offline:', error);
                        // Se o erro for de RLS (módulo desativado no plano) ou 403, ignora a foto e prossegue
                        if (error.statusCode === '403' || error.message?.includes('row-level security') || error.message?.includes('policy')) {
                            console.warn('Upload bloqueado por política de segurança (plano). Pulando foto...');
                            continue;
                        }
                        throw error;
                    }

                    const { data: urlData } = supabase.storage
                        .from('comprovantes')
                        .getPublicUrl(fileName);

                    fotosUploadadas.push({
                        url: urlData.publicUrl,
                        tipo: foto.tipo,
                        timestamp: foto.timestamp
                    });
                }

                finalUpdateData.fotos_entrega = fotosUploadadas;
                finalUpdateData.foto_entrega_url = fotosUploadadas[0]?.url || null;
            }

            // Agora atualiza no Supabase via API principal
            await verifyOwner(item.owner);
            await base44.entities.Entrega.update(item.entregaId, finalUpdateData);

            if (payload.financialPayload) {
                await applyDeliveryPayment({
                    ...payload.financialPayload,
                    entrega: {
                        ...payload.financialPayload.entrega,
                        id: item.entregaId,
                    },
                    comprovanteUrl: finalUpdateData.comprovante_pagamento_url || payload.financialPayload.comprovanteUrl || null,
                });
            }

            // Remove da fila offline
            await removeOfflineDelivery(item.entregaId, item.owner);
            synchronized++;
            console.log(`[OfflineSync] Entrega ${item.entregaId} sincronizada com sucesso!`);
        } catch (error) {
            console.error(`[OfflineSync] Falha ao sincronizar entrega ${item.entregaId}:`, error);
            // Quebra o loop para não tentar o resto se estiver sem internet
            break;
        }
    }

    return synchronized > 0;
};
