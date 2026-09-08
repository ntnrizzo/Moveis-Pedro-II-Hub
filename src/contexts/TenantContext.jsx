import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// Contexto para dados do tenant (organização)
const TenantContext = createContext(null);

// Configurações padrão (fallback)
const DEFAULT_ORGANIZATION = {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Sistema ERP',
    slug: 'default',
    logo_url: null,
    primary_color: '#07593f',
    secondary_color: '#f38a4c',
};

const DEFAULT_SETTINGS = {
    prazo_entrega_padrao: 7,
    prazo_montagem_padrao: 3,
    taxa_juros_parcelamento: {
        "2x": 0, "3x": 0, "4x": 2.5, "5x": 3, "6x": 3.5,
        "7x": 4, "8x": 4.5, "9x": 5, "10x": 5.5, "11x": 6, "12x": 6.5
    },
    comissao_base_percentual: 3.00,
    comissao_sobre: 'bruto',
    comissao_prioridade_estrategia: 'mais_especifica',
    comissao_recalculo_politica: 'nao_recalcular',
    comissao_modelo_calculo: 'regra_venda',
    comissao_faixa_referencia: 'vendedor',
    comissao_meta_minima_loja_percentual: 0,
    compras_aprovacao_automatica: ['a_vista'],
    conferencia_caixa_enabled: false,
    modulos_ativos: {
        montagem: true,
        assistencia_tecnica: true,
        nfe: true,
        marketing: true,
        rh: true,
        bi_dashboard: true,
        catalogo_whatsapp: true,
        rastreio: true,
        frota: true,
        fotos_entrega: true,
        comissoes: true,
        conferencia_caixa: true,
        markup_automatico: true,
        aprovacao_vendas: true,
        whatsapp: true
    }
};

export function TenantProvider({ children, organizationId, slug: slugProp }) {
    const [organization, setOrganization] = useState(null);
    const [settings, setSettings] = useState(null);
    const [plano, setPlano] = useState(null);
    const [lojas, setLojas] = useState([]);
    const [loading, setLoading] = useState(true);

    const dataVersion = useRef(0);
    const [error, setError] = useState(null);
    const [resolvedOrgId, setResolvedOrgId] = useState(organizationId || null);
    const [isDomainResolved, setIsDomainResolved] = useState(false);

    useEffect(() => {
        let version = 0;
        let disposed = false;
        const detect = async () => {
            if (disposed) return;
            const request = ++version;
            const current = () => !disposed && request === version;
            dataVersion.current++;
            setResolvedOrgId(null);
            setOrganization(null);
            setSettings(null);
            setPlano(null);
            setLojas([]);
            setLoading(true);
            setError(null);
            localStorage.removeItem('current_organization_id');
            try {
                let id = organizationId || null;
                let byDomain = false;
                const hostname = window.location.hostname.toLowerCase();
                const mainDomains = ['localhost', 'gesthub.com', 'gestapp.com.br'];
                if (slugProp) {
                    const { data, error } = await supabase.from('organizations').select('id').eq('slug', slugProp).single();
                    if (error || !data) throw new Error('Organização não encontrada');
                    id = data.id;
                } else if (!mainDomains.includes(hostname) && !hostname.endsWith('.vercel.app')) {
                    const { data, error } = await supabase.from('organizations').select('id').eq('custom_domain', hostname).maybeSingle();
                    if (error) throw error;
                    if (data) { id = data.id; byDomain = true; }
                    else if (hostname.endsWith('.gesthub.com')) {
                        const { data: sub, error: subError } = await supabase.from('organizations').select('id').eq('slug', hostname.split('.')[0]).single();
                        if (subError || !sub) throw new Error('Organização não encontrada');
                        id = sub.id; byDomain = true;
                    }
                }
                if (!id) {
                    const { data: { session }, error } = await supabase.auth.getSession();
                    if (error) throw error;
                    if (session?.user) {
                        const { data: profile, error: profileError } = await supabase.from('public_users')
                            .select('organization_id, ativo').eq('id', session.user.id).single();
                        if (profileError || !profile?.ativo || !profile.organization_id) throw new Error('Perfil sem organização ativa');
                        id = profile.organization_id;
                    }
                }
                if (!current()) return;
                setResolvedOrgId(id);
                setIsDomainResolved(byDomain);
                if (!id) setLoading(false);
            } catch (err) {
                if (current()) { setError(err); setLoading(false); }
            }
        };
        detect();
        // Defer auth work until Supabase releases its auth callback lock.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => { if (event !== 'TOKEN_REFRESHED') queueMicrotask(detect); });
        return () => { disposed = true; version++; dataVersion.current++; subscription.unsubscribe(); };
    }, [organizationId, slugProp]);

    useEffect(() => {
        if (resolvedOrgId) loadTenantData();
        return () => { dataVersion.current++; };
    }, [resolvedOrgId]);

    useEffect(() => {
        if (organization) {
            // Se estiver na rota de operador, ignorar títulos e favicons do tenant
            if (window.location.pathname.startsWith('/operador')) {
                return;
            }

            const orgName = organization.name || '';
            const isDefaultOrg = orgName.toLowerCase().includes('pedro ii');
            
            document.title = orgName && !isDefaultOrg
                ? `${orgName} - GestApp` 
                : 'GestApp';

            // Remove favicons antigos se existirem para evitar duplicidade
            const existingLinks = document.querySelectorAll("link[rel~='icon']");
            existingLinks.forEach(link => link.remove());

            // Cria o novo favicon do tenant (se for org padrão, usa o favicon.svg do GestApp)
            if (!isDefaultOrg && organization.logo_url && !organization.logo_url.includes('mp2logo.png')) {
                const logoUrl = `${organization.logo_url}?v=${new Date().getTime()}`;
                const link = document.createElement('link');
                link.rel = 'icon';
                link.type = 'image/png';
                link.href = logoUrl;
                document.getElementsByTagName('head')[0].appendChild(link);
            } else {
                const link = document.createElement('link');
                link.rel = 'icon';
                link.type = 'image/svg+xml';
                link.href = '/favicon.svg?v=2';
                document.getElementsByTagName('head')[0].appendChild(link);
            }
        }
    }, [organization]);

    const loadTenantData = async () => {
        const version = ++dataVersion.current;
        const current = () => version === dataVersion.current;
        if (!resolvedOrgId) return;
        setLoading(true);
        setError(null);
        try {
            const results = await Promise.all([
                supabase.from('organizations').select('*').eq('id', resolvedOrgId).single(),
                supabase.from('organization_settings').select('*').eq('organization_id', resolvedOrgId).single(),
                supabase.from('lojas').select('*').eq('organization_id', resolvedOrgId).eq('is_active', true).order('nome'),
            ]);
            for (const result of results) if (result.error) throw result.error;
            const [org, config, stores] = results;
            const plan = org.data.plano_id ? await supabase.from('planos').select('*').eq('id', org.data.plano_id).single() : { data: null };
            if (plan.error) throw plan.error;
            if (!current()) return;
            setOrganization(org.data);
            setSettings(config.data);
            setLojas(stores.data || []);
            setPlano(plan.data);
            localStorage.setItem('current_organization_id', org.data.id);
        } catch (err) {
            if (!current()) return;
            setError(err);
            setOrganization(null);
            setSettings(null);
            setPlano(null);
            setLojas([]);
            localStorage.removeItem('current_organization_id');
        } finally {
            if (current()) setLoading(false);
        }
    };

    // Verificar se um módulo é permitido pelo plano de assinatura da empresa
    const isModuleAllowedByPlan = (moduleName) => {
        if (!plano || !plano.recursos) return true; // sem plano específico ou recursos = liberado
        if (Object.prototype.hasOwnProperty.call(plano.recursos, moduleName)) {
            return plano.recursos[moduleName] !== false;
        }
        return true;
    };

    // Verificar se um módulo está ativo (considerando trava do plano E opção da empresa)
    const isModuleActive = (moduleName) => {
        if (!isModuleAllowedByPlan(moduleName)) return false;
        if (!settings?.modulos_ativos) return true;
        return settings.modulos_ativos[moduleName] !== false;
    };


    // Verificar se um módulo PAGO está ativo (padrão: DESATIVADO se ausente)
    // Usar esta função para módulos que geram custo real: 'whatsapp', 'fotos_entrega'
    // Diferença do isModuleActive: chave ausente = bloqueado (fail-safe)
    const isPaidModuleActive = (moduleName) => {
        if (!settings?.modulos_ativos) return false; // sem settings = desativado
        return settings.modulos_ativos[moduleName] === true;
    };

    // Obter taxa de juros para parcelas
    const getJurosParcela = (parcelas) => {
        if (!settings?.taxa_juros_parcelamento) return 0;
        return settings.taxa_juros_parcelamento[`${parcelas}x`] || 0;
    };

    const value = {
        organization,
        settings,
        plano,
        lojas,
        loading,
        error,
        isModuleActive,
        isModuleAllowedByPlan,
        isPaidModuleActive,
        getJurosParcela,
        isDomainResolved,
        refreshTenant: loadTenantData,

        // Flag de Conferência de Caixa
        conferenciaCaixaEnabled: settings?.conferencia_caixa_enabled === true,
        // Helpers para branding
        brandName: organization?.name || DEFAULT_ORGANIZATION.name,
        brandLogo: organization?.logo_url || DEFAULT_ORGANIZATION.logo_url,
        primaryColor: organization?.primary_color || DEFAULT_ORGANIZATION.primary_color,
        secondaryColor: organization?.secondary_color || DEFAULT_ORGANIZATION.secondary_color,
    };

    return (
        <TenantContext.Provider value={value}>
            {children}
        </TenantContext.Provider>
    );
}

// Hook para usar o contexto do tenant
export function useTenant() {
    const context = useContext(TenantContext);
    if (!context) {
        console.warn('useTenant deve ser usado dentro de um TenantProvider');
        // Retornar valores padrão para evitar quebrar o app
        return {
            organization: DEFAULT_ORGANIZATION,
            settings: DEFAULT_SETTINGS,
            lojas: [],
            loading: false,
            error: null,
            isModuleActive: () => true,
            isPaidModuleActive: () => false, // Fail-safe: sem contexto = desativado
            getJurosParcela: () => 0,
            refreshTenant: () => { },
            conferenciaCaixaEnabled: false,
            brandName: DEFAULT_ORGANIZATION.name,
            brandLogo: DEFAULT_ORGANIZATION.logo_url,
            primaryColor: DEFAULT_ORGANIZATION.primary_color,
            secondaryColor: DEFAULT_ORGANIZATION.secondary_color,
        };
    }
    return context;
}

// Hook específico para organização
export function useOrganization() {
    const { organization, loading, error } = useTenant();
    return { organization, loading, error };
}

// Hook específico para configurações
export function useOrganizationSettings() {
    const { settings, loading, error, isModuleActive, isPaidModuleActive, getJurosParcela } = useTenant();
    return { settings, loading, error, isModuleActive, isPaidModuleActive, getJurosParcela };
}

// Hook específico para lojas
export function useLojas() {
    const { lojas, loading, error } = useTenant();
    return { lojas, loading, error };
}

export default TenantContext;
