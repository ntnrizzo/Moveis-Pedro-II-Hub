import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Users, Search, Plus, MapPin, Phone, Mail, Trash2, Edit,
  ShoppingBag, Activity, ExternalLink,
  Eye, Copy, Layers, Building2, Package, Wrench, Award, MessageCircle,
  TrendingUp, UserCheck, ShieldCheck, Sparkles, Check, Trophy
} from "lucide-react";

import ClienteModal from "@/components/clientes/ClienteModal";
import { ClienteCRMModal } from "@/components/clientes/ClienteCRMModal";
import ClienteCard from "@/components/clientes/ClienteCard";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { formatarTelefone, formatarCPF, formatarNome, formatarEndereco } from "@/utils/formatters";
import { useAuth } from "@/hooks/useAuth";
import { canEditCliente } from "@/config/permissions";
import RelatorioAcessosClientes from "./RelatorioAcessosClientes";
import { useTenant } from "@/contexts/TenantContext";
import { PORTAL_THEMES, getPortalTheme, DEFAULT_PORTAL_THEME } from "@/config/portalThemes";
import FidelidadeRegras from "@/components/marketing/FidelidadeRegras";

// Helper refinado para exibir badge do tier baseado em coroas (design limpo sem emojis exagerados)
const getTierBadge = (cliente) => {
  const coroas = cliente?.coroas || cliente?.fidelidade_steps || cliente?.passos || 0;
  const tiers = [
    { nome: 'Ouro', variant: 'amber', coroas: 500, label: 'Ouro' },
    { nome: 'Prata', variant: 'slate', coroas: 100, label: 'Prata' },
    { nome: 'Bronze', variant: 'neutral', coroas: 0, label: 'Bronze' },
  ];
  for (const tier of tiers) {
    if (coroas >= tier.coroas) return { ...tier, totalCoroas: coroas };
  }
  return { ...tiers[tiers.length - 1], totalCoroas: coroas };
};

export default function CRM() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTabParam = searchParams.get('tab') || 'cadastros';
  const [activeTab, setActiveTab] = useState(activeTabParam);

  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [viewMode, setViewMode] = useState("table"); // 'table' | 'cards'

  // Modais de Clientes
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCliente, setEditingCliente] = useState(null);
  const [isCRMModalOpen, setIsCRMModalOpen] = useState(false);
  const [selectedCRMCliente, setSelectedCRMCliente] = useState(null);
  const [pendingReturnUrl, setPendingReturnUrl] = useState(null);

  // Modal de Preview do Painel do Cliente
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewCliente, setPreviewCliente] = useState(null);

  // Estado do Seletor de Empresa para Painel do Cliente
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [organizations, setOrganizations] = useState([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);

  // Módulos do Portal do Cliente por Empresa
  const [portalModules, setPortalModules] = useState({
    meus_pedidos: true,
    assistencia: true,
    rastreio: true,
    fidelidade: true,
    autoatendimento: true,
    perfil: true,
  });
  const [selectedPortalTheme, setSelectedPortalTheme] = useState("luxo");
  const [previewTab, setPreviewTab] = useState("login"); // 'login' | 'cadastro' | 'painel'

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user, can } = useAuth();
  const { organization: currentTenantOrg } = useTenant();

  const canManageClientes = can('manage_clientes');
  const canEditClienteRecord = (cliente) => canEditCliente(user, cliente, can);

  // Query principal de Clientes
  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list('-created_date')
  });

  // Query auxiliar de Vendas para estatísticas de retenção
  const { data: vendas = [] } = useQuery({
    queryKey: ['vendas-crm-summary'],
    queryFn: () => base44.entities.Venda.list(),
    staleTime: 5 * 60 * 1000
  });

  // Query de Fidelidade Config para Nomenclatura Personalizada dos Pontos
  const { data: fidelidadeConfig } = useQuery({
    queryKey: ['fidelidade_config'],
    queryFn: async () => {
      const { data } = await supabase.from('fidelidade_config').select('*').eq('is_active', true).maybeSingle();
      return data;
    }
  });

  const nomePontosSingular = fidelidadeConfig?.nome_pontos_singular || 'Coroa';
  const nomePontosPlural = fidelidadeConfig?.nome_pontos_plural || 'Coroas';

  const [savingPortalConfig, setSavingPortalConfig] = useState(false);

  // Carregar Organizações para o gerenciamento de Painel por Empresa
  useEffect(() => {
    async function fetchOrgs() {
      setLoadingOrgs(true);
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('id, name, slug, logo_url, custom_domain')
          .order('name');
        if (!error && data) {
          setOrganizations(data);
          if (data.length > 0 && !selectedOrgId) {
            setSelectedOrgId(currentTenantOrg?.id || data[0].id);
          }
        }
      } catch (err) {
        console.error("Erro ao buscar empresas:", err);
      } finally {
        setLoadingOrgs(false);
      }
    }
    fetchOrgs();
  }, [currentTenantOrg]);

  // Carregar configurações ativas do portal quando a empresa selecionada muda
  useEffect(() => {
    async function loadOrgPortalSettings() {
      if (!selectedOrgId) return;
      try {
        const { data, error } = await supabase
          .from('organization_settings')
          .select('modulos_ativos')
          .eq('organization_id', selectedOrgId)
          .maybeSingle();

        if (data?.modulos_ativos) {
          const m = data.modulos_ativos;
          setPortalModules({
            meus_pedidos: m.meus_pedidos !== false,
            assistencia: m.assistencia_tecnica !== false && m.assistencia !== false,
            rastreio: m.rastreio !== false,
            fidelidade: m.fidelidade !== false,
            autoatendimento: m.autoatendimento !== false,
            perfil: m.perfil !== false,
          });
          setSelectedPortalTheme(m.portal_theme || "luxo");
        } else {
          setSelectedPortalTheme("luxo");
        }
      } catch (err) {
        console.error("Erro ao carregar configurações do portal:", err);
      }
    }
    loadOrgPortalSettings();
  }, [selectedOrgId]);

  const handleSavePortalConfig = async () => {
    if (!selectedOrgId) return;
    setSavingPortalConfig(true);
    try {
      const { data: existingSettings } = await supabase
        .from('organization_settings')
        .select('modulos_ativos')
        .eq('organization_id', selectedOrgId)
        .maybeSingle();

      const modulosAtuais = existingSettings?.modulos_ativos || {};
      const novosModulos = {
        ...modulosAtuais,
        meus_pedidos: portalModules.meus_pedidos,
        assistencia_tecnica: portalModules.assistencia,
        assistencia: portalModules.assistencia,
        rastreio: portalModules.rastreio,
        fidelidade: portalModules.fidelidade,
        autoatendimento: portalModules.autoatendimento,
        perfil: portalModules.perfil,
        portal_theme: selectedPortalTheme,
      };

      const { error } = await supabase
        .from('organization_settings')
        .upsert(
          {
            organization_id: selectedOrgId,
            modulos_ativos: novosModulos,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'organization_id' }
        );

      if (error) throw error;
      toast.success("Configurações do portal salvas com sucesso!");
    } catch (err) {
      console.error("Erro ao salvar configurações do portal:", err);
      toast.error("Erro ao salvar configurações do portal.");
    } finally {
      setSavingPortalConfig(false);
    }
  };

  // Handle URL search params (highlight param para abrir edição de cliente automaticamente)
  useEffect(() => {
    const highlightId = searchParams.get('highlight');
    const returnUrl = searchParams.get('returnUrl');

    if (highlightId && clientes.length > 0 && !loadingClientes) {
      const clienteToEdit = clientes.find(c => String(c.id) === String(highlightId));
      if (clienteToEdit && canEditClienteRecord(clienteToEdit)) {
        setPendingReturnUrl(returnUrl ? decodeURIComponent(returnUrl) : null);
        setEditingCliente(clienteToEdit);
        setIsModalOpen(true);

        setSearchParams(params => {
          const newParams = new URLSearchParams(params);
          newParams.delete('highlight');
          newParams.delete('returnUrl');
          return newParams;
        }, { replace: true });
      }
    }
  }, [clientes, loadingClientes, searchParams, setSearchParams]);

  // Atualizar parametro de aba na URL
  const handleTabChange = (val) => {
    setActiveTab(val);
    setSearchParams(params => {
      const newParams = new URLSearchParams(params);
      newParams.set('tab', val);
      return newParams;
    }, { replace: true });
  };

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Cliente.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast.success("Cliente removido com sucesso");
    }
  });

  const handleDeleteCliente = async (cliente) => {
    const confirmed = await confirm({
      title: "Excluir cliente",
      message: `Tem certeza que deseja remover ${cliente.nome_completo}? Essa ação não poderá ser desfeita.`,
      confirmText: "Excluir",
      variant: "destructive"
    });
    if (confirmed) {
      deleteMutation.mutate(cliente.id);
    }
  };

  // Filtro de Clientes
  const filteredClientes = useMemo(() => {
    return clientes.filter(c => {
      const matchSearch =
        c.nome_completo?.toLowerCase().includes(search.toLowerCase()) ||
        c.telefone?.includes(search) ||
        c.cpf?.includes(search) ||
        c.email?.toLowerCase().includes(search.toLowerCase());

      if (!matchSearch) return false;

      if (tierFilter !== "all") {
        const tier = getTierBadge(c);
        if (tier.nome.toLowerCase() !== tierFilter.toLowerCase()) return false;
      }
      return true;
    });
  }, [clientes, search, tierFilter]);

  // Estatísticas de CRM
  const kpiStats = useMemo(() => {
    const total = clientes.length;
    const mesAtual = new Date().getMonth();
    const anoAtual = new Date().getFullYear();

    const novosMes = clientes.filter(c => {
      if (!c.created_at && !c.created_date) return false;
      const d = new Date(c.created_at || c.created_date);
      return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    }).length;

    const vipCount = clientes.filter(c => {
      const tier = getTierBadge(c);
      return tier.nome === 'Ouro' || tier.nome === 'Prata';
    }).length;

    const clientesComCompra = new Set(vendas.map(v => String(v.cliente_id))).size;
    const taxaConversao = total > 0 ? ((clientesComCompra / total) * 100).toFixed(1) : 0;

    return { total, novosMes, vipCount, clientesComCompra, taxaConversao };
  }, [clientes, vendas]);


  const selectedOrgObj = useMemo(() => {
    return organizations.find(o => o.id === selectedOrgId) || currentTenantOrg || { name: 'Sua Empresa' };
  }, [organizations, selectedOrgId, currentTenantOrg]);

  const clientPortalUrl = useMemo(() => {
    if (selectedOrgObj?.custom_domain) {
      return `https://${selectedOrgObj.custom_domain}/login`;
    }
    const slug = selectedOrgObj?.slug || 'moveis-pedro-ii';
    return `${window.location.origin}/${slug}/login`;
  }, [selectedOrgObj]);

  const copyPortalLink = () => {
    navigator.clipboard.writeText(clientPortalUrl);
    toast.success("Link do portal copiado para a área de transferência!");
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Clean, Professional SaaS Header */}
      <div className="flex justify-end gap-4 pb-2">
        <div className="flex items-center gap-2.5">
          <Button
            onClick={() => { setEditingCliente(null); setIsModalOpen(true); }}
            className="bg-green-700 hover:bg-green-800 text-white gap-2 h-9 text-sm font-medium shadow-sm"
          >
            <Plus className="w-4 h-4" /> Novo Cliente
          </Button>
        </div>
      </div>

      {/* Clean Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-gray-200 dark:border-neutral-800 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Base Total</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{kpiStats.total}</p>
        </div>

        <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-gray-200 dark:border-neutral-800 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Novos no Mês</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">+{kpiStats.novosMes}</p>
        </div>

        <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-gray-200 dark:border-neutral-800 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Clientes Prata / Ouro</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{kpiStats.vipCount}</p>
        </div>

        <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-gray-200 dark:border-neutral-800 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Compras Ativas</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{kpiStats.taxaConversao}%</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="bg-gray-100 dark:bg-neutral-900 p-1 rounded-xl w-full sm:w-auto justify-start border border-gray-200 dark:border-neutral-800 flex-wrap">
          <TabsTrigger value="cadastros" className="gap-2 text-sm font-medium px-4">
            <Users className="w-4 h-4" /> Base de Clientes
          </TabsTrigger>
          <TabsTrigger value="fidelidade" className="gap-2 text-sm font-medium px-4">
            <Trophy className="w-4 h-4" /> Fidelidade & Regras
          </TabsTrigger>
          <TabsTrigger value="painel_empresa" className="gap-2 text-sm font-medium px-4">
            <Building2 className="w-4 h-4" /> Portal do Cliente
          </TabsTrigger>
          <TabsTrigger value="acessos" className="gap-2 text-sm font-medium px-4">
            <Activity className="w-4 h-4" /> Métricas de Acesso
          </TabsTrigger>
        </TabsList>

        {/* ==================================================================== */}
        {/* ABA 1: BASE DE CLIENTES                                             */}
        {/* ==================================================================== */}
        <TabsContent value="cadastros" className="space-y-5 mt-5">
          {/* Controls Bar */}
          <div className="bg-white dark:bg-neutral-900 p-3.5 rounded-xl border border-gray-200 dark:border-neutral-800 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar por nome, CPF ou telefone..."
                className="pl-9 h-9 border-gray-200 dark:border-neutral-700 text-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
              {/* Tier Filter */}
              <div className="flex items-center bg-gray-100 dark:bg-neutral-800 p-1 rounded-lg">
                {[
                  { key: 'all', label: 'Todos' },
                  { key: 'Ouro', label: 'Ouro' },
                  { key: 'Prata', label: 'Prata' },
                  { key: 'Bronze', label: 'Bronze' }
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTierFilter(t.key)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${tierFilter === t.key
                        ? 'bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                      }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* View Switch */}
              <div className="flex items-center bg-gray-100 dark:bg-neutral-800 p-1 rounded-lg border border-gray-200 dark:border-neutral-700">
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'}`}
                  title="Tabela"
                >
                  <Layers className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-1 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'}`}
                  title="Cards"
                >
                  <Users className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Client Table / Cards */}
          {loadingClientes ? (
            <div className="flex items-center justify-center p-12 bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-green-700" />
            </div>
          ) : filteredClientes.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-neutral-900 rounded-xl border border-dashed border-gray-300 dark:border-neutral-800">
              <Users className="w-10 h-10 mx-auto text-gray-400 mb-2" />
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Nenhum cliente encontrado</h3>
              <p className="text-xs text-gray-500 mt-0.5">Altere os filtros de busca ou cadastre um novo cliente.</p>
            </div>
          ) : viewMode === 'table' ? (
            <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 shadow-sm overflow-hidden">
              <Table>
                <TableHeader className="bg-gray-50 dark:bg-neutral-800/60">
                  <TableRow>
                    <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300">Cliente</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nível</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300">Contato</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300">Endereço / Cidade</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-600 dark:text-gray-300 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClientes.map((c) => {
                    const tier = getTierBadge(c);
                    const canEdit = canEditClienteRecord(c);

                    return (
                      <TableRow key={c.id} className="hover:bg-gray-50/80 dark:hover:bg-neutral-800/40 text-xs">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 font-bold flex items-center justify-center text-xs border border-gray-200 dark:border-neutral-700">
                              {c.nome_completo?.charAt(0).toUpperCase() || 'C'}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">
                                {formatarNome(c.nome_completo)}
                              </p>
                              <p className="text-[11px] text-gray-500">
                                CPF: {formatarCPF(c.cpf) || '—'}
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${tier.nome === 'Ouro'
                                ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                : tier.nome === 'Prata'
                                  ? 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                  : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-neutral-800 dark:text-gray-400 dark:border-neutral-700'
                              }`}>
                              {tier.nome}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              ({tier.totalCoroas} {tier.totalCoroas === 1 ? nomePontosSingular.toLowerCase() : nomePontosPlural.toLowerCase()})
                            </span>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                            {c.telefone && <p>{formatarTelefone(c.telefone)}</p>}
                            {c.email && <p className="text-gray-500">{c.email}</p>}
                          </div>
                        </TableCell>

                        <TableCell className="text-gray-600 dark:text-gray-400">
                          {c.cidade && c.estado ? `${c.cidade} - ${c.estado}` : formatarEndereco(c) || '—'}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setSelectedCRMCliente(c); setIsCRMModalOpen(true); }}
                              className="h-7 px-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
                            >
                              <ShoppingBag className="w-3.5 h-3.5 mr-1" /> Histórico
                            </Button>

                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => { setEditingCliente(c); setIsModalOpen(true); }}
                                className="h-7 w-7 text-gray-500 hover:text-gray-900 dark:hover:text-white"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                            )}

                            {canManageClientes && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteCliente(c)}
                                className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredClientes.map((c) => (
                <ClienteCard
                  key={c.id}
                  cliente={c}
                  onEdit={(cliente) => { setEditingCliente(cliente); setIsModalOpen(true); }}
                  onDelete={(cliente) => handleDeleteCliente(cliente)}
                  onOpenCRM={(cliente) => { setSelectedCRMCliente(cliente); setIsCRMModalOpen(true); }}
                  canEdit={canEditClienteRecord(c)}
                  canDelete={canManageClientes}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ==================================================================== */}
        {/* ABA 2: PAINEL DO CLIENTE POR EMPRESA                                */}
        {/* ==================================================================== */}
        <TabsContent value="painel_empresa" className="space-y-6 mt-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Empresa Selector */}
            <Card className="border-gray-200 dark:border-neutral-800 shadow-sm">
              <CardHeader className="p-4 border-b border-gray-100 dark:border-neutral-800">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-green-700" /> Empresa
                </CardTitle>
                <CardDescription className="text-xs">
                  Selecione a empresa para ajustar o portal de autoatendimento.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div>
                  <Label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Organização</Label>
                  <select
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    className="w-full mt-1.5 p-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs font-medium"
                  >
                    {organizations.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>

                <div className="p-3.5 bg-gray-50 dark:bg-neutral-800/60 rounded-lg border border-gray-200 dark:border-neutral-700 space-y-2.5 text-xs">
                  <p className="font-medium text-gray-900 dark:text-white">Link de Login do Cliente</p>
                  <p className="text-xs text-gray-500 font-mono break-all bg-white dark:bg-neutral-900 p-2 rounded border border-gray-200 dark:border-neutral-700">
                    {clientPortalUrl}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyPortalLink}
                      className="flex-1 h-8 text-xs gap-1.5 border-gray-300 dark:border-neutral-700"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copiar Link
                    </Button>
                    <a
                      href={clientPortalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-gray-300 dark:border-neutral-700 px-3 h-8 hover:bg-gray-100 dark:hover:bg-neutral-800"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Portal Modules Configuration */}
            <Card className="lg:col-span-2 border-gray-200 dark:border-neutral-800 shadow-sm">
              <CardHeader className="p-4 border-b border-gray-100 dark:border-neutral-800 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold">Módulos do Portal</CardTitle>
                  <CardDescription className="text-xs">
                    Defina quais recursos ficam visíveis no portal online para os clientes da empresa {selectedOrgObj.name}.
                  </CardDescription>
                </div>
                <Button
                  onClick={handleSavePortalConfig}
                  disabled={savingPortalConfig}
                  className="bg-green-700 hover:bg-green-800 text-white h-8 text-xs font-medium gap-1.5"
                >
                  {savingPortalConfig ? "Salvando..." : "Salvar Configurações"}
                </Button>
              </CardHeader>
              <CardContent className="p-4 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-neutral-800/50 rounded-lg border border-gray-200 dark:border-neutral-800 text-xs">
                    <div className="flex items-center gap-2.5">
                      <Package className="w-4 h-4 text-green-700" />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">Histórico de Pedidos</p>
                        <p className="text-gray-500">Acompanhamento de entregas</p>
                      </div>
                    </div>
                    <Switch
                      checked={portalModules.meus_pedidos}
                      onCheckedChange={(val) => setPortalModules(prev => ({ ...prev, meus_pedidos: val }))}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-neutral-800/50 rounded-lg border border-gray-200 dark:border-neutral-800 text-xs">
                    <div className="flex items-center gap-2.5">
                      <Wrench className="w-4 h-4 text-green-700" />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">Assistência Técnica</p>
                        <p className="text-gray-500">Solicitações de suporte</p>
                      </div>
                    </div>
                    <Switch
                      checked={portalModules.assistencia}
                      onCheckedChange={(val) => setPortalModules(prev => ({ ...prev, assistencia: val }))}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-neutral-800/50 rounded-lg border border-gray-200 dark:border-neutral-800 text-xs">
                    <div className="flex items-center gap-2.5">
                      <Award className="w-4 h-4 text-green-700" />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">Programa de Pontos / Coroas</p>
                        <p className="text-gray-500">Acúmulo e cupons</p>
                      </div>
                    </div>
                    <Switch
                      checked={portalModules.fidelidade}
                      onCheckedChange={(val) => setPortalModules(prev => ({ ...prev, fidelidade: val }))}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-neutral-800/50 rounded-lg border border-gray-200 dark:border-neutral-800 text-xs">
                    <div className="flex items-center gap-2.5">
                      <MessageCircle className="w-4 h-4 text-green-700" />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">Autoatendimento WhatsApp</p>
                        <p className="text-gray-500">Contato rápido com a equipe</p>
                      </div>
                    </div>
                    <Switch
                      checked={portalModules.autoatendimento}
                      onCheckedChange={(val) => setPortalModules(prev => ({ ...prev, autoatendimento: val }))}
                    />
                  </div>
                </div>

                {/* Theme Selector Section */}
                <div className="pt-3 border-t border-gray-100 dark:border-neutral-800 space-y-3">
                  <div>
                    <h4 className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Tema Visual do Portal do Cliente
                    </h4>
                    <p className="text-[11px] text-gray-500">Escolha o estilo estético das telas de Login, Cadastro e Painel para a empresa selecionada.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {Object.values(PORTAL_THEMES).map((t) => {
                      const isSelected = selectedPortalTheme === t.id;
                      return (
                        <div
                          key={t.id}
                          onClick={() => setSelectedPortalTheme(t.id)}
                          className={`cursor-pointer p-3.5 rounded-xl border transition-all flex flex-col justify-between ${isSelected
                              ? 'border-green-600 bg-green-50/40 dark:bg-green-950/20 ring-2 ring-green-500/20 shadow-md'
                              : 'border-gray-200 dark:border-neutral-800 hover:border-gray-300 dark:hover:border-neutral-700 bg-white dark:bg-neutral-900'
                            }`}
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-gray-900 dark:text-white">
                                {t.name}
                              </span>
                              <Badge className={`text-[10px] ${isSelected ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300'}`}>
                                {t.badge}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-gray-500 leading-tight">{t.subtitle}</p>
                            <p className="text-[10px] text-gray-400">{t.description}</p>
                          </div>

                          <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-neutral-800 flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-4 h-4 rounded-full bg-gradient-to-r ${t.previewGradient} border border-gray-300 shadow-sm`} />
                              <span className="text-[10px] font-mono text-gray-400">Paleta</span>
                            </div>
                            {isSelected && (
                              <span className="text-[10px] font-bold text-green-600 dark:text-green-400 flex items-center gap-1">
                                <Check className="w-3 h-3" /> Selecionado
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Portal Preview Bar */}
                <div className="p-4 bg-gray-900 text-white rounded-xl space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold flex items-center gap-2">
                      <Eye className="w-4 h-4 text-green-400" /> Simular Portal como Cliente
                    </span>
                    <span className="text-gray-400">Selecione um cliente cadastrado</span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2.5">
                    <select
                      className="w-full sm:flex-1 p-2 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-xs"
                      value={previewCliente?.id || ""}
                      onChange={(e) => {
                        const found = clientes.find(c => String(c.id) === String(e.target.value));
                        setPreviewCliente(found || null);
                      }}
                    >
                      <option value="">-- Escolha um cliente --</option>
                      {clientes.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.nome_completo} ({c.cpf || c.telefone || 'Sem doc'})
                        </option>
                      ))}
                    </select>

                    <Button
                      disabled={!previewCliente}
                      onClick={() => setPreviewModalOpen(true)}
                      className="w-full sm:w-auto h-8 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" /> Visualizar Portal (Prévia)
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ==================================================================== */}
        {/* ABA 3: REGRAS E CONFIGURAÇÕES DE FIDELIDADE                         */}
        {/* ==================================================================== */}
        <TabsContent value="fidelidade" className="space-y-6 mt-5">
          <FidelidadeRegras />
        </TabsContent>

        {/* ==================================================================== */}
        {/* ABA 4: METRICAS DE ACESSO DO PORTAL                                 */}
        {/* ==================================================================== */}
        <TabsContent value="acessos" className="space-y-6 mt-5">
          <RelatorioAcessosClientes />
        </TabsContent>
      </Tabs>

      {/* Modais */}
      {isModalOpen && (
        <ClienteModal
          cliente={editingCliente}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingCliente(null);
            if (pendingReturnUrl) {
              navigate(pendingReturnUrl);
              setPendingReturnUrl(null);
            }
          }}
          onSave={() => {
            queryClient.invalidateQueries({ queryKey: ['clientes'] });
            setIsModalOpen(false);
            setEditingCliente(null);
            if (pendingReturnUrl) {
              navigate(pendingReturnUrl);
              setPendingReturnUrl(null);
            }
          }}
        />
      )}

      {isCRMModalOpen && (
        <ClienteCRMModal
          cliente={selectedCRMCliente}
          isOpen={isCRMModalOpen}
          onClose={() => {
            setIsCRMModalOpen(false);
            setSelectedCRMCliente(null);
          }}
        />
      )}

      {/* Dialog Preview do Portal do Cliente */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-neutral-950 text-white border border-neutral-800">
          <DialogHeader className="border-b border-neutral-800 pb-3">
            <DialogTitle className="text-base font-bold flex items-center justify-between text-white">
              <span className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-green-400" /> Prévia do Portal: {previewCliente?.nome_completo}
              </span>
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">
                Tema: {getPortalTheme(selectedPortalTheme).name}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {previewCliente ? (
            <div className="py-2 space-y-4">
              {/* Selector de Abas da Prévia */}
              <div className="flex items-center justify-between gap-2 border-b border-neutral-800 pb-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setPreviewTab('login')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${previewTab === 'login' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                  >
                    1. Tela de Login
                  </button>
                  <button
                    onClick={() => setPreviewTab('cadastro')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${previewTab === 'cadastro' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                  >
                    2. Tela de Cadastro
                  </button>
                  <button
                    onClick={() => setPreviewTab('painel')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${previewTab === 'painel' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                  >
                    3. Painel do Cliente
                  </button>
                </div>
              </div>

              {/* Viewport Frame */}
              <div className="rounded-2xl border border-neutral-800 overflow-hidden shadow-2xl p-4 sm:p-6 transition-all duration-300 bg-stone-900">
                {(() => {
                  const theme = getPortalTheme(selectedPortalTheme);
                  const isAuthTab = previewTab === 'login' || previewTab === 'cadastro';
                  const styles = isAuthTab ? theme.auth : theme.dashboard;

                  if (previewTab === 'login') {
                    return (
                      <div className={`p-6 sm:p-8 rounded-2xl ${styles.bg} transition-all`}>
                        <div className="max-w-md mx-auto space-y-6">
                          <div className="text-center space-y-2">
                            <h3 className={`text-2xl font-bold ${styles.textHeading}`}>{selectedOrgObj.name}</h3>
                            <p className={`text-xs ${styles.textMuted}`}>Acesse sua Área Exclusiva do Cliente</p>
                          </div>

                          <div className={`p-6 rounded-2xl ${styles.card} space-y-4`}>
                            <div className="space-y-1">
                              <label className={`text-xs font-semibold ${styles.textMuted}`}>E-mail ou CPF</label>
                              <input disabled type="text" value={previewCliente.email || previewCliente.cpf || ""} className={`w-full px-3 py-2 text-xs rounded-xl ${styles.input}`} />
                            </div>
                            <div className="space-y-1">
                              <label className={`text-xs font-semibold ${styles.textMuted}`}>Senha</label>
                              <input disabled type="password" value="••••••••" className={`w-full px-3 py-2 text-xs rounded-xl ${styles.input}`} />
                            </div>
                            <button className={`w-full py-2.5 text-xs rounded-xl ${styles.primaryButton}`}>
                              Entrar no Painel
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (previewTab === 'cadastro') {
                    return (
                      <div className={`p-6 sm:p-8 rounded-2xl ${styles.bg} transition-all`}>
                        <div className="max-w-md mx-auto space-y-6">
                          <div className="text-center space-y-2">
                            <h3 className={`text-2xl font-bold ${styles.textHeading}`}>Criar Minha Conta</h3>
                            <p className={`text-xs ${styles.textMuted}`}>Cadastre-se na loja {selectedOrgObj.name}</p>
                          </div>

                          <div className={`p-6 rounded-2xl ${styles.card} space-y-4`}>
                            <div className="space-y-1">
                              <label className={`text-xs font-semibold ${styles.textMuted}`}>Nome Completo</label>
                              <input disabled type="text" value={previewCliente.nome_completo || ""} className={`w-full px-3 py-2 text-xs rounded-xl ${styles.input}`} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className={`text-xs font-semibold ${styles.textMuted}`}>Telefone / WhatsApp</label>
                                <input disabled type="text" value={previewCliente.telefone || "(38) 99999-0000"} className={`w-full px-3 py-2 text-xs rounded-xl ${styles.input}`} />
                              </div>
                              <div className="space-y-1">
                                <label className={`text-xs font-semibold ${styles.textMuted}`}>CPF</label>
                                <input disabled type="text" value={previewCliente.cpf || "000.000.000-00"} className={`w-full px-3 py-2 text-xs rounded-xl ${styles.input}`} />
                              </div>
                            </div>
                            <button className={`w-full py-2.5 text-xs rounded-xl ${styles.primaryButton}`}>
                              Cadastrar e Acessar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className={`p-6 rounded-2xl ${styles.bg} space-y-6 transition-all`}>
                      {/* Top Bar */}
                      <div className={`p-4 rounded-xl ${styles.headerBg} flex items-center justify-between`}>
                        <div>
                          <h3 className={`text-lg font-bold ${styles.textHeading}`}>Olá, {previewCliente.nome_completo?.split(' ')[0]}</h3>
                          <p className={`text-xs ${styles.textMuted}`}>Portal {selectedOrgObj.name}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${styles.badge}`}>
                          Nível {getTierBadge(previewCliente).nome}
                        </span>
                      </div>

                      {/* Loyalty Banner */}
                      <div className={`p-5 rounded-2xl ${styles.loyaltyBg} space-y-3`}>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Programa Coroas & Fidelidade</p>
                            <h4 className="text-xl font-bold text-white">{previewCliente.coroas || 120} Coroas Acumuladas</h4>
                          </div>
                          <Award className="w-8 h-8 text-amber-400" />
                        </div>
                      </div>

                      {/* Modules Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className={`p-4 rounded-xl ${styles.card}`}>
                          <p className={`font-bold text-xs ${styles.textHeading} mb-1`}>Meus Pedidos</p>
                          <p className={`text-[11px] ${styles.textMuted}`}>3 pedidos registrados</p>
                        </div>
                        <div className={`p-4 rounded-xl ${styles.card}`}>
                          <p className={`font-bold text-xs ${styles.textHeading} mb-1`}>Assistência Técnica</p>
                          <p className={`text-[11px] ${styles.textMuted}`}>Nenhum chamado aberto</p>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <p className="text-center py-6 text-neutral-500 text-xs">Selecione um cliente para simular a prévia.</p>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewModalOpen(false)} className="h-8 text-xs text-white border-neutral-700 bg-neutral-800 hover:bg-neutral-700">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
