import { lazy, Suspense, useEffect } from 'react';
import Layout from "./Layout.jsx";
import LoginFuncionario from "./LoginFuncionario.jsx";

// ============================================================================
// LAZY LOADING - Páginas Admin (carregadas sob demanda para melhor performance)
// ============================================================================
const Dashboard = lazy(() => import("./Dashboard.jsx"));
const Produtos = lazy(() => import("./Produtos.jsx"));
const Clientes = lazy(() => import("./Clientes.jsx"));
const CRM = lazy(() => import("./CRM.jsx"));
const Vendas = lazy(() => import("./Vendas.jsx"));
const Devolucoes = lazy(() => import("./Devolucoes.jsx"));

const Orcamentos = lazy(() => import("./Orcamentos.jsx"));
const AssistenciaTecnica = lazy(() => import("./AssistenciaTecnica.jsx"));
const Configuracoes = lazy(() => import("./Configuracoes.jsx"));
const SelecaoVendedor = lazy(() => import("./SelecaoVendedor.jsx"));
const BoasVindas = lazy(() => import("./BoasVindas.jsx"));
const GerenciamentoUsuarios = lazy(() => import("./GerenciamentoUsuarios.jsx"));
const Financeiro = lazy(() => import("./Financeiro.jsx"));
const Montagem = lazy(() => import("./Montagem.jsx"));
const Fornecedores = lazy(() => import("./Fornecedores.jsx"));
const Compras = lazy(() => import("./Compras.jsx"));
const RecursosHumanos = lazy(() => import("./RecursosHumanos.jsx"));
const TransferenciaEstoque = lazy(() => import("./TransferenciaEstoque.jsx"));
const Inventario = lazy(() => import("./Inventario.jsx"));
const Estoque = lazy(() => import("./Estoque.jsx"));
const ModoReuniao = lazy(() => import("./ModoReuniao.jsx"));
const PDV = lazy(() => import("./PDV.jsx"));
const CatalogoWhatsApp = lazy(() => import("./CatalogoWhatsApp.jsx"));
const LogisticaSemanal = lazy(() => import("./LogisticaSemanal.jsx"));
const Entregador = lazy(() => import("./Entregador.jsx"));
const Marketing = lazy(() => import("./Marketing.jsx"));
const MontadorExterno = lazy(() => import("./MontadorExterno.jsx"));
const CadastroMobile = lazy(() => import("./CadastroMobile.jsx"));
const CentralAnalitica = lazy(() => import("./CentralAnalitica.jsx"));
const DashboardGerente = lazy(() => import("./DashboardGerente.jsx"));
const AvaliacaoNPS = lazy(() => import("./AvaliacaoNPS.jsx"));
const EntradaEstoque = lazy(() => import("./EntradaEstoque.jsx"));
const PoliticasEstoque = lazy(() => import("./PoliticasEstoque.jsx"));
const AprovacaoSemEstoque = lazy(() => import("./AprovacaoSemEstoque.jsx"));
const RelatorioAcessosClientes = lazy(() => import("./RelatorioAcessosClientes.jsx"));
const PainelSaaSOperador = lazy(() => import("./PainelSaaSOperador.jsx"));
const PainelSaaSOperadorPlanos = lazy(() => import("./PainelSaaSOperadorPlanos.jsx"));
const PainelSaaSOperadorEmpresas = lazy(() => import("./PainelSaaSOperadorEmpresas.jsx"));
const OperadorLogin = lazy(() => import("./OperadorLogin.jsx"));
const OperatorLayout = lazy(() => import("./OperatorLayout.jsx"));
const CadastroEmpresa = lazy(() => import("./CadastroEmpresa.jsx"));

// ============================================================================
// CARREGAMENTO SÍNCRONO - Páginas Públicas (críticas para SEO e primeira impressão)
// ============================================================================
import LandingPage from "./LandingPage.jsx";
import LandingVIP from "./LandingVIP.jsx";
import ClienteAuth from "./cliente/ClienteAuth.jsx";
import ClienteDashboard from "./cliente/ClienteDashboard.jsx";
import AutoAtendimento from "./AutoAtendimento.jsx";
import RastreioPublico from "./RastreioPublico.jsx";
import BlockedSubscriptionScreen from "@/components/configuracoes/BlockedSubscriptionScreen.jsx";
import TenantSlugResolver from "@/components/TenantSlugResolver.jsx";

import { BrowserRouter as Router, Route, Routes, useLocation, Navigate, Link } from 'react-router-dom';
import { hasAnyRole, getUserRoles } from "@/config/permissions";
import { MENU_ITEMS } from "@/config/permissions";
import { useTenant } from "@/contexts/TenantContext";

// ============================================================================
// COMPONENTE DE LOADING - Exibido enquanto páginas lazy são carregadas
// ============================================================================
function PageLoadingFallback() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-green-100">
            <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-800 mx-auto mb-4"></div>
                <p className="text-green-800 font-medium">Carregando...</p>
            </div>
        </div>
    );
}
import { useAuth } from "@/hooks/useAuth";
import { useOperatorAuth } from "@/hooks/useOperatorAuth";
import { useFootstepsTracker } from "@/hooks/useFootstepsTracker";

function AuthTimeoutFallback({ error, onRetry }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-red-50 p-6">
            <div className="w-full max-w-xl rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
                <h1 className="text-xl font-semibold text-slate-900">Falha temporaria de autenticacao</h1>
                <p className="mt-3 text-sm text-slate-600">
                    Nao foi possivel validar sua sessao com o Supabase dentro do tempo limite.
                    O sistema interrompeu o fluxo para evitar loop de recarregamento.
                </p>
                {error?.source && (
                    <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">
                        Origem: {error.source}
                    </p>
                )}
                {error?.message && (
                    <p className="mt-3 text-sm text-slate-600">
                        {error.message}
                    </p>
                )}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                        type="button"
                        onClick={onRetry}
                        className="inline-flex items-center justify-center rounded-lg bg-[#07593f] px-4 py-2 text-sm font-medium text-white hover:bg-[#064b35]"
                    >
                        Tentar novamente
                    </button>
                    <Link
                        to="/"
                        className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Ir para inicio
                    </Link>
                </div>
            </div>
        </div>
    );
}

function OperatorAuthTimeoutFallback({ error, onRetry }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-red-50 p-6">
            <div className="w-full max-w-xl rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
                <h1 className="text-xl font-semibold text-slate-900">Falha temporaria de autenticacao do operador</h1>
                <p className="mt-3 text-sm text-slate-600">
                    Nao foi possivel validar a sessao do painel operador dentro do tempo limite.
                    O fluxo foi interrompido para evitar redirecionamentos em loop.
                </p>
                {error?.source && (
                    <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">
                        Origem: {error.source}
                    </p>
                )}
                {error?.message && (
                    <p className="mt-3 text-sm text-slate-600">
                        {error.message}
                    </p>
                )}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                        type="button"
                        onClick={onRetry}
                        className="inline-flex items-center justify-center rounded-lg bg-[#07593f] px-4 py-2 text-sm font-medium text-white hover:bg-[#064b35]"
                    >
                        Tentar novamente
                    </button>
                    <Link
                        to="/operador/login"
                        className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Ir para login do operador
                    </Link>
                </div>
            </div>
        </div>
    );
}

function OperatorRouteGate() {
    const { loading: operatorLoading, hasSession: operatorHasSession, isOperator, authError: operatorAuthError, retryAuth: retryOperatorAuth } = useOperatorAuth();

    if (operatorAuthError) {
        return <OperatorAuthTimeoutFallback error={operatorAuthError} onRetry={retryOperatorAuth} />;
    }

    if (operatorLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-800"></div>
            </div>
        );
    }

    if (!isOperator) {
        return <Navigate to={operatorHasSession ? "/login" : "/operador/login"} replace />;
    }

    return (
        <Suspense fallback={<PageLoadingFallback />}>
            <OperatorLayout>
                <Routes>
                    <Route path="/operador" element={<PainelSaaSOperador />} />
                    <Route path="/operador/empresas" element={<PainelSaaSOperadorEmpresas />} />
                    <Route path="/operador/planos" element={<PainelSaaSOperadorPlanos />} />
                    <Route path="/operador/*" element={<Navigate to="/operador" replace />} />
                </Routes>
            </OperatorLayout>
        </Suspense>
    );
}


const PAGES = {
    Dashboard, Produtos, Clientes, Vendas, Pedidos: Vendas, Devolucoes, Orcamentos, AssistenciaTecnica,
    Configuracoes, SelecaoVendedor,
    BoasVindas, GerenciamentoUsuarios, Financeiro, Montagem, Fornecedores, Compras,
    Inventario, Estoque, ModoReuniao, PDV, CatalogoWhatsApp,
    LogisticaSemanal, Entregador, Marketing, MontadorExterno,
    CentralAnalitica, DashboardGerente,
    EntradaEstoque, PoliticasEstoque, AprovacaoSemEstoque,
    PainelSaaSOperador
};

function _getCurrentPage(url) {
    if (!url) return "Dashboard";
    // Remove /admin prefix if present
    let cleanUrl = url.replace(/^\/admin/, '');
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
    let urlLastPart = cleanUrl.split('/').pop();
    if (urlLastPart.includes('?')) urlLastPart = urlLastPart.split('?')[0];
    if (!urlLastPart) return "Dashboard";

    // Normalização para encontrar o título correto (ex: logistica-semanal -> LogisticaSemanal)
    const normalizedUrl = urlLastPart.toLowerCase().replace(/-/g, '');
    const pageName = Object.keys(PAGES).find(page =>
        page.toLowerCase() === normalizedUrl
    );

    return pageName || "Dashboard";
}

const RESERVED_PATHS = [
    'login', 'cadastro', 'operador', 'vip', 'restrito', 'admin', 'home', '',
    'cliente-login', 'area-cliente', 'assistencia', 'rastreio', 'avaliacao', 'CadastroMobile'
];

const getClientRouteInfo = (pathname, isDomainResolved) => {
    const pathParts = pathname.split('/');
    
    if (isDomainResolved) {
        const subRoute = pathParts[1] || '';
        const extraSegment = pathParts[2] || '';
        const isClient = ['cliente-login', 'login', 'area-cliente', 'cliente', 'portal', 'CadastroMobile', 'avaliacao'].includes(subRoute) ||
                         (subRoute === 'assistencia' && extraSegment === 'auto') ||
                         (subRoute === 'rastreio') ||
                         !subRoute;
        
        return { 
            isClient, 
            slug: null, 
            subRoute, 
            rastreioId: subRoute === 'rastreio' ? extraSegment : null 
        };
    } else {
        const possibleSlug = pathParts[1] || '';
        if (possibleSlug && !RESERVED_PATHS.includes(possibleSlug)) {
            const subRoute = pathParts[2] || '';
            const extraSegment = pathParts[3] || '';
            const isClient = ['cliente-login', 'login', 'area-cliente', 'cliente', 'portal', 'CadastroMobile', 'avaliacao'].includes(subRoute) ||
                             (subRoute === 'assistencia' && extraSegment === 'auto') ||
                             (subRoute === 'rastreio') ||
                             !subRoute;
            
            return { 
                isClient, 
                slug: possibleSlug, 
                subRoute, 
                rastreioId: subRoute === 'rastreio' ? extraSegment : null 
            };
        }
    }
    return { isClient: false, slug: null, subRoute: null, rastreioId: null };
};

function PagesContent() {
    const location = useLocation();
    const { user, loading, can, authError, retryAuth } = useAuth();
    
    // Telemetria de Footsteps (Pegadas do Usuário)
    useFootstepsTracker(user);

    const { isModuleActive, organization, isDomainResolved } = useTenant();

    useEffect(() => {
        const isOperatorPath = location.pathname.startsWith('/operador');

        if (isOperatorPath) {
            document.title = 'GestApp - Operador SaaS';
            
            // Remove existing favicons
            const existingLinks = document.querySelectorAll("link[rel~='icon']");
            existingLinks.forEach(link => link.remove());

            // Create a generic SVG favicon (shield emoji)
            const link = document.createElement('link');
            link.rel = 'icon';
            link.type = 'image/svg+xml';
            link.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>';
            document.getElementsByTagName('head')[0].appendChild(link);
        } else if (organization) {
            // Restore tenant title and favicon
            const orgName = organization.name || '';
            const isDefaultOrg = orgName.toLowerCase().includes('pedro ii');
            
            document.title = orgName && !isDefaultOrg
                ? `${orgName} - GestApp` 
                : 'GestApp';

            const existingLinks = document.querySelectorAll("link[rel~='icon']");
            existingLinks.forEach(link => link.remove());

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
    }, [location.pathname, organization]);

    const isDefaultOrg = organization?.id === '00000000-0000-0000-0000-000000000001' || organization?.slug === 'moveis-pedro-ii';
    const isBlockedSubscription = organization && !isDefaultOrg && organization.status_assinatura !== 'ativa';
    const currentPage = _getCurrentPage(location.pathname);

    const menuFiltrado = MENU_ITEMS.filter((item) => {
        if (!can(item.permission)) return false;
        if (item.module && !isModuleActive(item.module)) return false;
        return true;
    });

    const firstAllowedAdminUrl = menuFiltrado[0]?.url || "/admin/Dashboard";

    // Mover lógica de loading para o final do "processamento de hooks"
    // ou garantir que as rotas públicas que não usam hooks extras venham depois do loading se necessário.

    const clientRouteInfo = getClientRouteInfo(location.pathname, isDomainResolved);

    const isPublicRoute =
        location.pathname === '/' ||
        location.pathname === '/home' ||
        location.pathname === '/vip' ||
        location.pathname === '/login' ||
        location.pathname === '/cliente-login' ||
        location.pathname === '/area-cliente' ||
        location.pathname === '/assistencia/auto' ||
        location.pathname === '/CadastroMobile' ||
        location.pathname.startsWith('/rastreio') ||
        location.pathname.startsWith('/avaliacao/') ||
        location.pathname === '/cadastro' ||
        location.pathname.startsWith('/operador') ||
        clientRouteInfo.isClient;

    if (loading && !isPublicRoute) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-800"></div>
            </div>
        );
    }

    if (authError && !isPublicRoute) {
        return <AuthTimeoutFallback error={authError} onRetry={retryAuth} />;
    }

    // ===== ROTAS PÚBLICAS (Antes da verificação de autenticação) =====

    // Rota pública de avaliação NPS
    if (location.pathname.startsWith('/avaliacao/')) {
        return <AvaliacaoNPS />;
    }

    // Landing Page pública (raiz do site) - SEMPRE pública
    if (location.pathname === '/' || location.pathname === '/home') {
        return <LandingPage />;
    }

    // Página VIP - Landing simples com link do grupo
    if (location.pathname === '/vip') {
        return <LandingVIP />;
    }

    // ===== ROTAS TENANT-AWARE (Subdomínio, domínio próprio ou path-based) =====
    if (clientRouteInfo.isClient) {
        const { slug, subRoute, rastreioId } = clientRouteInfo;

        return (
            <TenantSlugResolver>
                {(subRoute === 'cliente-login' || subRoute === 'login' || !subRoute) && <ClienteAuth />}
                {(subRoute === 'area-cliente' || subRoute === 'cliente' || subRoute === 'portal') && <ClienteDashboard />}
                {subRoute === 'assistencia' && <AutoAtendimento />}
                {subRoute === 'rastreio' && <RastreioPublico idProp={rastreioId} slugProp={slug} />}
                {subRoute === 'avaliacao' && <AvaliacaoNPS />}
                {subRoute === 'CadastroMobile' && <CadastroMobile />}
            </TenantSlugResolver>
        );
    }

    // Autenticação de clientes (público — fallback sem slug, usa org padrão)
    if (location.pathname === '/cliente-login') {
        return <ClienteAuth />;
    }

    // Área do cliente (requer autenticação Supabase, mas não admin — fallback sem slug)
    if (location.pathname === '/area-cliente') {
        return <ClienteDashboard />;
    }

    // Rota de cadastro pública (mobile)
    if (location.pathname === '/CadastroMobile') {
        return <CadastroMobile />;
    }

    // Autoatendimento Assistência Técnica (Público)
    if (location.pathname === '/assistencia/auto') {
        return <AutoAtendimento />;
    }

    // Rota de rastreio pública
    if (location.pathname.startsWith('/rastreio')) {
        const id = location.pathname.split('/').pop();
        return <RastreioPublico idProp={id !== 'rastreio' ? id : null} />;
    }

    // Cadastro de nova empresa (onboarding SaaS)
    if (location.pathname === '/cadastro') {
        return (
            <Suspense fallback={<PageLoadingFallback />}>
                <CadastroEmpresa />
            </Suspense>
        );
    }

    // ===== LOGIN DE FUNCIONÁRIOS =====
    if (location.pathname === '/login') {
        // Se já está logado como funcionário E tem cargo válido (qualquer cargo não vazio), redireciona
        // MAS APENAS se NÃO for primeiro acesso. Se for primeiro acesso, deixa renderizar o LoginFuncionario para trocar senha.
        if (user && getUserRoles(user).length > 0 && !user.primeiro_acesso) {
            const params = new URLSearchParams(location.search);
            const redirect = params.get('redirect');
            return <Navigate to={redirect || firstAllowedAdminUrl} replace />;
        }

        // Se está logado mas sem permissão, força logout ou mostra erro (aqui deixamos ficar no login para evitar loop)
        if (user) {
            console.warn('Usuário logado sem permissão de acesso ao admin. Permanecendo no login.');
            // Opcional: chamar logout() aqui se quiser forçar limpeza
        }

        return <LoginFuncionario />;
    }

    // ===== LOGIN DE OPERADOR (PAINEL SaaS SEPARADO) =====
    if (location.pathname === '/operador/login') {
        return (
            <Suspense fallback={<PageLoadingFallback />}>
                <OperadorLogin />
            </Suspense>
        );
    }

    // ===== ROTAS OPERADOR (SEPARADAS DO /admin) =====
    if (location.pathname.startsWith('/operador')) {
        return <OperatorRouteGate />;
    }

    // ===== ROTAS ADMIN (Requerem autenticação do sistema interno) =====
    // Qualquer rota que começa com /admin requer autenticação de funcionário
    if (location.pathname.startsWith('/admin')) {
        if (!user) {
            return <Navigate to="/login" replace />;
        }

        if (isBlockedSubscription) {
            return <BlockedSubscriptionScreen />;
        }

        // Bloquear clientes (usuários sem cargo)
        if (getUserRoles(user).length === 0) {
            console.warn('[Router] Usuário sem cargo válido tentando acessar /admin:', user.email, '- Cargos:', user.cargos || user.cargo);
            // Redirecionar para login de funcionário (não área cliente)
            return <Navigate to="/login" replace />;
        }

        // ===== RESTRICAO POR CARGO =====
        // Restrições de navegação mobile-only (Entregador, Montador, Montador Externo) só se
        // aplicam quando TODOS os cargos do usuário são mobile-only. Se o usuário tiver
        // qualquer cargo não-mobile (ex: Vendedor, Gerente), acessa o sistema completo.
        const MOBILE_ONLY_ROLES = ['Entregador', 'Montador', 'Montador Externo'];
        const userRoles = getUserRoles(user);
        const isMobileOnlyUser = userRoles.length > 0 && userRoles.every(role => MOBILE_ONLY_ROLES.includes(role));

        // Para perfis administrativos/comerciais, /admin deve abrir na primeira tela visível do menu.
        if (location.pathname === '/admin') {
            return <Navigate to={firstAllowedAdminUrl} replace />;
        }

        if (location.pathname.toLowerCase().startsWith('/admin/gerenciamentousuarios') && !can('manage_user_access')) {
            return <Navigate to={firstAllowedAdminUrl} replace />;
        }

        if (location.pathname.toLowerCase().startsWith('/admin/configuracoes') && !can('manage_user_access')) {
            return <Navigate to={firstAllowedAdminUrl} replace />;
        }

        if (location.pathname.toLowerCase().startsWith('/admin/montagem') && !can('view_montagem')) {
            return <Navigate to={firstAllowedAdminUrl} replace />;
        }

        // Montador Externo só pode acessar /admin/MontadorExterno
        if (isMobileOnlyUser && hasAnyRole(user, ['Montador Externo'])) {
            if (!location.pathname.toLowerCase().includes('montadorexterno')) {
                return <Navigate to="/admin/MontadorExterno" replace />;
            }
            return (
                <Suspense fallback={<PageLoadingFallback />}>
                    <MontadorExterno />
                </Suspense>
            );
        }

        // Entregador só pode acessar /admin/Entregador
        if (isMobileOnlyUser && hasAnyRole(user, ['Entregador'])) {
            if (!location.pathname.toLowerCase().includes('entregador')) {
                return <Navigate to="/admin/Entregador" replace />;
            }
            return (
                <Suspense fallback={<PageLoadingFallback />}>
                    <Entregador />
                </Suspense>
            );
        }

        // Logística: soft redirect para LogisticaSemanal quando não tem outros cargos de gestão
        const NON_LOGISTICS_ROLES = ['Administrador', 'Gerente', 'Gerente Geral', 'Financeiro', 'RH', 'Comprador'];
        const hasOnlyLogisticsRoles = userRoles.every(role => role === 'Logística' || MOBILE_ONLY_ROLES.includes(role));
        const hasNonLogisticsRole = userRoles.some(role => NON_LOGISTICS_ROLES.includes(role));
        if (hasAnyRole(user, ['Logística']) && hasOnlyLogisticsRoles && !hasNonLogisticsRole) {
            if (location.pathname === '/admin' || location.pathname === '/admin/Dashboard') {
                return <Navigate to="/admin/LogisticaSemanal" replace />;
            }
            // Permite outras rotas
        }

        // Se o usuário não tiver acesso ao Dashboard padrão, evita cair nele como primeira tela.
        if (location.pathname === '/admin/Dashboard' && firstAllowedAdminUrl !== '/admin/Dashboard') {
            return <Navigate to={firstAllowedAdminUrl} replace />;
        }

        // Montador Interno só pode acessar /admin/Montagem
        if (isMobileOnlyUser && hasAnyRole(user, ['Montador'])) {
            if (!location.pathname.toLowerCase().includes('montagem')) {
                return <Navigate to="/admin/Montagem" replace />;
            }
            return (
                <Suspense fallback={<PageLoadingFallback />}>
                    <Montagem />
                </Suspense>
            );
        }

        return (
            <Layout currentPageName={currentPage}>
                <Suspense fallback={<PageLoadingFallback />}>
                    <Routes>
                        <Route path="/admin" element={<Navigate to={firstAllowedAdminUrl} replace />} />

                        {/* Rotas Principais */}
                        <Route path="/admin/Dashboard" element={<Dashboard />} />
                        <Route path="/admin/PDV" element={<PDV />} />
                        <Route path="/admin/Vendas" element={<Vendas />} />
                        <Route path="/admin/Pedidos" element={<Vendas />} />
                        <Route path="/admin/Devolucoes" element={<Devolucoes />} />
                        <Route path="/admin/Orcamentos" element={<Orcamentos />} />
                        <Route path="/admin/CRM" element={<CRM />} />
                        <Route path="/admin/Clientes" element={<Navigate to="/admin/CRM" replace />} />

                        <Route path="/admin/SelecaoVendedor" element={<SelecaoVendedor />} />
                        <Route path="/admin/CatalogoWhatsApp" element={<CatalogoWhatsApp />} />

                        {/* Operacional e Logística */}
                        <Route path="/admin/Estoque" element={<Estoque />} />

                        <Route path="/admin/LogisticaSemanal" element={<LogisticaSemanal />} />
                        <Route path="/admin/Montagem" element={<Montagem />} />
                        <Route path="/admin/AssistenciaTecnica" element={<AssistenciaTecnica />} />
                        <Route path="/admin/TransferenciaEstoque" element={<TransferenciaEstoque />} />
                        <Route path="/admin/Inventario" element={<Inventario />} />
                        <Route path="/admin/Entregador" element={<Entregador />} />
                        <Route path="/admin/MontadorExterno" element={<MontadorExterno />} />
                        <Route path="/admin/Produtos" element={<Produtos />} />
                        <Route path="/admin/Fornecedores" element={<Fornecedores />} />
                        <Route path="/admin/Compras" element={<Compras />} />
                        <Route path="/admin/Entrada" element={<EntradaEstoque />} />

                        {/* Gestão e Financeiro */}
                        <Route path="/admin/Financeiro" element={<Financeiro />} />
                        <Route path="/admin/CentralAnalitica" element={<CentralAnalitica />} />
                        <Route path="/admin/RelatorioAcessosClientes" element={<Navigate to="/admin/CRM?tab=acessos" replace />} />
                        <Route path="/admin/RelatorioComissoes" element={<Navigate to="/admin/CentralAnalitica?aba=comissoes" replace />} />
                        <Route path="/admin/RelatoriosAvancados" element={<Navigate to="/admin/CentralAnalitica?aba=relatorios" replace />} />
                        <Route path="/admin/RecursosHumanos" element={<RecursosHumanos />} />
                        <Route path="/admin/Marketing" element={<Marketing />} />
                        <Route path="/admin/ExportacaoContabil" element={<Navigate to="/admin/CentralAnalitica?aba=exportacao" replace />} />
                        <Route path="/admin/DashboardBI" element={<Navigate to="/admin/CentralAnalitica?aba=bi" replace />} />
                        <Route path="/admin/DashboardGerente" element={<DashboardGerente />} />

                        {/* Estoque - Políticas e Aprovações */}
                        <Route path="/admin/PoliticasEstoque" element={<PoliticasEstoque />} />
                        <Route path="/admin/AprovacaoSemEstoque" element={<AprovacaoSemEstoque />} />

                        {/* Admin e Configurações */}
                        <Route path="/admin/GerenciamentoUsuarios" element={<GerenciamentoUsuarios />} />
                        <Route path="/admin/Configuracoes" element={<Configuracoes />} />
                        <Route path="/admin/BoasVindas" element={<BoasVindas />} />
                        <Route path="/admin/ModoReuniao" element={<ModoReuniao />} />

                        {/* Fallback para Dashboard */}
                        <Route path="/admin/*" element={<Navigate to={firstAllowedAdminUrl} replace />} />
                    </Routes>
                </Suspense>
            </Layout>
        );
    }

    // ===== FALLBACK: Redireciona rotas desconhecidas para Landing Page =====
    return <Navigate to="/" replace />;
}

export default function Pages() {
    return (
        <Router>
            <PagesContent />
        </Router>
    );
}