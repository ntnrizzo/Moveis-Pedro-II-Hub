import { toast } from "sonner";
import { ZAP_API_URL as API_URL } from "@/utils/zapApiUrl";
import { saveToOfflineQueue, getOfflineQueue, removeOfflineQueueItem, clearOfflineQueue } from "@/utils/offlineQueue";
import { buildTrackingUrl, buildClientPortalUrl, buildAssistenciaUrl } from "@/utils/tenantLinkHelper";

// 🔐 Chave de API compartilhada com o backend do bot
import { getBotAuthHeaders } from '@/utils/botAuth';

/**
 * Obtém o organization_id ativo (do localStorage ou padrão)
 */
function getActiveOrgId(customOrgId = null) {
    if (customOrgId) return customOrgId;
    try {
        const stored = localStorage.getItem('current_organization_id') || localStorage.getItem('selected_org_id');
        if (stored) return stored;
    } catch (e) { /* ignore */ }
    return '00000000-0000-0000-0000-000000000001';
}

/** Headers padrão para chamadas ao bot, incluindo API key de autenticação e tenant ID */
async function botHeaders(extra = {}, orgId = null) {
    const activeOrgId = getActiveOrgId(orgId);
    return getBotAuthHeaders({
        'Content-Type': 'application/json',
        'x-organization-id': activeOrgId,
        ...extra,
    });
}


const isLikelyBotOfflineResponse = (status, errorPayload) => {
    // Qualquer erro 5xx do bot deve cair no fallback offline.
    if (status >= 500) return true;
    if (status < 400) return false;

    const raw = typeof errorPayload === 'string'
        ? errorPayload
        : JSON.stringify(errorPayload || {});

    return /whatsapp|offline|disconnected|desconect|pareado|conectado|bot|inicializ/i.test(raw);
};

const enqueueForLater = async (actionName, payloadArgs, message) => {
    const saved = await saveToOfflineQueue(actionName, payloadArgs);
    if (!saved) {
        toast.error("Falha ao salvar ação na fila offline.");
        return false;
    }
    if (message) toast.info(message);
    return 'queued';
};

const isFetchConnectionError = (error) =>
    error?.name === 'TypeError' && /failed to fetch|networkerror/i.test(error?.message || '');

export const whatsappService = {
    /**
     * Verifica o status da conexão com a API do WhatsApp
     * @returns {Promise<boolean>}
     */
    checkStatus: async () => {
        try {
            const response = await fetch(`${API_URL}/status`, {
                headers: await botHeaders(),
            });
            if (!response.ok) return false;

            const data = await response.json();
            return data.status === 'connected' || data.status === 'online';
        } catch (error) {
            return false;
        }
    },

    sendMessage: async (telefone, mensagem) => {
        if (!telefone) return;

        // Limpar caracteres não numéricos
        const numbersOnly = telefone.replace(/\D/g, '');
        const formattedPhone = numbersOnly.startsWith('55') ? numbersOnly : `55${numbersOnly}`;

        const payload = {
            phone: formattedPhone,
            message: mensagem,
        };

        if (!navigator.onLine) {
            await enqueueForLater('sendMessage', [telefone, mensagem], "Sem internet: Mensagem do Zap salva para envio posterior.");
            return true; // Retorna true para a UI prosseguir achando que deu certo offline
        }

        try {
            const response = await fetch(`${API_URL}/send-text`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('sendMessage', [telefone, mensagem], "WhatsApp indisponível: Mensagem salva para envio posterior.");
                    return true;
                }
                console.error("Detalhes do erro do servidor:", errData);
                throw new Error(errData.error || 'Falha ao enviar mensagem');
            }
            return true;
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                await enqueueForLater('sendMessage', [telefone, mensagem], "Sem conexão com servidor: Mensagem do Zap salva para envio posterior.");
                return true;
            }
            console.error("Erro no envio do WhatsApp:", error);
            toast.error("Erro ao enviar mensagem automática do WhatsApp");
            return false;
        }
    },

    sendImageMessage: async (telefone, imageUrl, caption) => {
        if (!telefone || !imageUrl) return false;

        const numbersOnly = telefone.replace(/\D/g, '');
        const formattedPhone = numbersOnly.startsWith('55') ? numbersOnly : `55${numbersOnly}`;

        const payload = {
            phone: formattedPhone,
            imageUrl: imageUrl,
            caption: caption,
        };

        if (!navigator.onLine) {
            await enqueueForLater('sendImageMessage', [telefone, imageUrl, caption], "Sem internet: Imagem do Zap salva para envio posterior.");
            return true;
        }

        try {
            const response = await fetch(`${API_URL}/send-image-url`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('sendImageMessage', [telefone, imageUrl, caption], "WhatsApp indisponível: Imagem salva para envio posterior.");
                    return true;
                }

                console.error("Detalhes do erro do servidor:", errData);
                return false;
            }
            return true;
        } catch (error) {
            if (isFetchConnectionError(error)) {
                await enqueueForLater('sendImageMessage', [telefone, imageUrl, caption], "Servidor inacessível: Imagem salva para envio posterior.");
                return true;
            }

            console.error("Erro no envio de imagem WhatsApp:", error);
            return false;
        }
    },

    /**
     * Envia confirmação de agendamento de montagem
     */
    sendAssemblyConfirmation: async (cliente, montagem, montador) => {
        const mensagem = `Olá, ${cliente.nome}! 🛠️
    
Seu agendamento de montagem foi confirmado!

*Pedido:* #${montagem.numero_pedido}
*Data:* ${montagem.data_montagem ? new Date(montagem.data_montagem.includes('T') ? montagem.data_montagem : montagem.data_montagem + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
*Horário:* ${montagem.horario_montagem}
*Montador:* ${montador.nome}

Em caso de dúvidas ou necessidade de reagendamento, entre em contato diretamente com nosso montador:
📞 ${montador.whatsapp || montador.telefone || "Número não disponível"}

Agradecemos a preferência!`;


        return whatsappService.sendMessage(cliente.telefone, mensagem);
    },

    /**
     * Envia link de rastreamento temporário
     */
    sendTrackingLink: async (cliente, link) => {
        const mensagem = `Olá, ${cliente.nome}! 🚚
    
Seu pedido está a caminho!
Acompanhe a entrega em tempo real pelo link abaixo:

🔗 ${link}
`;
        return whatsappService.sendMessage(cliente.telefone, mensagem);
    },
    /**
     * Envia aviso de próxima parada com link de rastreio
     * @param {string} telefone
     * @param {object} entrega
     * @param {string} linkRastreio
     */
    sendDeliveryNextStop: async (telefone, entrega, linkRastreio) => {
        if (!entrega?.id) return { status: 'failed' };

        if (!navigator.onLine) {
            await enqueueForLater('sendDeliveryNextStop', [telefone, entrega, linkRastreio], 'Sem internet: aviso de próxima parada salvo para envio posterior.');
            return { status: 'queued' };
        }

        try {
            const response = await fetch(`${API_URL}/aviso-proxima-parada`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify({
                    id: entrega.id,
                    telefone: telefone || entrega.cliente_telefone,
                    nome: entrega.cliente_nome
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('sendDeliveryNextStop', [telefone, entrega, linkRastreio], 'WhatsApp indisponível: aviso de próxima parada salvo para envio posterior.');
                    return { status: 'queued' };
                }
                throw new Error(errData.error || 'Falha ao enviar próxima parada');
            }

            return { status: 'sent' };
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                await enqueueForLater('sendDeliveryNextStop', [telefone, entrega, linkRastreio], 'Servidor inacessível: aviso de próxima parada salvo para envio posterior.');
                return { status: 'queued' };
            }
            console.error('Erro ao enviar próxima parada:', error);
            return { status: 'failed' };
        }
    },

    /**
     * Envia aviso de início de rota (opcional, pode ser usado para todos da rota)
     * @param {string} telefone
     * @param {string} nomeCliente
     * @param {string} previsao
     */
    sendDeliveryStart: async (telefone, nomeCliente, previsao) => {
        const msg = `Bom dia ${nomeCliente}! ☀️\n\n` +
            `Seu pedido saiu para entrega hoje!\n` +
            `Previsão de entrega: ${previsao}\n\n` +
            `Fique atento ao celular, avisaremos quando estivermos chegando.`;

        return whatsappService.sendMessage(telefone, msg);
    },

    /**
     * Notifica falha na entrega
     * @param {string} telefone 
     * @param {string} nomeCliente 
     * @param {string} motivo 
     */
    sendDeliveryFailure: async (telefone, nomeCliente, motivo) => {
        const msg = `Olá ${nomeCliente}.\n\n` +
            `Tentamos realizar sua entrega mas não conseguimos.\n` +
            `Motivo: ${motivo}\n\n` +
            `Entraremos em contato para reagendar.`;

        return whatsappService.sendMessage(telefone, msg);
    },

    /**
     * Notifica início de rota (Backend processa em lote)
     * @param {Array} entregas 
     */
    notifyRouteStart: async (entregas) => {
        if (!navigator.onLine) {
            await enqueueForLater('notifyRouteStart', [entregas], "Sem internet: Aviso de início de rota salvo para envio posterior.");
            return true;
        }

        try {
            const response = await fetch(`${API_URL}/aviso-inicio-rota`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify({ entregas })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('notifyRouteStart', [entregas], "WhatsApp indisponível: Aviso de rota salvo para envio posterior.");
                    return true;
                }
            }
            return response.ok;
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                await enqueueForLater('notifyRouteStart', [entregas], "Servidor inacessível: Aviso de rota salvo para envio posterior.");
                return true;
            }
            console.error("Erro ao notificar início de rota:", error);
            return false;
        }
    },

    /**
     * Notifica conclusão de entrega (Backend processa e avisa próximo)
     * @param {number} idConcluida 
     * @param {object} updateData 
     */
    notifyDeliveryCompletion: async (idConcluida, updateData) => {
        if (!navigator.onLine) {
            await enqueueForLater('notifyDeliveryCompletion', [idConcluida, updateData], "Sem internet: Confirmação de entrega salva para envio posterior.");
            return { status: 'queued' };
        }

        try {
            const response = await fetch(`${API_URL}/concluir-entrega`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify({
                    id_concluida: idConcluida,
                    update_data: updateData
                })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('notifyDeliveryCompletion', [idConcluida, updateData], "WhatsApp indisponível: Confirmação de entrega salva para envio posterior.");
                    return { status: 'queued' };
                }
            }
            return response.ok ? { status: 'sent' } : { status: 'failed' };
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                await enqueueForLater('notifyDeliveryCompletion', [idConcluida, updateData], "Servidor inacessível: Confirmação de entrega salva para posterior.");
                return { status: 'queued' };
            }
            console.error("Erro ao notificar conclusão:", error);
            return { status: 'failed' };
        }
    },
    /**
     * Envia confirmações em lote (usado no Kanban)
     * @param {Array} entregas - Array de objetos de entrega formatados
     */
    sendConfirmations: async (entregas) => {
        if (!navigator.onLine) {
            await enqueueForLater('sendConfirmations', [entregas], "Sem internet: Confirmações salvas para envio posterior.");
            return { ok: true, status: 200 }; // Fake response for UI success
        }

        try {
            const response = await fetch(`${API_URL}/disparar-confirmacoes`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify({ entregas })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('sendConfirmations', [entregas], "WhatsApp indisponível: confirmações salvas para envio posterior.");
                    return { ok: true, status: 200 };
                }
            }
            return response; // Retorna response para tratar erros específicos se necessário
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                await enqueueForLater('sendConfirmations', [entregas], "Servidor inacessível: Confirmações salvas para envio posterior.");
                return { ok: true, status: 200 }; // Fake response
            }
            console.error("Erro ao enviar confirmações:", error);
            throw error;
        }
    },

    /**
     * Reagenda entregas e notifica clientes
     * @param {Array} entregas - Array de {telefone, nome, numero_pedido}
     */
    rescheduleDeliveries: async (entregas) => {
        if (!navigator.onLine) {
            await enqueueForLater('rescheduleDeliveries', [entregas], "Sem internet: Notificação de reagendamento salva offline.");
            return true;
        }

        try {
            const response = await fetch(`${API_URL}/reagendar-entregas`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify({ entregas })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('rescheduleDeliveries', [entregas], "WhatsApp indisponível: reagendamento salvo offline.");
                    return true;
                }
            }
            return response.ok;
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                await enqueueForLater('rescheduleDeliveries', [entregas], "Servidor inacessível: Reagendamento salvo offline.");
                return true;
            }
            console.error("Erro ao reagendar entregas:", error);
            return false;
        }
    },

    /**
     * Notifica agendamento de montagem (Montador Externo)
     * @param {object} data
     */
    notifyAssemblyScheduled: async (data) => {
        if (!navigator.onLine) {
            return enqueueForLater('notifyAssemblyScheduled', [data], "Sem internet: Aviso de agendamento salvo offline.");
        }

        try {
            const response = await fetch(`${API_URL}/aviso-montagem-agendada`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    return enqueueForLater('notifyAssemblyScheduled', [data], "WhatsApp indisponível: Aviso de agendamento salvo offline.");
                }
                console.error("Erro ao notificar agendamento de montagem:", errData);
                return false;
            }
            return true;
        } catch (error) {
            if (isFetchConnectionError(error)) {
                return enqueueForLater('notifyAssemblyScheduled', [data], "Servidor inacessível: Aviso de agendamento salvo offline.");
            }
            console.error("Erro ao notificar agendamento de montagem:", error);
            return false;
        }
    },

    /**
     * Notifica cancelamento de montagem
     * @param {object} data
     */
    notifyAssemblyCancelled: async (data) => {
        if (!navigator.onLine) {
            return enqueueForLater('notifyAssemblyCancelled', [data], "Sem internet: Aviso de cancelamento salvo offline.");
        }

        try {
            const response = await fetch(`${API_URL}/aviso-montagem-cancelada`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    return enqueueForLater('notifyAssemblyCancelled', [data], "WhatsApp indisponível: Aviso de cancelamento salvo offline.");
                }
                console.error("Erro ao notificar cancelamento de montagem:", errData);
                return false;
            }
            return true;
        } catch (error) {
            if (isFetchConnectionError(error)) {
                return enqueueForLater('notifyAssemblyCancelled', [data], "Servidor inacessível: Aviso de cancelamento salvo offline.");
            }
            console.error("Erro ao notificar cancelamento de montagem:", error);
            return false;
        }
    },

    /**
     * Notifica reagendamento de montagem
     * @param {object} data
     */
    notifyAssemblyRescheduled: async (data) => {
        if (!navigator.onLine) {
            return enqueueForLater('notifyAssemblyRescheduled', [data], "Sem internet: Aviso de reagendamento salvo offline.");
        }

        try {
            const response = await fetch(`${API_URL}/aviso-montagem-reagendada`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    return enqueueForLater('notifyAssemblyRescheduled', [data], "WhatsApp indisponível: Aviso de reagendamento salvo offline.");
                }
                console.error("Erro ao notificar reagendamento de montagem:", errData);
                return false;
            }
            return true;
        } catch (error) {
            if (isFetchConnectionError(error)) {
                return enqueueForLater('notifyAssemblyRescheduled', [data], "Servidor inacessível: Aviso de reagendamento salvo offline.");
            }
            console.error("Erro ao notificar reagendamento de montagem:", error);
            return false;
        }
    },

    /**
     * Envia mensagem de marketing
     * @param {object} data 
     */
    sendMarketingMessage: async (data) => {
        if (!navigator.onLine) {
            await enqueueForLater('sendMarketingMessage', [data], "Sem internet: Marketing salvo offline.");
            return true;
        }
        try {
            const response = await fetch(`${API_URL}/enviar-mensagem-marketing`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('sendMarketingMessage', [data], "WhatsApp indisponível: Marketing salvo offline.");
                    return true;
                }

                console.error("Erro ao enviar mensagem de marketing:", errData);
                return false;
            }
            return response.ok;
        } catch (error) {
            if (isFetchConnectionError(error)) {
                await enqueueForLater('sendMarketingMessage', [data], "Servidor inacessível: Marketing salvo offline.");
                return true;
            }
            console.error("Erro ao enviar mensagem de marketing:", error);
            return false;
        }
    },

    /**
     * Envia confirmação de venda pós-venda via WhatsApp (com PDF anexo)
     * @param {object} data - { telefone, nome, pedido, prazo, produtos, pdf_base64 }
     */
    sendSaleConfirmation: async (data) => {
        if (!navigator.onLine) {
            await enqueueForLater('sendSaleConfirmation', [data], "Sem internet: Comprovante de venda salvo para envio posterior via WhatsApp.");
            return true;
        }

        try {
            const response = await fetch(`${API_URL}/mensagem-pos-venda`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify(data)
            });

            const responseData = await response.json().catch(() => ({}));

            if (!response.ok) {
                console.error('❌ Bot respondeu com erro:', responseData);
                if (isLikelyBotOfflineResponse(response.status, responseData)) {
                    await enqueueForLater('sendSaleConfirmation', [data], "WhatsApp desconectado: Comprovante salvo para envio automático quando reconectar.");
                    return true;
                } else {
                    toast.error("Erro ao enviar comprovante no WhatsApp.");
                }
                return false;
            }

            console.log("✅ WhatsApp enviado:", responseData);
            toast.success("Comprovante enviado ao cliente via WhatsApp!");
            return true;
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                await enqueueForLater('sendSaleConfirmation', [data], "WhatsApp Desconectado ou Servidor inacessível: Comprovante de venda salvo para envio posterior.");
                return true;
            }
            console.error("❌ Erro conexão bot:", error);
            toast.warning("Não foi possível conectar ao robô de WhatsApp agora.");
            return false;
        }
    },

    /**
     * Envia mensagem de aniversário
     * @param {object} data 
     */
    sendBirthdayMessage: async (data) => {
        if (!navigator.onLine) {
            await enqueueForLater('sendBirthdayMessage', [data], "Sem internet: Mensagem de aniversário salva offline.");
            return true;
        }

        try {
            const response = await fetch(`${API_URL}/enviar-mensagem-aniversario`, {
                method: 'POST',
                headers: await botHeaders(),
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                if (isLikelyBotOfflineResponse(response.status, errData)) {
                    await enqueueForLater('sendBirthdayMessage', [data], "WhatsApp indisponível: Mensagem de aniversário salva offline.");
                    return true;
                }

                console.error("Erro ao enviar mensagem de aniversário:", errData);
                return false;
            }
            return response.ok;
        } catch (error) {
            if (isFetchConnectionError(error)) {
                await enqueueForLater('sendBirthdayMessage', [data], "Servidor inacessível: Mensagem de aniversário salva offline.");
                return true;
            }
            console.error("Erro ao enviar mensagem de aniversário:", error);
            return false;
        }
    },

    /**
     * Consulta todas as pendências acumuladas (local e backend)
     */
    getPendingQueueInfo: async () => {
        try {
            const localItems = await getOfflineQueue();

            let backendItems = [];
            let backendCount = 0;

            try {
                const response = await fetch(`${API_URL}/whatsapp/queue/pending`, {
                    headers: await botHeaders()
                });
                if (response.ok) {
                    const data = await response.json();
                    backendCount = data.count || 0;
                    backendItems = data.items || [];
                }
            } catch (err) {
                console.warn("Não foi possível buscar fila do backend:", err.message);
            }

            return {
                totalCount: (localItems?.length || 0) + backendCount,
                localCount: localItems?.length || 0,
                backendCount: backendCount,
                localItems: localItems || [],
                backendItems: backendItems || []
            };
        } catch (error) {
            console.error("Erro ao obter informações da fila pendente:", error);
            return { totalCount: 0, localCount: 0, backendCount: 0, localItems: [], backendItems: [] };
        }
    },

    /**
     * Envia todas as mensagens pendentes acumuladas (processa local e backend)
     */
    processAllPendingQueues: async () => {
        let sucessosLocal = 0;
        let falhasLocal = 0;

        // 1. Processar fila local
        try {
            const localItems = await getOfflineQueue();
            for (const item of localItems) {
                try {
                    if (typeof whatsappService[item.action] === 'function') {
                        const res = await whatsappService[item.action](...item.payload);
                        if (res === true || res?.status === 'sent' || res?.ok) {
                            await removeOfflineQueueItem(item.id);
                            sucessosLocal++;
                        } else {
                            falhasLocal++;
                        }
                    } else {
                        await removeOfflineQueueItem(item.id);
                    }
                } catch (e) {
                    falhasLocal++;
                }
            }
        } catch (err) {
            console.error("Erro ao processar fila local:", err);
        }

        // 2. Disparar processamento no backend
        let backendOk = false;
        try {
            const res = await fetch(`${API_URL}/whatsapp/queue/process`, {
                method: 'POST',
                headers: await botHeaders()
            });
            backendOk = res.ok;
        } catch (err) {
            console.error("Erro ao disparar fila do backend:", err);
        }

        return {
            sucessosLocal,
            falhasLocal,
            backendOk
        };
    },

    /**
     * Descarta/apaga todas as mensagens pendentes acumuladas (limpa local e backend)
     */
    clearAllPendingQueues: async () => {
        // 1. Limpar fila local
        const localCleared = await clearOfflineQueue();

        // 2. Limpar fila no backend
        let backendCancelledCount = 0;
        try {
            const res = await fetch(`${API_URL}/whatsapp/queue/clear`, {
                method: 'POST',
                headers: await botHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                backendCancelledCount = data.cancelled_count || 0;
            }
        } catch (err) {
            console.error("Erro ao limpar fila do backend:", err);
        }

        return {
            localCleared,
            backendCancelledCount
        };
    }
};


