
import React, { useState, useEffect } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import {
  LayoutDashboard, Warehouse, Users, ShoppingCart, Truck, Building2,
  FileText, Menu, Settings, DollarSign, LogOut, RotateCcw, Plus,
  UserCog, BarChart3, Presentation, Receipt, MessageCircle, CreditCard,
  Moon, Sun, ChevronLeft, ChevronRight, Search, Bell, HelpCircle, Store, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import NotificacoesPanel from "@/components/notificacoes/NotificacoesPanel";
import BuscaGlobal from "@/components/busca/BuscaGlobal";
import NovoUsuarioModal from "@/components/usuarios/NovoUsuarioModal";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import StoreSelectorModal from "@/components/common/StoreSelectorModal";
import { MENU_ITEMS } from "@/config/permissions";
import { useAuth } from "@/hooks/useAuth";
import { useLojas } from "@/hooks/useLojas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { supabase } from "@/lib/supabase";
import { differenceInHours } from "date-fns";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { Activity, Wifi, WifiOff, MessageCircleOff } from "lucide-react";
import { hasAnyRole } from "@/config/permissions";

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading, can, logout, selectedStore, setSelectedStore } = useAuth();
  const { data: lojas = [] } = useLojas();

  // Buscar alertas/pendências para o badge do menu
  const { data: menuBadges } = useQuery({
    queryKey: ['menu-badges-compras'],
    queryFn: async () => {
      if (!user) return null;

      let count = 0;
      if (hasAnyRole(user, ['Financeiro', 'Administrador'])) {
        const { count: pendingApps } = await supabase
          .from('compras_aprovacoes')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pendente');
        count += (pendingApps || 0);
      }

      if (hasAnyRole(user, ['Estoque', 'Gerente Geral', 'Administrador'])) {
        // Não faturados ou sem resposta > 24h
        const { data: ordens } = await supabase
          .from('compras_ordens')
          .select('status, updated_at, created_at, devolutiva')
          .or('status.eq.Aguardando Envio,status.eq.Pedido Enviado')
          .is('deleted_at', null);

        const criticos = (ordens || []).filter(o => {
          if (o.status === 'Aguardando Envio') return true;
          if (o.status === 'Pedido Enviado' && !o.devolutiva) {
            const horas = differenceInHours(new Date(), new Date(o.updated_at || o.created_at));
            return horas > 24;
          }
          return false;
        });
        count += criticos.length;
      }
      return count;
    },
    enabled: !!user,
    refetchInterval: 30000 // A cada 30 segundos
  });

  // Buscar assistências pendentes para o badge do menu
  const { data: assistenciaBadges = 0 } = useQuery({
    queryKey: ['menu-badges-assistencia'],
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from('assistencias_tecnicas')
        .select('*', { count: 'exact', head: true })
        .not('status', 'in', '("Concluída", "Cancelada")');

      if (error) {
        console.error('Erro ao buscar badges de assistência:', error);
        return 0;
      }
      return count || 0;
    },
    enabled: !!user && can('view_assistencia'),
    refetchInterval: 30000
  });
  const { brandName, brandLogo, isModuleActive } = useTenant();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [novoUsuarioModalOpen, setNovoUsuarioModalOpen] = useState(false);
  const shouldMonitorWhatsApp = location.pathname === '/admin/Configuracoes' || location.pathname === '/admin/CatalogoWhatsApp';
  const { isSystemOnline, isWhatsAppConnected } = useConnectionStatus(shouldMonitorWhatsApp);

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode);
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  // Atalho Ctrl+K para abrir busca
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setBuscaAberta(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { data: alertasAtivos = [] } = useQuery({
    queryKey: ['alertas-ativos-menu'],
    queryFn: async () => {
      const alertas = await base44.entities.AlertaRecompra.list();
      return alertas.filter(a => a.status === 'Ativo');
    },
    refetchInterval: 60000,
    enabled: !!user && can('view_estoque')
  });

  if (location.pathname === "/admin/BoasVindas" || location.pathname === "/admin/ModoReuniao" || location.pathname === "/admin/Entregador" || location.pathname === "/admin/MontadorExterno") {
    return children;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-neutral-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
      </div>
    );
  }

  // Filtra menu baseado em permissões E módulos ativos do tenant
  const menuFiltrado = MENU_ITEMS.filter(item => {
    // Verifica permissão do usuário
    if (!can(item.permission)) return false;
    // Se o item tem um módulo associado, verifica se está ativo no tenant
    if (item.module && !isModuleActive(item.module)) return false;
    return true;
  });
  const sections = [...new Set(menuFiltrado.map(i => i.section))];
  const currentMenuItem = menuFiltrado.find((item) => item.url.toLowerCase() === location.pathname.toLowerCase());
  const isPedidosPage = ['/admin/pedidos', '/admin/vendas'].includes(location.pathname.toLowerCase());
  const currentPageTitle = isPedidosPage ? 'Pedidos' : (currentMenuItem?.title || brandName || 'Dashboard');
  const currentPageSubtitle = currentPageTitle === 'Dashboard'
    ? 'Visão geral da sua empresa'
    : isPedidosPage
      ? 'Gerencie e acompanhe todos os pedidos da sua empresa'
      : 'Gerencie as informações do seu módulo';

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gray-50 dark:bg-neutral-950">
        <Sidebar collapsible="icon" className="border-r border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-slate-800 dark:text-slate-200">
          <SidebarHeader className="p-3 border-b border-gray-100 dark:border-neutral-800 flex flex-col items-center bg-white dark:bg-neutral-950">
            {/* Toggle Button - always visible at top when collapsed */}
            <div className="hidden group-data-[collapsible=icon]:flex w-full justify-center mb-2">
              <SidebarTrigger className="text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-neutral-800" />
            </div>

            {/* Logo and Title Row */}
            <div className="flex items-center w-full gap-2.5 p-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
              {brandLogo ? (
                <div className="w-9 h-9 rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center justify-center overflow-hidden flex-shrink-0 p-1 shadow-sm">
                  <img src={brandLogo} alt="Logo" className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-white font-black text-xl flex-shrink-0 shadow-md">
                  G
                </div>
              )}
              <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                <h2 className="font-extrabold text-[15px] tracking-tight text-slate-900 dark:text-white truncate flex items-center gap-1">
                  <span>{brandName || 'GestApp'}</span>
                </h2>

                <div className="flex flex-col">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-medium">
                    {user?.loja ? `Loja ${user.loja}` : (selectedStore ? `Loja ${selectedStore}` : 'Todas as Lojas')}
                  </p>

                  {/* Status Indicators */}
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className="flex items-center gap-1"
                      title={isSystemOnline ? "Sistema Online" : "Sistema Offline (Sem internet)"}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${isSystemOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                        {isSystemOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <div
                      className="flex items-center gap-1"
                      title={isWhatsAppConnected ? "WhatsApp Conectado" : "WhatsApp Desconectado"}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${isWhatsAppConnected ? 'bg-orange-500' : 'bg-amber-500'}`} />
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                        WhatsApp
                      </span>
                    </div>
                  </div>

                  {!user?.loja && selectedStore && (
                    <button
                      onClick={() => setSelectedStore(null)}
                      className="text-[10px] text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 hover:underline text-left cursor-pointer mt-1 font-medium"
                    >
                      Trocar Loja
                    </button>
                  )}
                </div>
              </div>
              <SidebarTrigger className="hidden md:flex flex-shrink-0 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-neutral-800 group-data-[collapsible=icon]:hidden" />
            </div>

            {/* Search Button - full when expanded, icon-only when collapsed */}
            <div className="w-full mt-3 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
              <Button
                variant="outline"
                className="w-full justify-start text-left font-normal bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-neutral-800 group-data-[collapsible=icon]:!w-8 group-data-[collapsible=icon]:!h-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center h-9 text-[13px] rounded-md shadow-sm"
                onClick={() => setBuscaAberta(true)}
              >
                <Search className="w-4 h-4 group-data-[collapsible=icon]:mr-0 mr-2 text-slate-400 flex-shrink-0" />
                <span className="group-data-[collapsible=icon]:hidden">Buscar...</span>
                <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 px-1.5 font-mono text-[10px] font-medium text-slate-500 dark:text-slate-400 opacity-100 group-data-[collapsible=icon]:hidden">
                  <span className="text-[10px]">⌘K</span>
                </kbd>
              </Button>
            </div>
          </SidebarHeader>

          <SidebarContent className="p-2 overflow-y-auto group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:!px-1 custom-scrollbar bg-white dark:bg-neutral-950">
            {sections.map(section => (
              <SidebarGroup key={section}>
                <SidebarGroupLabel className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-2 mb-2 mt-4">
                  {section}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {menuFiltrado.filter(i => i.section === section).map(item => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={location.pathname === item.url}
                          tooltip={item.title}
                          className={`w-full h-10 text-[13px] transition-all rounded-lg mb-0.5 group-data-[collapsible=icon]:!w-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:mx-auto ${location.pathname === item.url
                            ? "bg-slate-50 dark:bg-neutral-900 text-slate-900 dark:text-white font-semibold"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-50/80 dark:hover:bg-neutral-900 hover:text-slate-900 dark:hover:text-white"
                            }`}
                        >
                          <Link to={item.url} className="flex items-center gap-3 px-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!px-0">
                            <item.icon className={`w-4 h-4 flex-shrink-0 ${location.pathname === item.url ? "text-emerald-600 dark:text-emerald-500" : "text-slate-400 dark:text-slate-500"}`} />
                            <span className="flex-1 group-data-[collapsible=icon]:hidden truncate">{item.title}</span>
                            {item.title === 'Estoque' && alertasAtivos.length > 0 && (
                              <Badge className="h-4 min-w-4 flex items-center justify-center p-0 px-1 bg-red-500 hover:bg-red-600 text-white text-[9px] rounded-full group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:-right-1">
                                {alertasAtivos.length}
                              </Badge>
                            )}
                            {item.title === 'Setor de Compras' && menuBadges > 0 && (
                              <Badge className="h-4 min-w-4 flex items-center justify-center p-0 px-1 bg-red-500 hover:bg-red-600 text-white text-[9px] rounded-full group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:-right-1">
                                {menuBadges > 99 ? '99+' : menuBadges}
                              </Badge>
                            )}
                            {item.title === 'Assistência Técnica' && assistenciaBadges > 0 && (
                              <Badge className="h-4 min-w-4 flex items-center justify-center p-0 px-1 bg-red-500 hover:bg-red-600 text-white text-[9px] rounded-full group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:-right-1">
                                {assistenciaBadges > 99 ? '99+' : assistenciaBadges}
                              </Badge>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter className="border-t border-gray-100 dark:border-neutral-800 p-3 bg-white dark:bg-neutral-950">
            {/* User Info - hidden when collapsed */}
            <div className="flex items-center gap-3 p-1 mb-3 group-data-[collapsible=icon]:justify-center">
              <div className="w-9 h-9 rounded-full bg-slate-50 dark:bg-neutral-800 text-slate-600 dark:text-slate-300 font-bold text-[13px] flex items-center justify-center flex-shrink-0">
                {user?.full_name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{user?.full_name || 'Usuário'}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user?.email || user?.cargo || 'Colaborador'}</p>
              </div>
            </div>

            {/* New User Button - hidden when collapsed */}
            {can('manage_user_access') && (
              <Button
                size="sm"
                onClick={() => setNovoUsuarioModalOpen(true)}
                className="w-full bg-[#189851] hover:bg-[#158043] text-white h-9 text-[13px] font-medium shadow-sm mb-3 group-data-[collapsible=icon]:hidden rounded-md"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Novo Usuário
              </Button>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 group-data-[collapsible=icon]:flex-col">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDarkMode(!darkMode)}
                className="flex-1 h-9 text-[13px] font-medium text-slate-700 dark:text-slate-300 border-gray-200 dark:border-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-900 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:flex-none rounded-md"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span className="group-data-[collapsible=icon]:hidden ml-1.5">Tema</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="flex-1 h-9 text-[13px] font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:flex-none rounded-md"
              >
                <LogOut className="w-4 h-4" />
                <span className="group-data-[collapsible=icon]:hidden ml-1.5">Sair</span>
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-14 sm:h-16 bg-slate-50 dark:bg-neutral-950 flex items-center justify-between px-4 sm:px-6 w-full flex-shrink-0 gap-4">
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <div className="hidden sm:block">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  {currentPageTitle}
                </h1>
                <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {currentPageSubtitle}
                </p>
              </div>
            </div>

            <div className="relative hidden md:flex flex-1 max-w-md mx-auto justify-center">
              <div className="relative w-full">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Button 
                  variant="outline" 
                  onClick={() => setBuscaAberta(true)}
                  className="w-full justify-start pl-8 text-[13px] h-9 bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-neutral-800 rounded-lg shadow-sm"
                >
                  Pesquisar (Ctrl + K)
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <button
                className="relative p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
                title="Notificações"
              >
                <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                {menuBadges > 0 && (
                  <span className="absolute top-1 right-1 sm:top-1.5 sm:right-1.5 w-2 h-2 bg-emerald-500 rounded-full border-2 border-white dark:border-neutral-950" />
                )}
              </button>
              <button
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors hidden sm:block"
                title="Ajuda"
              >
                <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {user?.loja ? (
                <div className="hidden md:flex items-center gap-2 h-9 px-3 ml-2 rounded-lg bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 text-[13px] font-medium text-slate-700 dark:text-slate-200 shadow-sm">
                  <Store className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                  <span className="max-w-[120px] truncate">Loja {user.loja}</span>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div className="hidden md:flex items-center gap-2 h-9 px-3 ml-2 rounded-lg bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 text-[13px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-800 shadow-sm transition-colors">
                      <Store className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                      <span className="max-w-[120px] truncate">
                        {selectedStore && selectedStore !== 'todas' ? (selectedStore.toLowerCase().startsWith('loja') ? selectedStore : `Loja ${selectedStore}`) : 'Todas Lojas'}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem 
                      onClick={() => setSelectedStore('todas')}
                      className={(!selectedStore || selectedStore === 'todas') ? "font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20" : ""}
                    >
                      Todas Lojas
                    </DropdownMenuItem>
                    {lojas.map((loja) => {
                      const isSelected = selectedStore === loja.nome;
                      return (
                        <DropdownMenuItem
                          key={loja.id || loja.nome}
                          onClick={() => setSelectedStore(loja.nome)}
                          className={isSelected ? "font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20" : ""}
                        >
                          Loja {loja.nome}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>
          <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-50 dark:bg-neutral-950">
            {children}
          </div>
        </main>
      </div>

      <BuscaGlobal open={buscaAberta} onClose={() => setBuscaAberta(false)} />
      <NovoUsuarioModal
        isOpen={novoUsuarioModalOpen}
        onClose={() => setNovoUsuarioModalOpen(false)}
      />

      <StoreSelectorModal />
    </SidebarProvider>
  );
}
