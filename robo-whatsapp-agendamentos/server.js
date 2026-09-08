const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// 🚨 FORÇA BRUTA: Ignora qualquer configuração de path do Chrome que esteja no .env da VPS
// O .env antigo aponta para /usr/bin/google-chrome-stable que NÃO EXISTE mais na imagem node:20
// delete process.env.PUPPETEER_EXECUTABLE_PATH; // Removido para permitir config via ENV se necessário

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// --- CONFIGURAÇÕES (via variáveis de ambiente) ---
const PORT = process.env.PORT || 3001;

// 🚨 SUPABASE (Banco de Dados)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TRACKING_TOKEN_SECRET = process.env.TRACKING_TOKEN_SECRET;
if (!TRACKING_TOKEN_SECRET) {
  throw new Error('TRACKING_TOKEN_SECRET é obrigatório em produção.');
}
const TRACKING_TOKEN_TTL_SECONDS = Number(process.env.TRACKING_TOKEN_TTL_SECONDS || 7200);
const OFFICIAL_TRACKING_BASE_URL = 'https://moveispedro2.com.br';
const LOCAL_DEV_TRACKING_BASE_URL = 'http://localhost:5173';

function isLocalhostUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch (error) {
        return false;
    }
}

function getTrackingBaseUrl() {
    const configuredUrl = (process.env.PUBLIC_URL || '').trim();
    const normalizedConfiguredUrl = configuredUrl.replace(/\/+$/, '');

    if (process.env.NODE_ENV === 'production') {
        return OFFICIAL_TRACKING_BASE_URL;
    }

    if (normalizedConfiguredUrl && isLocalhostUrl(normalizedConfiguredUrl)) {
        return normalizedConfiguredUrl;
    }

    return LOCAL_DEV_TRACKING_BASE_URL;
}

function base64UrlEncode(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function base64UrlDecode(input) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function createTrackingToken(payload, ttlSeconds = TRACKING_TOKEN_TTL_SECONDS) {
    const now = Math.floor(Date.now() / 1000);
    const body = {
        ...payload,
        iat: now,
        exp: now + Math.max(60, Number(ttlSeconds) || TRACKING_TOKEN_TTL_SECONDS)
    };
    const encoded = base64UrlEncode(JSON.stringify(body));
    const signature = crypto.createHmac('sha256', TRACKING_TOKEN_SECRET).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}

function verifyTrackingToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        throw new Error('Token inválido');
    }

    const [encoded, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', TRACKING_TOKEN_SECRET).update(encoded).digest('base64url');

    if (!signature || signature.length !== expected.length) {
        throw new Error('Assinatura inválida');
    }

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        throw new Error('Assinatura inválida');
    }

    const payload = JSON.parse(base64UrlDecode(encoded));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
        throw new Error('Token expirado');
    }

    return payload;
}

const STATUS_ENTREGA_FINALIZADOS = new Set(['entregue', 'concluida', 'concluída', 'cancelada', 'cancelado', 'retirado', 'finalizada']);
const STATUS_ENTREGA_ATIVOS = new Set(['próxima parada', 'proxima parada', 'a caminho', 'em rota']);
const STATUS_ENTREGA_FILA = new Set(['próxima parada', 'proxima parada', 'a caminho', 'em rota', 'pendente']);

const WHATSAPP_SETTINGS_CACHE_TTL_MS = 30000;
let whatsappSettingsCache = { data: null, expiresAt: 0 };

function parseBooleanSetting(value, defaultValue = true) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'sim', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'nao', 'não', 'no', 'off'].includes(normalized)) return false;
    }
    return defaultValue;
}

async function getWhatsAppSettings(forceRefresh = false, orgId = DEFAULT_ORG_ID) {
    if (!orgId) orgId = DEFAULT_ORG_ID;

    const { data, error } = await supabase
        .from('whatsapp_bot_settings')
        .select('key, value')
        .eq('organization_id', orgId);

    if (error) {
        console.warn(`Erro ao carregar configurações para Org ${orgId}:`, error.message);
        return {};
    }

    const settings = {};
    (data || []).forEach((row) => {
        settings[row.key] = row.value;
    });

    return settings;
}

function renderTemplate(template, variables = {}) {
    return Object.entries(variables).reduce((text, [key, value]) => {
        const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        return text.replace(placeholder, value ?? '');
    }, template || '');
}

async function buildMessageFromSettings(messageKey, fallbackTemplate, variables = {}, defaultEnabled = true, orgId = DEFAULT_ORG_ID) {
    try {
        const settings = await getWhatsAppSettings(false, orgId);
        const enabled = parseBooleanSetting(settings[`msg_${messageKey}_enabled`], defaultEnabled);
        const template = settings[`msg_${messageKey}_template`] || fallbackTemplate;
        return {
            enabled,
            message: renderTemplate(template, variables)
        };
    } catch (error) {
        console.error(`Erro ao carregar template configurável (${messageKey}) para Org ${orgId}:`, error.message);
        return {
            enabled: defaultEnabled,
            message: renderTemplate(fallbackTemplate, variables)
        };
    }
}

// 🔐 Rotas de Autenticação de Funcionários
const { setupEmployeeAuthRoutes } = require('./routes/authEmployee');

const app = express();
// 🛡️ Bulletproof CORS: Allow ALL origins.
app.use(cors());

// 🛡️ Global Crash Prevention
process.on('uncaughtException', (err) => {
    console.error('🔥 CRITICAL ERROR (Uncaught):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    const msg = reason?.message || String(reason);

    // 🛡️ Tratamento específico para o erro de "Browser already running" (Sessão travada)
    if (msg.includes('browser is already running') || msg.includes('EBUSY') || msg.includes('EPERM')) {
        console.warn('⚠️ BLOQUEIO DE SESSÃO DETECTADO (Unhandled Rejection):', msg);
        console.log('🔄 Iniciando protocolo de recuperação de emergência...');

        try {
            if (typeof whatsapp !== 'undefined' && typeof currentClientId !== 'undefined') {
                // Forçar rotação de ID
                currentClientId = `client-v2-${Date.now()}`;
                console.log(`🆔 Novo ID gerado na emergência: ${currentClientId}`);

                // Reiniciar
                whatsapp.isInitializing = false;
                setTimeout(() => whatsapp.initialize(), 2500);
            } else {
                console.error('❌ Não foi possível acessar o objeto whatsapp para recuperação. Reiniciando processo...');
                process.exit(1);
            }
        } catch (e) {
            console.error('❌ Erro fatal na recuperação:', e);
            process.exit(1);
        }
        return;
    }

    // Auth timeout é esperado quando a sessão WhatsApp expira — não é crítico
    // Auth timeout é esperado quando a sessão WhatsApp expira — não é crítico
    if (msg.includes('auth timeout') ||
        msg.includes('Navigation timeout') ||
        msg.includes('Protocol error') ||
        msg.includes('LifecycleWatcher disposed') ||
        msg.includes('Target closed')
    ) {
        console.warn('⚠️ WhatsApp auth/retry warning (não crítico):', msg);
        // Tentar reconexão suave se possível
        try { if (typeof whatsapp !== 'undefined') whatsapp.reconnect(`unhandled: ${msg}`); } catch (e) { void e; }
    } else {
        console.error('🔥 CRITICAL ERROR (Unhandled Rejection):', reason);
    }
});

// Aumentar limite de listeners
require('events').EventEmitter.defaultMaxListeners = 20;
// Aumentar limite do body para suportar PDF base64 (~200KB+)
app.use(express.json({ limit: '10mb' }));

// =============================================================================
// 🔒 SEGURANÇA: Checagem de módulo WhatsApp por organização (PLANO/ASSINATURA)
// =============================================================================
// IMPORTANTE — COMENTÁRIO DE SEGURANÇA:
// Este bot roda com SUPABASE_SERVICE_KEY (service role), que IGNORA RLS.
// Portanto, NÃO podemos confiar em RLS para bloquear envios aqui.
// A checagem abaixo é EXPLÍCITA: consulta organization_settings.modulos_ativos
// diretamente via query, antes de permitir qualquer envio de mensagem.
// Essa é a camada de segurança real do bot — a RLS na tabela
// whatsapp_message_queue protege apenas inserções client-side (frontend).
// =============================================================================

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const MODULE_CHECK_CACHE_TTL_MS = 30000; // 30s cache
let moduleCheckCache = {}; // { [orgId]: { active: bool, expiresAt: number } }

/**
 * Verifica se o módulo 'whatsapp' está ativo para a organização.
 * Retorna false se a chave não existir (fail-safe: ausente = desativado).
 * Usa cache de 30s para evitar queries excessivas.
 */
async function verificarModuloWhatsApp(orgId = DEFAULT_ORG_ID) {
    const now = Date.now();
    const cached = moduleCheckCache[orgId];
    if (cached && now < cached.expiresAt) {
        return cached.active;
    }

    try {
        const { data, error } = await supabase
            .from('organization_settings')
            .select('modulos_ativos')
            .eq('organization_id', orgId)
            .single();

        if (error || !data) {
            console.warn(`⚠️ [ModuleCheck] Falha ao verificar módulo whatsapp para org ${orgId}:`, error?.message);
            // Fail-safe: sem dados = desativado
            moduleCheckCache[orgId] = { active: false, expiresAt: now + MODULE_CHECK_CACHE_TTL_MS };
            return false;
        }

        const modulosAtivos = data.modulos_ativos || {};
        // Fail-safe: chave ausente = desativado
        const whatsappAtivo = modulosAtivos.whatsapp === true;

        moduleCheckCache[orgId] = { active: whatsappAtivo, expiresAt: now + MODULE_CHECK_CACHE_TTL_MS };
        return whatsappAtivo;
    } catch (e) {
        console.error(`💥 [ModuleCheck] Erro crítico ao verificar módulo whatsapp:`, e.message);
        return false; // Fail-safe
    }
}

/**
 * Middleware Express que bloqueia rotas de envio de WhatsApp
 * quando o módulo não está ativo para a organização.
 * Aceita organization_id no body da requisição; se ausente, usa o tenant padrão.
 */
const WHATSAPP_SEND_ROUTES = new Set([
    '/send-text',
    '/send-image-url',
    '/disparar-confirmacoes',
    '/mensagem-pos-venda',
    '/aviso-inicio-rota',
    '/aviso-proxima-parada',
    '/reagendar-entregas',
    '/entrega-nao-realizada',
    '/enviar-mensagem-marketing',
    '/enviar-mensagem-aniversario',
    '/aviso-montagem-agendada',
    '/aviso-montagem-cancelada',
    '/aviso-montagem-reagendada',
    '/confirmar-montagem',
    '/lembrete-montagem',
    '/montador-a-caminho',
    '/concluir-entrega'
]);


// Rotas que exigem JWT de usuário autenticado
const BOT_PROTECTED_ROUTES = new Set([
    '/send-text', '/send-image-url',
    '/disparar-confirmacoes', '/mensagem-pos-venda',
    '/aviso-inicio-rota', '/aviso-proxima-parada',
    '/reagendar-entregas', '/entrega-nao-realizada',
    '/enviar-mensagem-marketing', '/enviar-mensagem-aniversario',
    '/aviso-montagem-agendada', '/aviso-montagem-cancelada',
    '/aviso-montagem-reagendada', '/confirmar-montagem',
    '/lembrete-montagem', '/montador-a-caminho',
    '/concluir-entrega', '/buscar-produto-ia',
    '/whatsapp/reconnect', '/whatsapp/disconnect',
    '/whatsapp/ai-settings',
    '/whatsapp/queue/pending', '/whatsapp/queue/process', '/whatsapp/queue/clear',
    '/status', '/whatsapp/status', '/logs',
]);

const { createBotAuth } = require('./authMiddleware');
app.use(createBotAuth(supabase, BOT_PROTECTED_ROUTES));

app.use(async (req, res, next) => {
    // Só verificar rotas POST de envio de mensagem
    if (req.method !== 'POST' || !WHATSAPP_SEND_ROUTES.has(req.path)) {
        return next();
    }

    const orgId = req.auth?.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Não autenticado' });
    const moduloAtivo = await verificarModuloWhatsApp(orgId);

    if (!moduloAtivo) {
        console.warn(`🚫 [ModuleCheck] Módulo WhatsApp DESATIVADO para org ${orgId}. Bloqueando rota ${req.path}.`);
        return res.status(403).json({
            error: 'Módulo de WhatsApp não incluído no seu plano atual.',
            code: 'MODULE_DISABLED',
            module: 'whatsapp',
            organization_id: orgId
        });
    }

    next();
});

// 🔐 PROTEÇÃO DE ROTAS DO BOT — Middleware de JWT
// 🏗️ SERVE FRONTEND (Monolith Mode)
// Serves static files from the React build folder
// Works both locally (../dist) and in Docker (/app/dist)
const distPath = fs.existsSync(path.join(__dirname, 'dist'))
    ? path.join(__dirname, 'dist')
    : path.join(__dirname, '../dist');
app.use(express.static(distPath));

// =============================================================================
// 🤖 TENANT WHATSAPP MANAGER — Gerenciador Multi-Tenant / Multi-Sessão
// =============================================================================
const { TenantWhatsAppManager } = require('./TenantWhatsAppManager');
const whatsappManager = new TenantWhatsAppManager(supabase);

/**
 * Helper para extrair o ID da organização do request (Headers, Query ou Body)
 */
function extractOrgId(req) {
    if (!req.auth?.organizationId) throw new Error('Organização autenticada obrigatória');
    return req.auth.organizationId;
}

let filaEspera = {};
let mapaEntregas = {};

// =============================================================================
// 📦 SISTEMA DE FILA DE MENSAGENS POR ORGANIZAÇÃO (PERSISTENTE)
// =============================================================================

/**
 * Adiciona uma mensagem à fila de espera no Supabase com isolamento de tenant
 */
async function adicionarAFila(phone, message, options = {}, venda_id = null, orgId = DEFAULT_ORG_ID) {
    if (!orgId) orgId = DEFAULT_ORG_ID;
    console.log(`📥 [Org: ${orgId}] Adicionando mensagem para ${phone} à fila...`);
    try {
        const { error } = await supabase
            .from('whatsapp_message_queue')
            .insert({
                phone,
                message,
                options,
                venda_id,
                organization_id: orgId,
                status: 'pending',
                created_at: new Date().toISOString()
            });

        if (error) {
            console.error(`❌ [Org: ${orgId}] Erro ao inserir na fila do Supabase:`, error.message);
            return false;
        }
        console.log(`✅ [Org: ${orgId}] Mensagem para ${phone} guardada na fila.`);
        return true;
    } catch (e) {
        console.error(`💥 [Org: ${orgId}] Erro fatal ao adicionar à fila:`, e.message);
        return false;
    }
}

/**
 * Processa mensagens pendentes na fila (isolado por organização ou geral)
 */
async function processarFila(targetOrgId = null) {
    try {
        let query = supabase
            .from('whatsapp_message_queue')
            .select('*')
            .eq('status', 'pending')
            .lt('attempts', 5)
            .order('created_at', { ascending: true })
            .limit(20);

        if (targetOrgId) {
            query = query.eq('organization_id', targetOrgId);
        }

        const { data: pendentes, error } = await query;
        if (error || !pendentes || pendentes.length === 0) return;

        console.log(`🤖 Processando ${pendentes.length} mensagens da fila${targetOrgId ? ` para Org: ${targetOrgId}` : ''}...`);

        for (const item of pendentes) {
            const itemOrgId = item.organization_id || targetOrgId || DEFAULT_ORG_ID;
            try {
                // Incrementar tentativas
                await supabase
                    .from('whatsapp_message_queue')
                    .update({
                        attempts: (item.attempts || 0) + 1,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', item.id);

                let tel = item.phone.replace(/\D/g, '');
                if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
                let chatId = `${tel}@c.us`;

                const res = await whatsappManager.sendMessage(itemOrgId, chatId, item.message, item.options || {});

                if (res.success) {
                    await supabase
                        .from('whatsapp_message_queue')
                        .update({
                            status: 'sent',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', item.id);
                    console.log(`✅ [Org: ${itemOrgId}] Mensagem enviada para ${chatId}`);
                } else {
                    throw new Error(res.error || 'Falha no envio');
                }

                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                console.error(`❌ [Org: ${itemOrgId}] Falha ao processar item (${item.id}):`, err.message);
                if ((item.attempts || 0) + 1 >= 5) {
                    await supabase
                        .from('whatsapp_message_queue')
                        .update({
                            status: 'failed',
                            last_error: err.message,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', item.id);
                } else {
                    await supabase
                        .from('whatsapp_message_queue')
                        .update({
                            last_error: err.message,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', item.id);
                }
            }
        }
    } catch (e) {
        console.error('💥 Erro no processador de fila:', e.message);
    }
}

// 🔐 Registrar rotas de autenticação de funcionários
setupEmployeeAuthRoutes(app, supabase, whatsappManager);

function limparJSON(texto) {
    try {
        const inicio = texto.indexOf('{');
        const fim = texto.lastIndexOf('}');
        if (inicio !== -1 && fim !== -1) return JSON.parse(texto.substring(inicio, fim + 1));
        return JSON.parse(texto);
    } catch (e) { return null; }
}

// 🛡️ Enviar mensagem com verificação de módulo e isolamento de tenant
async function enviarMensagemSegura(chatId, content, options = {}) {
    try {
        const orgId = options.organization_id || DEFAULT_ORG_ID;
        const moduloAtivo = await verificarModuloWhatsApp(orgId);
        if (!moduloAtivo) {
            console.warn(`🚫 [ModuleCheck] Módulo WhatsApp DESATIVADO para org ${orgId}. Bloqueando envio para ${chatId}.`);
            return { success: false, blocked: true, error: 'Módulo de WhatsApp não incluído no plano atual.' };
        }

        const result = await whatsappManager.sendMessage(orgId, chatId, content, options);
        if (result.success) {
            return result;
        }

        // Se o WhatsApp não estiver conectado, guarda na fila da organização
        console.warn(`⚠️ [Org: ${orgId}] WhatsApp offline ou falha no envio. Guardando na fila.`);
        await adicionarAFila(chatId, content, options, options.venda_id, orgId);
        return { success: true, queued: true, message: "Mensagem guardada para envio posterior na fila da organização." };
    } catch (outerError) {
        try { await adicionarAFila(chatId, content, options, options.venda_id); } catch (_) {}
        return { success: true, queued: true, error: outerError?.message || String(outerError) };
    }
}

// 📡 Event handlers são registrados via attachClientEvents() no factory
// Não registrar inline aqui pois o `client` é recriado a cada tentativa

// --- ROTA DE HEALTH CHECK (RENDER) ---
app.get('/', (req, res) => res.status(200).send('Bot is running! 🚀'));

// --- ROTA DE ENVIO DE TEXTO GENÉRICO ---
app.post('/send-text', async (req, res) => {
    const { phone, message } = req.body;
    const orgId = extractOrgId(req);

    if (!phone || !message) {
        return res.status(400).json({ error: "phone e message são obrigatórios" });
    }

    let tel = phone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;

    try {
        let chatId = `${tel}@c.us`;
        const result = await enviarMensagemSegura(chatId, message, { organization_id: orgId });
        res.json(result);
    } catch (e) {
        console.error(`❌ [Org: ${orgId}] Erro ao enviar texto genérico:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA DE ENVIO DE IMAGEM VIA URL ---
app.post('/send-image-url', async (req, res) => {
    const { phone, imageUrl, caption } = req.body;
    const orgId = extractOrgId(req);

    if (!phone || !imageUrl) {
        return res.status(400).json({ error: "phone e imageUrl são obrigatórios" });
    }

    let tel = phone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;

    try {
        let chatId = `${tel}@c.us`;
        const media = await MessageMedia.fromUrl(imageUrl);
        const result = await enviarMensagemSegura(chatId, media, { caption, organization_id: orgId });
        res.json(result);
    } catch (e) {
        console.error(`❌ [Org: ${orgId}] Erro ao enviar imagem via URL:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA DE STATUS GERAL POR ORGANIZAÇÃO ---
app.get('/status', async (req, res) => {
    const orgId = extractOrgId(req);
    const statusData = await whatsappManager.getStatus(orgId);
    res.json({ status: statusData.status, organization_id: orgId });
});

// --- LOG CAPTURE SYSTEM (IN-MEMORY) ---
const MAX_LOGS = 100;
const memoryLogs = [];

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function captureLog(type, args) {
    const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8); // HH:mm:ss
    memoryLogs.unshift(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    if (memoryLogs.length > MAX_LOGS) memoryLogs.pop();
}

console.log = (...args) => { captureLog('info', args); originalConsoleLog.apply(console, args); };
console.error = (...args) => { captureLog('error', args); originalConsoleError.apply(console, args); };
console.warn = (...args) => { captureLog('warn', args); originalConsoleWarn.apply(console, args); };

// --- ROTA DE STATUS DO WHATSAPP POR ORGANIZAÇÃO (PARA A INTERFACE) ---
app.get('/whatsapp/status', async (req, res) => {
    const orgId = extractOrgId(req);
    const statusData = await whatsappManager.getStatus(orgId);
    res.json(statusData);
});

// --- ROTA DE LOGS (DEBUG) ---
app.get('/logs', (req, res) => {
    res.json(memoryLogs);
});

// --- ROTA PARA CARREGAR CONFIGURAÇÕES DO AGENTE IA POR ORGANIZAÇÃO ---
app.get('/whatsapp/ai-settings', async (req, res) => {
    try {
        const orgId = extractOrgId(req);
        const settings = await getWhatsAppSettings(true, orgId);
        res.json(settings);
    } catch (e) {
        console.error('Erro ao carregar configurações:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA PARA SALVAR CONFIGURAÇÕES DO AGENTE IA POR ORGANIZAÇÃO ---
app.post('/whatsapp/ai-settings', async (req, res) => {
    try {
        const orgId = extractOrgId(req);
        const settings = req.body;

        for (const [key, value] of Object.entries(settings)) {
            if (key === 'organization_id') continue;
            const { error } = await supabase
                .from('whatsapp_bot_settings')
                .upsert({
                    organization_id: orgId,
                    key,
                    value,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'organization_id,key' });

            if (error) throw error;
        }

        console.log(`✅ [Org: ${orgId}] Configurações do agente IA salvas`);
        res.json({ success: true, organization_id: orgId });
    } catch (e) {
        console.error('Erro ao salvar configurações:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTAS DE GERENCIAMENTO DE FILA PENDENTE POR ORGANIZAÇÃO ---

// Consultar mensagens pendentes na fila da organização
app.get('/whatsapp/queue/pending', async (req, res) => {
    try {
        const orgId = extractOrgId(req);
        const { data, error, count } = await supabase
            .from('whatsapp_message_queue')
            .select('id, phone, message, created_at, attempts, status, options, organization_id', { count: 'exact' })
            .eq('status', 'pending')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        res.json({
            success: true,
            count: count || (data ? data.length : 0),
            items: data || [],
            organization_id: orgId
        });
    } catch (e) {
        console.error('❌ Erro ao consultar fila pendente do WhatsApp:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Disparar processamento das mensagens pendentes da organização
app.post('/whatsapp/queue/process', async (req, res) => {
    try {
        const orgId = extractOrgId(req);
        console.log(`🚀 [Fila] Solicitação de envio das mensagens pendentes para Org ${orgId}...`);
        processarFila(orgId);
        res.json({
            success: true,
            message: 'Envio da fila pendente iniciado com sucesso.',
            organization_id: orgId
        });
    } catch (e) {
        console.error('❌ Erro ao iniciar envio da fila pendente:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Descartar/apagar mensagens pendentes acumuladas da organização
app.post('/whatsapp/queue/clear', async (req, res) => {
    try {
        const orgId = extractOrgId(req);
        console.log(`🗑️ [Fila] Descartando mensagens pendentes para Org ${orgId}...`);
        const { data, error } = await supabase
            .from('whatsapp_message_queue')
            .update({
                status: 'cancelled',
                last_error: 'Descartado pelo usuário ao conectar WhatsApp',
                updated_at: new Date().toISOString()
            })
            .eq('status', 'pending')
            .eq('organization_id', orgId)
            .select('id');

        if (error) throw error;

        const count = data ? data.length : 0;
        console.log(`✅ [Fila] ${count} mensagens pendentes canceladas para Org ${orgId}.`);
        res.json({
            success: true,
            cancelled_count: count,
            message: `${count} mensagens pendentes foram descartadas com sucesso.`,
            organization_id: orgId
        });
    } catch (e) {
        console.error('❌ Erro ao descartar fila pendente:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- ROTA PARA FORÇAR RECONEXÃO DA ORGANIZAÇÃO ---
app.post('/whatsapp/reconnect', async (req, res) => {
    try {
        const orgId = extractOrgId(req);
        const result = await whatsappManager.reconnect(orgId);
        res.json(result);
    } catch (e) {
        console.error('Erro ao reconectar:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA PARA DESCONECTAR A ORGANIZAÇÃO ---
app.post('/whatsapp/disconnect', async (req, res) => {
    try {
        const orgId = extractOrgId(req);
        const result = await whatsappManager.disconnect(orgId);
        res.json(result);
    } catch (e) {
        console.error('Erro ao desconectar:', e);
        res.status(500).json({ error: e.message });
    }
});


// --- ROTA 1: DISPARO DE CONFIRMAÇÕES (ASSERTIVO / INFORMATIVO) ---
app.post('/disparar-confirmacoes', async (req, res) => {
    const { entregas } = req.body;
    console.log(`📦 Recebido lote de ${entregas.length} entregas.`);
    res.json({ success: true });

    for (const entrega of entregas) {
        if (!entrega.telefone) continue;
        let tel = entrega.telefone.replace(/\D/g, '');
        if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;

        try {
            const numberId = await client.getNumberId(tel);
            const chatId = numberId ? numberId._serialized : `${tel}@c.us`;

            const dadosEntrega = {
                id: entrega.id,
                nome: entrega.cliente_nome,
                pedido: entrega.numero_pedido,
                turno: entrega.turno || "Comercial",
                timestamp: Date.now()
            };

            filaEspera[tel] = dadosEntrega;
            mapaEntregas[chatId] = dadosEntrega;

            // --- LÓGICA DE HORÁRIOS ---
            let horarioTexto = "entre 08:00 e 18:00";

            if (entrega.turno?.toLowerCase().includes("manh")) {
                horarioTexto = "entre 08:00 e 13:00";
            } else if (entrega.turno?.toLowerCase().includes("tarde")) {
                horarioTexto = "entre 13:00 e 18:00";
            }

            // --- FORMATAR DATA (com timezone correto) ---
            let dataTexto = "em breve";
            if (entrega.data_agendada) {
                try {
                    // Parse da data corretamente (pode vir YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS)
                    // Parse seguro da data agendada (YYYY-MM-DD)
                    const dataStr = entrega.data_agendada.split('T')[0];

                    // Data de Hoje (Fuso BR)
                    const now = new Date();
                    const hojeStr = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('-');

                    // Data de Amanhã (Fuso BR)
                    const amanha = new Date(now);
                    amanha.setDate(amanha.getDate() + 1);
                    const amanhaStr = amanha.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('-');

                    if (dataStr === hojeStr) {
                        dataTexto = "HOJE";
                    } else if (dataStr === amanhaStr) {
                        dataTexto = "AMANHÃ";
                    } else {
                        // Formato dd/mm
                        const [ano, mes, dia] = dataStr.split('-');
                        dataTexto = `${dia}/${mes}`;
                    }
                } catch (e) {
                    console.log('Erro ao parsear data:', e.message);
                    dataTexto = "em breve";
                }
            }

            const isReagendamento = entrega.is_reagendamento === true;

            const confirmacaoTemplate = `Olá *{{nome}}*! 👋
Aqui é da *Móveis Pedro II*.

🚚 *Sua entrega está confirmada!*

📦 Pedido: #{{pedido}}
📅 Data: *{{data}}*
🕐 Horário: *{{horario}}*

*O que você vai receber:*
{{produtos}}

✅ Tudo certo por aqui! Nossa equipe já está preparando seu pedido.

⚠️ *Lembre-se:* É necessário que tenha alguém *maior de idade* no local para receber e conferir os itens.

_O horário pode ter pequenas variações devido ao trânsito._`;

            const reagendamentoTemplate = `Olá *{{nome}}*! 😔

Pedimos desculpas, mas *ocorreu um imprevisto* e precisaremos reagendar a sua entrega.

📦 Pedido: *#{{pedido}}*

Fique tranquilo(a)! O reagendamento será feito dentro do prazo original do seu pedido.

Nossa equipe entrará em contato em breve para confirmar a nova data da entrega.

Pedimos desculpas pelo inconveniente. 🙏
*Móveis Pedro II*`;

            const messageConfig = isReagendamento
                ? await buildMessageFromSettings('reagendamento', reagendamentoTemplate, {
                    nome: entrega.cliente_nome || 'Cliente',
                    pedido: entrega.numero_pedido || '-',
                    data: dataTexto,
                    horario: horarioTexto,
                    produtos: entrega.produtos || 'Móveis diversos'
                })
                : await buildMessageFromSettings('entrega_confirmacao', confirmacaoTemplate, {
                    nome: entrega.cliente_nome || 'Cliente',
                    pedido: entrega.numero_pedido || '-',
                    data: dataTexto,
                    horario: horarioTexto,
                    produtos: entrega.produtos || 'Móveis diversos'
                });

            if (!messageConfig.enabled) {
                continue;
            }

            const msgEnviada = await client.sendMessage(chatId, messageConfig.message);
            console.log(`📤 Enviado para ${entrega.cliente_nome} (${chatId})`);

            const chat = await msgEnviada.getChat();
            if (chat.id._serialized !== chatId) {
                mapaEntregas[chat.id._serialized] = dadosEntrega;
            }

        } catch (e) { console.error(`❌ Erro envio: ${e.message}`); }
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 3000));
    }
});

// --- ROTA 2: MENSAGEM PÓS-VENDA (FIDELIZAÇÃO) ---
app.post('/mensagem-pos-venda', async (req, res) => {
    const { telefone, nome, pedido, prazo, produtos, pdf_base64 } = req.body;

    // VALIDAÇÃO: Tentar enviar mesmo se o status interno estiver desincronizado
    // O helper enviarMensagemSegura fará a validação real
    if (connectionStatus !== 'connected') {
        console.warn(`⚠️ Tentativa de envio de pós-venda falhou: WhatsApp não está conectado (status: ${connectionStatus})`);
        return res.status(503).json({
            error: "WhatsApp não está conectado",
            status: connectionStatus,
            message: "O robô de WhatsApp não está ativo ou não está pareado."
        });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    console.log(`📤 Tentando enviar mensagem para ${nome} (${chatId})`);

    const posVendaTemplate = `Olá *{{nome}}!* 🎉
Muito obrigado por comprar na *Móveis Pedro II*.

✅ *Seu Pedido #{{pedido}} foi confirmado!*

📦 *Itens do seu pedido:*
{{produtos}}

⚠️ *IMPORTANTE:*
Por favor, **salve este número** na sua agenda. É por aqui que vamos te avisar sobre a entrega.

📅 *Prazo:* {{prazo}}
Não precisa se preocupar em ligar! Quando seu pedido já tiver uma rota pronta, entraremos em contato para te informar a data da entrega.

Qualquer dúvida, estamos à disposição! 🧡💚`;

    const posVendaMessage = await buildMessageFromSettings(
        'pos_venda',
        posVendaTemplate,
        {
            nome: nome || 'Cliente',
            pedido: pedido || '-',
            produtos: produtos || 'Consulte sua nota de pedido',
            prazo: prazo ? (prazo.toLowerCase().includes('dia') ? prazo : `${prazo} úteis`) : 'A confirmar'
        }
    );

    if (!posVendaMessage.enabled) {
        return res.json({ success: true, skipped: true });
    }

    try {
        // Enviar mensagem de texto
        const msgResult = await enviarMensagemSegura(chatId, posVendaMessage.message);
        console.log(`✅ Pós-venda enviado para ${nome}:`, msgResult.success ? 'OK' : msgResult.warning || 'Falha');
        res.json({ success: true, warning: msgResult.warning });
    } catch (e) {
        console.error("❌ Erro ao enviar zap:", e.message);
        console.error("Stack:", e.stack);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 3: INÍCIO DE ROTA (LOGÍSTICA) ---
app.post('/aviso-inicio-rota', async (req, res) => {
    const { entregas } = req.body;

    console.log(`🚚 Iniciando rota com ${entregas.length} entregas`);
    res.json({ success: true }); // Responde rápido para liberar o front

    const baseUrl = getTrackingBaseUrl();

    for (const entrega of entregas) {
        if (!entrega.cliente_telefone) continue;

        let tel = entrega.cliente_telefone.replace(/\D/g, '');
        if (tel.length < 12) tel = '55' + tel;
        const chatId = `${tel}@c.us`;

        // Gerar token de rastreio
        const trackingToken = createTrackingToken({
            entrega_id: entrega.id,
            numero_pedido: entrega.numero_pedido
        });
        const linkRastreio = `${baseUrl}/rastreio?token=${encodeURIComponent(trackingToken)}`;

        const inicioRotaTemplate = `Bom dia, *{{nome}}*! 🚚

O caminhão da *Móveis Pedro II* acabou de sair do depósito e iniciou a rota de entregas de hoje.

📦 Seu pedido *#{{pedido}}* está a caminho!

👇 *Acompanhe a localização ao vivo:*
{{localizacao}}

Por favor, mantenha alguém no local para receber.

Até breve!`;

        const inicioRotaMessage = await buildMessageFromSettings(
            'inicio_rota',
            inicioRotaTemplate,
            {
                nome: entrega.cliente_nome || 'Cliente',
                pedido: entrega.numero_pedido || '-',
                localizacao: linkRastreio
            }
        );

        if (!inicioRotaMessage.enabled) {
            continue;
        }

        try {
            await client.sendMessage(chatId, inicioRotaMessage.message);
            await new Promise(r => setTimeout(r, 3000)); // Delay de 3s entre msgs
        } catch (e) {
            console.error(`Erro ao enviar para ${entrega.cliente_nome}`);
        }
    }
});

// --- ROTA API: VALIDAR TOKEN DE RASTREIO PÚBLICO ---
app.get('/api/tracking/validate', async (req, res) => {
    const token = req.query.token;

    if (!token) {
        return res.status(400).json({ error: 'token ausente' });
    }

    try {
        const payload = verifyTrackingToken(token);
        const entregaId = payload.entrega_id;

        if (!entregaId) {
            return res.status(400).json({ error: 'token inválido' });
        }

        const { data: entrega, error: entregaError } = await supabase
            .from('entregas')
            .select('*')
            .eq('id', entregaId)
            .single();

        if (entregaError || !entrega) {
            return res.status(404).json({ error: 'entrega não encontrada' });
        }

        const statusAtual = (entrega.status || '').toString().trim().toLowerCase();
        if (STATUS_ENTREGA_FINALIZADOS.has(statusAtual)) {
            return res.status(403).json({ error: 'rastreamento indisponível para entrega finalizada' });
        }

        if (!STATUS_ENTREGA_ATIVOS.has(statusAtual)) {
            return res.status(403).json({ error: 'rastreamento disponível apenas quando o pedido é o próximo da rota' });
        }

        if (!entrega.caminhao_id) {
            return res.status(403).json({ error: 'entrega sem caminhão ativo' });
        }

        const { data: rotaRaw, error: rotaError } = await supabase
            .from('entregas')
            .select('id, status, ordem_rota, caminhao_id')
            .eq('caminhao_id', entrega.caminhao_id)
            .order('ordem_rota', { ascending: true });

        if (rotaError) {
            return res.status(500).json({ error: 'falha ao validar sequência da rota' });
        }

        const filaAtiva = (rotaRaw || []).filter((item) => {
            const st = (item.status || '').toString().trim().toLowerCase();
            return STATUS_ENTREGA_FILA.has(st);
        });

        const proxima = filaAtiva[0];
        if (!proxima || String(proxima.id) !== String(entrega.id)) {
            return res.status(403).json({ error: 'token não autorizado para a parada atual' });
        }

        const { data: caminhao } = await supabase
            .from('caminhoes')
            .select('latitude, longitude, ultima_atualizacao')
            .eq('id', entrega.caminhao_id)
            .single();

        const sanitized = {
            id: entrega.id,
            numero_pedido: entrega.numero_pedido,
            cliente_nome: entrega.cliente_nome,
            cliente_telefone: entrega.cliente_telefone,
            endereco_entrega: entrega.endereco_entrega,
            status: entrega.status,
            data_agendada: entrega.data_agendada,
            turno: entrega.turno,
            caminhao_id: entrega.caminhao_id,
            ordem_rota: entrega.ordem_rota,
            data_realizada: entrega.data_realizada
        };

        return res.json({
            ok: true,
            entrega: sanitized,
            paradasNaFrente: 0,
            localizacaoMotorista: caminhao?.latitude && caminhao?.longitude ? {
                lat: caminhao.latitude,
                lng: caminhao.longitude,
                ultima_atualizacao: caminhao.ultima_atualizacao || null
            } : null,
            expiresAt: payload.exp
        });
    } catch (error) {
        return res.status(401).json({ error: error.message || 'token inválido' });
    }
});

// --- ROTA 4: PRÓXIMA PARADA (RASTREAMENTO) ---
app.post('/aviso-proxima-parada', async (req, res) => {
    const { id, telefone, nome } = req.body;

    if (!id || !telefone) {
        return res.status(400).json({ error: "id da entrega e telefone são obrigatórios" });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    const { data: entregaDb, error: entregaError } = await supabase
        .from('entregas')
        .select('id, numero_pedido, status')
        .eq('id', id).eq('organization_id', req.auth.organizationId)
        .single();

    if (entregaError || !entregaDb) {
        return res.status(404).json({ error: 'Entrega não encontrada' });
    }

    if ((entregaDb.status || '').toLowerCase() !== 'próxima parada') {
        await supabase
            .from('entregas')
            .update({ status: 'Próxima parada' })
            .eq('id', id).eq('organization_id', req.auth.organizationId);
    }

    // URL da Landing Page (ajuste se o domínio for diferente)
    const baseUrl = getTrackingBaseUrl();
    const trackingToken = createTrackingToken({
        entrega_id: entregaDb.id,
        numero_pedido: entregaDb.numero_pedido
    });
    const linkRastreio = `${baseUrl}/rastreio?token=${encodeURIComponent(trackingToken)}`;

    const proximaParadaTemplate = `*Móveis Pedro II Informa:* 📍

Olá *{{nome}}*! O motorista finalizou a entrega anterior e **você é a próxima parada!**

Prepare-se para receber seus móveis em breve.

👇 *Acompanhe a localização do caminhão ao vivo:*
{{localizacao}}`;

    const proximaParadaMessage = await buildMessageFromSettings(
        'proxima_parada',
        proximaParadaTemplate,
        {
            nome: nome || 'Cliente',
            localizacao: linkRastreio
        }
    );

    try {
        if (!proximaParadaMessage.enabled) {
            return res.json({ success: true, link: linkRastreio, skipped: true });
        }

        await enviarMensagemSegura(chatId, proximaParadaMessage.message);
        res.json({ success: true, link: linkRastreio });
    } catch (e) {
        console.error("Erro ao enviar aviso de próxima parada:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 5: REAGENDAMENTO DE ENTREGAS ---
app.post('/reagendar-entregas', async (req, res) => {
    const { entregas } = req.body;

    console.log(`📅 Reagendando ${entregas?.length || 0} entregas`);
    res.json({ success: true });

    for (const entrega of (entregas || [])) {
        if (!entrega.telefone) continue;

        let tel = entrega.telefone.replace(/\D/g, '');
        if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
        const chatId = `${tel}@c.us`;

        const reagendamentoTemplate = `Olá *{{nome}}*! 😔

Pedimos desculpas, mas *ocorreu um imprevisto* e precisaremos reagendar a sua entrega.

📦 Pedido: *#{{pedido}}*

Fique tranquilo(a)! O reagendamento será feito dentro do prazo original do seu pedido.

Nossa equipe entrará em contato em breve para confirmar a nova data da entrega.

Pedimos desculpas pelo inconveniente. 🙏
*Móveis Pedro II*`;

        const reagendamentoMessage = await buildMessageFromSettings(
            'reagendamento',
            reagendamentoTemplate,
            {
                nome: entrega.nome || 'Cliente',
                pedido: entrega.numero_pedido || '-'
            }
        );

        if (!reagendamentoMessage.enabled) {
            continue;
        }

        try {
            await client.sendMessage(chatId, reagendamentoMessage.message);
            console.log(`📅 Reagendamento enviado para ${entrega.nome}`);
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) {
            console.error(`Erro ao enviar reagendamento para ${entrega.nome}`);
        }
    }
});

// --- ROTA 6: ENTREGA NÃO REALIZADA (FALHA) ---
app.post('/entrega-nao-realizada', async (req, res) => {
    const { telefone, nome, numero_pedido, motivo } = req.body;

    if (!telefone) {
        return res.status(400).json({ error: "telefone é obrigatório" });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    const entregaFalhaTemplate = `Olá *{{nome}}*! 😔

Nossos entregadores estiveram no endereço hoje, mas *não conseguimos realizar a entrega* do seu pedido *#{{pedido}}*.

📝 Motivo: {{motivo}}

O pedido está retornando ao nosso depósito e faremos uma *nova tentativa de entrega em breve*.

Nossa equipe entrará em contato para reagendar uma data conveniente para você.

Caso tenha alguma dúvida, responda esta mensagem!

*Móveis Pedro II* 🧡💚`;

    const entregaFalhaMessage = await buildMessageFromSettings(
        'entrega_falha',
        entregaFalhaTemplate,
        {
            nome: nome || 'Cliente',
            pedido: numero_pedido || '-',
            motivo: motivo || 'Não informado'
        }
    );

    if (!entregaFalhaMessage.enabled) {
        return res.json({ success: true, skipped: true });
    }

    try {
        await client.sendMessage(chatId, entregaFalhaMessage.message);
        console.log(`❌ Aviso de falha enviado para ${nome}`);
        res.json({ success: true });
    } catch (e) {
        console.error(`Erro ao enviar falha para ${nome}`);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 7: MENSAGEM DE MARKETING (RECUPERAÇÃO DE ORÇAMENTOS) ---
app.post('/enviar-mensagem-marketing', async (req, res) => {
    const { telefone, nome, tipo, dados_extras } = req.body;

    if (!telefone || !nome || !tipo) {
        return res.status(400).json({ error: "telefone, nome e tipo são obrigatórios" });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    let mensagem = "";

    if (tipo === "recuperacao") {
        // Mensagem de recuperação de orçamento
        const valor = dados_extras?.valor ?
            parseFloat(dados_extras.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) :
            "em aberto";

        mensagem =
            `Olá *${nome}*!
Aqui é da *Móveis Pedro II*.

Vi que você fez um orçamento conosco de *${valor}* e ainda não fechou. 📋

🎯 Conseguimos manter as condições especiais se você fechar até hoje!

Posso te ajudar a finalizar a compra? 
Estou à disposição para tirar qualquer dúvida! 😊`;

    } else {
        return res.status(400).json({ error: "Tipo de mensagem inválido. Use: recuperacao" });
    }

    try {
        await client.sendMessage(chatId, mensagem);
        console.log(`📣 Marketing (${tipo}) enviado para ${nome}`);
        res.json({ success: true, tipo, nome });
    } catch (e) {
        console.error("Erro zap marketing:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 6: MENSAGEM DE ANIVERSÁRIO AUTOMÁTICA (NOVA!) ---
app.post('/enviar-mensagem-aniversario', async (req, res) => {
    const { telefone, nome, cupom_codigo, lojas } = req.body;

    if (!telefone || !nome || !cupom_codigo) {
        return res.status(400).json({ error: "telefone, nome e cupom_codigo são obrigatórios" });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    // Formatar endereços das lojas
    let enderecos = '';
    if (lojas && lojas.length > 0) {
        enderecos = '\n *Venha nos visitar:*\n\n';
        lojas.forEach(loja => {
            const endereco = `${loja.endereco || ''}${loja.numero ? ', ' + loja.numero : ''}${loja.bairro ? ' - ' + loja.bairro : ''}`;
            const cidadeEstado = `${loja.cidade || ''}${loja.estado ? '/' + loja.estado : ''}`;
            enderecos += `📍 *${loja.nome}*\n${endereco}\n${cidadeEstado}\n`;
        });
    }

    const mensagem =
        `Olá *${nome}*! 🎂🎉

A equipe da *Móveis Pedro II* deseja um FELIZ ANIVERSÁRIO!

Para celebrar seu dia especial, preparamos um presente exclusivo:
💜 *10% de desconto* na sua próxima compra!

🎁 Use o cupom: *${cupom_codigo}*
_⚠️ Apresente este cupom no balcão da loja junto com uma documentação sua!_
_✨ Válido por 30 dias_
${enderecos}
Um grande abraço! 🧡💚`;

    try {
        await client.sendMessage(chatId, mensagem);
        console.log(`🎂 Aniversário enviado para ${nome} (${cupom_codigo})`);
        res.json({ success: true, nome, cupom: cupom_codigo });
    } catch (e) {
        console.error("Erro zap aniversário:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 8: AVISO DE MONTAGEM AGENDADA (COM CONTATO DO MONTADOR) ---
app.post('/aviso-montagem-agendada', async (req, res) => {
    const { telefone, cliente_nome, numero_pedido, produto_nome, data_formatada, turno, montador_nome, montador_telefone } = req.body;

    if (!telefone || !cliente_nome) {
        return res.status(400).json({ error: "telefone e cliente_nome são obrigatórios" });
    }

    // Se WhatsApp desconectado, retorna 503 para o frontend enfileirar localmente.
    if (connectionStatus !== 'connected') {
        return res.status(503).json({ error: 'WhatsApp desconectado', code: 'WA_OFFLINE' });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    // Formatar telefone do montador para link WhatsApp
    const telMontador = montador_telefone?.replace(/\D/g, '') || '';
    const linkMontador = telMontador ? `wa.me/55${telMontador}` : '';

    const msg =
        `Olá *${cliente_nome}*! 🛠️

Sua *montagem* do pedido *#${numero_pedido}* foi agendada!

📅 *Data:* ${data_formatada}
🕐 *Turno:* ${turno || "Horário comercial"}
📦 *Item:* ${produto_nome || "Seus móveis"}

👷 *Montador:* ${montador_nome || "Nosso montador"}
${linkMontador ? `📱 *Contato direto:* ${linkMontador}` : ''}

💡 *Precisa reagendar?*
Entre em contato diretamente com o montador pelo WhatsApp acima. Ele tem autonomia para ajustar a data e horário conforme sua disponibilidade.

⚠️ Por favor, certifique-se de que haverá alguém no local para receber.

*Móveis Pedro II* 🧡💚`;

    try {
        const result = await enviarMensagemSegura(chatId, msg);
        console.log(`🔧 Aviso de montagem agendada enviado para ${cliente_nome}`);
        res.json({ success: true, queued: !!result?.queued });
    } catch (e) {
        console.error("Erro ao enviar aviso de montagem:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 8C: AVISO DE MONTAGEM CANCELADA ---
app.post('/aviso-montagem-cancelada', async (req, res) => {
    const { telefone, cliente_nome, numero_pedido, produto_nome } = req.body;

    if (!telefone || !cliente_nome) {
        return res.status(400).json({ error: "telefone e cliente_nome são obrigatórios" });
    }

    if (connectionStatus !== 'connected') {
        return res.status(503).json({ error: 'WhatsApp desconectado', code: 'WA_OFFLINE' });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    const msg =
        `Olá *${cliente_nome}*!\n\n` +
        `A montagem do pedido *#${numero_pedido || '-'}*` +
        `${produto_nome ? ` (${produto_nome})` : ''} foi cancelada e retornou para a triagem.\n\n` +
        `Em breve nossa equipe vai te contatar para definir uma nova data.\n\n` +
        `*Móveis Pedro II* 🧡💚`;

    try {
        const result = await enviarMensagemSegura(chatId, msg);
        res.json({ success: true, queued: !!result?.queued });
    } catch (e) {
        console.error("Erro ao enviar aviso de cancelamento de montagem:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 8D: AVISO DE MONTAGEM REAGENDADA ---
app.post('/aviso-montagem-reagendada', async (req, res) => {
    const { telefone, cliente_nome, numero_pedido, produto_nome, data_formatada, turno, montador_nome } = req.body;

    if (!telefone || !cliente_nome) {
        return res.status(400).json({ error: "telefone e cliente_nome são obrigatórios" });
    }

    if (connectionStatus !== 'connected') {
        return res.status(503).json({ error: 'WhatsApp desconectado', code: 'WA_OFFLINE' });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    const msg =
        `Olá *${cliente_nome}*! 📅\n\n` +
        `Sua montagem do pedido *#${numero_pedido || '-'}* foi reagendada.\n\n` +
        `📦 *Item:* ${produto_nome || 'Seus móveis'}\n` +
        `📅 *Nova data:* ${data_formatada || 'A confirmar'}\n` +
        `🕐 *Turno:* ${turno || 'Horário comercial'}\n` +
        `${montador_nome ? `👷 *Montador:* ${montador_nome}\n` : ''}\n` +
        `Se precisar ajustar novamente, responda esta mensagem ou fale com nossa equipe.\n\n` +
        `*Móveis Pedro II* 🧡💚`;

    try {
        const result = await enviarMensagemSegura(chatId, msg);
        res.json({ success: true, queued: !!result?.queued });
    } catch (e) {
        console.error("Erro ao enviar aviso de reagendamento de montagem:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 8B: CONFIRMAR MONTAGEM (LEGADO - MANTIDO POR COMPATIBILIDADE) ---
app.post('/confirmar-montagem', async (req, res) => {
    const { telefone, nome, data, horario, montador_nome } = req.body;

    if (!telefone || !nome) {
        return res.status(400).json({ error: "telefone e nome são obrigatórios" });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    // Formatar data
    let dataFormatada = "em breve";
    if (data) {
        const dataObj = new Date(data);
        const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const diaSemana = diasSemana[dataObj.getDay()];
        const dia = dataObj.getDate().toString().padStart(2, '0');
        const mes = (dataObj.getMonth() + 1).toString().padStart(2, '0');
        dataFormatada = `${diaSemana}, ${dia}/${mes}`;
    }

    const msg =
        `Olá *${nome}*! 🔧

Sua *montagem* foi confirmada!

📅 Data: *${dataFormatada}*
🕐 Horário: *${horario || "A confirmar"}*
👷 Montador: *${montador_nome || "Nosso montador"}*

⚠️ Por favor, certifique-se de que haverá alguém no local para receber o montador.

Qualquer dúvida, estamos à disposição!
*Móveis Pedro II* 🧡💚`;

    try {
        await client.sendMessage(chatId, msg);
        console.log(`🔧 Confirmação de montagem enviada para ${nome}`);
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao enviar confirmação de montagem:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 9: LEMBRETE DE MONTAGEM (CRON - 8H DA MANHÃ) ---
app.post('/lembrete-montagem', async (req, res) => {
    const { telefone, nome, horario } = req.body;

    if (!telefone || !nome) {
        return res.status(400).json({ error: "telefone e nome são obrigatórios" });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    const msg =
        `Bom dia, *${nome}*! ☀️

Hoje é o dia da sua *montagem*!

🕐 Horário previsto: *${horario || "Horário comercial"}*

O montador chegará em breve. Por favor, mantenha alguém no local para receber.

Se precisar de algo, responda esta mensagem!
*Móveis Pedro II* 🧡💚`;

    try {
        await client.sendMessage(chatId, msg);
        console.log(`☀️ Lembrete de montagem enviado para ${nome}`);
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao enviar lembrete de montagem:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- ROTA 10: MONTADOR A CAMINHO ---
app.post('/montador-a-caminho', async (req, res) => {
    const { telefone, nome } = req.body;

    if (!telefone || !nome) {
        return res.status(400).json({ error: "telefone e nome são obrigatórios" });
    }

    let tel = telefone.replace(/\D/g, '');
    if (tel.length >= 10 && tel.length <= 11) tel = '55' + tel;
    const chatId = `${tel}@c.us`;

    const msg =
        `Olá *${nome}*! 🚗

O montador está *a caminho* do seu endereço!

Previsão de chegada: *em breve*

Por favor, aguarde no local indicado.

*Móveis Pedro II* 🧡💚`;

    try {
        await client.sendMessage(chatId, msg);
        console.log(`🚗 Montador a caminho notificado para ${nome}`);
        res.json({ success: true });
    } catch (e) {
        console.error("Erro ao enviar montador a caminho:", e);
        res.status(500).json({ error: e.message });
    }
});

/* 
// --- OUVINTE DE RESPOSTAS (IA) - DESATIVADO (MODO APENAS INFORMATIVO) ---
client.on('message', async msg => {
    // Lógica desativada a pedido do usuário. 
    // O bot agora funciona apenas para disparos ativos.
});
*/

// --- ROTA PROXY: DOWNLOAD DE XML NFE (EVITA CORS) ---


// Limpeza de filas antigas (24h)
setInterval(() => {
    const agora = Date.now();
    for (const [k, v] of Object.entries(filaEspera)) if (agora - v.timestamp > 86400000) delete filaEspera[k];
    for (const [k, v] of Object.entries(mapaEntregas)) if (agora - v.timestamp > 86400000) delete mapaEntregas[k];
}, 3600000);

// === SISTEMA DE ANIVERSÁRIOS AUTOMÁTICO ===
require('./cron-aniversarios');

// === SISTEMA DE LEMBRETES DE MONTAGEM ===
require('./cron-montagens');

// (O processamento de mensagens acumuladas da fila é controlado pelo usuário via interface ao conectar)


// 🏗️ CATCH-ALL MIDDLEWARE MOVED TO END


// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error("🔥 Erro não tratado:", err);
    res.status(500).json({ error: "Erro interno do servidor", details: err.message });
});

// --- ROTA 11: CONCLUIR ENTREGA E AVISAR PRÓXIMO (AUTOMÁTICO) ---
app.post('/concluir-entrega', async (req, res) => {
    const { id_concluida } = req.body;

    if (!id_concluida) {
        return res.status(400).json({ error: "ID da entrega concluída é obrigatório" });
    }

    try {
        // 0. Validar bloqueio por montagem interna pendente (por item)
        const { data: entregaAlvo, error: entregaAlvoErr } = await supabase
            .from('entregas')
            .select('id, venda_id, numero_pedido')
            .eq('id', id_concluida).eq('organization_id', req.auth.organizationId)
            .single();

        if (entregaAlvoErr || !entregaAlvo) {
            throw entregaAlvoErr || new Error('Entrega não encontrada para conclusão');
        }

        let montagemPendenteQuery = supabase
            .from('montagens_itens')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', req.auth.organizationId)
            .eq('tipo_montagem', 'interna')
            .neq('status', 'concluida');

        if (entregaAlvo.numero_pedido && entregaAlvo.venda_id) {
            montagemPendenteQuery = montagemPendenteQuery.or(`entrega_id.eq.${id_concluida},numero_pedido.eq.${entregaAlvo.numero_pedido},venda_id.eq.${entregaAlvo.venda_id}`);
        } else if (entregaAlvo.numero_pedido) {
            montagemPendenteQuery = montagemPendenteQuery.or(`entrega_id.eq.${id_concluida},numero_pedido.eq.${entregaAlvo.numero_pedido}`);
        } else if (entregaAlvo.venda_id) {
            montagemPendenteQuery = montagemPendenteQuery.or(`entrega_id.eq.${id_concluida},venda_id.eq.${entregaAlvo.venda_id}`);
        } else {
            montagemPendenteQuery = montagemPendenteQuery.eq('entrega_id', id_concluida);
        }

        const { count: pendentesCount, error: montagemPendenteErr } = await montagemPendenteQuery;

        if (montagemPendenteErr) throw montagemPendenteErr;

        if ((pendentesCount || 0) > 0) {
            return res.status(409).json({
                error: 'Montagem pendente',
                message: 'Entregas com item de montagem interna pendente não podem ser concluídas.'
            });
        }

        // 1. Marcar a atual como entregue no Supabase salvando os dados do front
        const updatePayload = {
            status: 'Entregue',
            data_realizada: new Date().toISOString(),
            ...Object.fromEntries(Object.entries(req.body.update_data || {}).filter(([key]) => ['fotos_entrega','foto_entrega_url','assinatura_url','latitude','longitude','observacoes_entrega'].includes(key))) // Inclui fotos, assinatura, geolocalização
        };

        const { data: entregaAtual, error: err1 } = await supabase
            .from('entregas')
            .update(updatePayload)
            .eq('id', id_concluida).eq('organization_id', req.auth.organizationId)
            .select('caminhao_id, ordem_rota, cliente_nome, cliente_telefone, numero_pedido')
            .single();

        if (err1) throw err1;

        res.json({ success: true, message: "Entrega concluída. Próximo cliente será avisado em 5 min." });

        if (entregaAtual?.cliente_telefone) {
            try {
                const telConcluida = entregaAtual.cliente_telefone.replace(/\D/g, '');
                const chatIdConcluida = (telConcluida.length <= 11 ? '55' : '') + telConcluida + '@c.us';

                const agradecimentoTemplate = `Olá *{{nome}}*! 😊

Confirmamos que a entrega do seu pedido *#{{pedido}}* foi concluída com sucesso.

Muito obrigado por escolher a *Móveis Pedro II*! 💚

Se precisar de qualquer suporte no pós-entrega, é só responder esta mensagem.

Aproveite seus móveis! ✨`;

                const agradecimentoMessage = await buildMessageFromSettings(
                    'entrega_agradecimento',
                    agradecimentoTemplate,
                    {
                        nome: entregaAtual.cliente_nome || 'Cliente',
                        pedido: entregaAtual.numero_pedido || '-'
                    }
                );

                if (agradecimentoMessage.enabled) {
                    await enviarMensagemSegura(chatIdConcluida, agradecimentoMessage.message);
                    console.log(`✅ Mensagem de agradecimento enviada: ${entregaAtual.cliente_nome}`);
                }
            } catch (thankErr) {
                console.error('❌ Erro ao enviar mensagem de agradecimento:', thankErr.message);
            }
        }

        // 2. Aguardar 5 minutos (Temporizador solicitado)
        console.log(`⏳ Aguardando 5 minutos para avisar o próximo cliente após entrega ${id_concluida}...`);

        setTimeout(async () => {
            try {
                // 3. Buscar entregas candidatas da mesma rota/veiculo
                const { data: candidatas, error: err2 } = await supabase
                    .from('entregas')
                    .select('*')
                    .eq('caminhao_id', entregaAtual.caminhao_id).eq('organization_id', req.auth.organizationId)
                    .gt('ordem_rota', entregaAtual.ordem_rota)
                    .order('ordem_rota', { ascending: true })
                    .limit(20);

                const statusElegiveis = new Set(['pendente', 'proxima parada', 'próxima parada', 'a caminho', 'em rota']);
                const proximaEntrega = (candidatas || []).find((item) => {
                    const status = (item.status || '').toString().trim().toLowerCase();
                    return statusElegiveis.has(status);
                });

                if (err2 || !proximaEntrega) {
                    console.log("🏁 Fim da rota ou nenhum próximo cliente encontrado.");
                    return;
                }

                // 4. Atualizar status da próxima para "Próxima parada"
                await supabase
                    .from('entregas')
                    .update({ status: 'Próxima parada' })
                    .eq('id', proximaEntrega.id).eq('organization_id', req.auth.organizationId);

                // 5. Disparar o aviso via Rota 4 (Internamente)
                const baseUrl = getTrackingBaseUrl();
                const trackingToken = createTrackingToken({
                    entrega_id: proximaEntrega.id,
                    numero_pedido: proximaEntrega.numero_pedido
                });
                const linkRastreio = `${baseUrl}/rastreio?token=${encodeURIComponent(trackingToken)}`;
                const tel = proximaEntrega.cliente_telefone.replace(/\D/g, '');
                const chatId = (tel.length <= 11 ? '55' : '') + tel + '@c.us';

                const proximaParadaTemplate = `*Móveis Pedro II Informa:* 📍

Olá *{{nome}}*! O motorista finalizou a entrega anterior e **você é a próxima parada!**

Prepare-se para receber seus móveis em breve.

👇 *Acompanhe a localização do caminhão ao vivo:*
{{localizacao}}`;

                const proximaParadaMessage = await buildMessageFromSettings(
                    'proxima_parada',
                    proximaParadaTemplate,
                    {
                        nome: proximaEntrega.cliente_nome || 'Cliente',
                        localizacao: linkRastreio
                    }
                );

                if (!proximaParadaMessage.enabled) {
                    console.log('ℹ️ Mensagem de próxima parada desativada nas configurações.');
                    return;
                }

                await enviarMensagemSegura(chatId, proximaParadaMessage.message);
                console.log(`✅ Próximo cliente avisado automaticamente: ${proximaEntrega.cliente_nome}`);

            } catch (autoErr) {
                console.error("❌ Erro no automatismo de próxima parada:", autoErr.message);
            }
        }, 300000); // 5 minutos

    } catch (e) {
        console.error("Erro ao concluir entrega:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// 🏗️ CATCH-ALL MIDDLEWARE (React Router)
// Return index.html for any unknown route so React handles routing
// MOVED TO END: Must be after all API routes to avoid intercepting them
app.use((req, res, next) => {
    // Skip API routes - let them fall through to 404 handler
    if (req.path.startsWith('/whatsapp') || req.path.startsWith('/buscar') || req.path.startsWith('/enviar') || req.path.startsWith('/api')) {
        return next();
    }
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        next();
    }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(PORT, async () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Link local: http://localhost:${PORT}`);

    // 🤖 Inicializar sessões ativas de WhatsApp para todos os tenants
    await whatsappManager.initActiveTenants();
});
