import {
  LayoutDashboard, Warehouse, Users, ShoppingCart, Truck, Building2,
  FileText, DollarSign, UserCog, MessageCircle, CreditCard,
  Settings, CalendarDays, Tag, Wrench, Target, TrendingUp, Activity, RotateCcw
} from "lucide-react";

// Níveis de Acesso aos Dados
export const SCOPES = {
  ALL: 'all',       // Vê tudo (Admin)
  STORE: 'store',   // Vê da loja (Gerente)
  OWN: 'own'        // Vê só o seu (Vendedor)
};

const SCOPE_PRIORITY = {
  [SCOPES.OWN]: 1,
  [SCOPES.STORE]: 2,
  [SCOPES.ALL]: 3
};

// Regras por Cargo
export const ROLE_RULES = {
  'Administrador': {
    can: ['*'],  // Acesso total a TUDO (incluindo Compras, Vendas, etc)
    scope: SCOPES.ALL
  },
  'Gerente': {
    can: [
      'view_dashboard', 'view_dashboard_gerente', 'view_vendas', 'manage_vendas', 'cancel_vendas',
      'view_estoque', 'view_clientes', 'manage_clientes',
      'view_entregas', 'manage_entregas', 'view_assistencia', 'manage_assistencia',
      'view_financeiro', 'view_relatorios', 'view_rh',
      'view_orcamentos', 'create_vendas', 'view_produtos', 'manage_produtos', 'view_catalogo',
      'view_montagem', 'view_marketing',
      'view_compras', 'create_oc', 'manage_compras', 'manage_cost_prices', 'approve_oc', 'view_fornecedores',
      'view_nfe',
      
      
      
    ],
    scope: SCOPES.STORE
  },
  'Gerente Geral': {
    can: [
      'view_dashboard', 'view_dashboard_gerente', 'view_vendas', 'manage_vendas', 'cancel_vendas',
      'view_estoque', 'manage_estoque', 'view_clientes', 'manage_clientes',
      'view_entregas', 'manage_entregas', 'view_assistencia', 'manage_assistencia',
      'view_financeiro', 'view_relatorios', 'view_rh',
      'view_orcamentos', 'create_vendas', 'view_produtos', 'manage_produtos', 'view_catalogo',
      'view_montagem', 'view_marketing',
      'view_compras', 'create_oc', 'manage_compras', 'manage_cost_prices', 'send_oc', 'receive_oc', 'view_fornecedores',
      'manage_bulk_price_adjustment',
      'view_nfe',
      
      
      
      'view_cliente_access_analytics'
    ],
    scope: SCOPES.ALL
  },
  'Vendedor': {
    can: [
      'view_dashboard', 'view_vendas', 'create_vendas',
      'view_produtos', 'view_clientes', 'create_clientes',
      'view_orcamentos', 'create_orcamentos', 'view_catalogo',
      'view_nfe',
      
    ],
    scope: SCOPES.OWN
  },
  'Estoque': {
    can: [
      'view_estoque', 'manage_estoque', 'view_entregas', 'manage_entregas',
      'view_montagem', 'view_produtos', 'view_compras', 'receive_oc', 'view_fornecedores'
    ],
    scope: SCOPES.ALL
  },
  'Financeiro': {
    can: [
      'view_financeiro', 'manage_financeiro', 'view_vendas',
      'view_clientes', 'view_compras', 'approve_oc', 'view_fornecedores',
      'view_nfe',
      
      
      
    ],
    scope: SCOPES.ALL
  },
  'Logística': {
    can: [
      'view_entregas', 'manage_entregas', 'view_montagem', 'manage_montagem',
      'view_clientes'
    ],
    scope: SCOPES.ALL
  },
  'RH': {
    can: ['view_rh', 'manage_rh'],
    scope: SCOPES.ALL
  },
  'Montador': {
    can: ['view_montagem', 'manage_montagem'],
    scope: SCOPES.ALL
  },
  'Entregador': {
    can: ['view_entregas', 'view_mobile_entregador'],
    scope: SCOPES.OWN
  },
  'Montador Externo': {
    can: ['view_mobile_montador'],
    scope: SCOPES.OWN
  },
  'Comprador': {
    can: [
      'view_compras', 'create_oc', 'manage_compras', 'manage_cost_prices', 'send_oc',
      'view_produtos', 'manage_produtos', 'view_fornecedores'
    ],
    scope: SCOPES.ALL
  }
  // 'approve_payment_oc' — concedida apenas ao Administrador via wildcard can: ['*']
};

function normalizeRoleValue(value) {
  if (typeof value !== 'string') return null;
  const role = value.trim();
  return role || null;
}

// Retorna a lista de cargos do usuário sem fallback. Retorna [] se o usuário
// não tiver cargo atribuído (ex: clientes Supabase). Não confundir com
// getUserEffectivePermissions que aplica fallback para Vendedor nas regras de acesso.
export function getUserRoles(user) {
  const fromArray = Array.isArray(user?.cargos)
    ? user.cargos.map(normalizeRoleValue).filter(Boolean)
    : [];

  const legacyRole = normalizeRoleValue(user?.cargo);

  if (legacyRole && !fromArray.includes(legacyRole)) {
    fromArray.unshift(legacyRole);
  }

  return Array.from(new Set(fromArray));
}

export function hasRole(user, role) {
  const roleValue = normalizeRoleValue(role);
  if (!roleValue) return false;
  return getUserRoles(user).includes(roleValue);
}

export function hasAnyRole(user, roles) {
  if (!Array.isArray(roles) || roles.length === 0) return false;
  return roles.some((role) => hasRole(user, role));
}

export function getPrimaryRole(user) {
  return getUserRoles(user)[0] || 'Vendedor';
}

export function getHighestScope(scopes = []) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return SCOPES.OWN;
  }

  return scopes.reduce((highest, current) => {
    const normalizedCurrent = current || SCOPES.OWN;
    return (SCOPE_PRIORITY[normalizedCurrent] || 0) > (SCOPE_PRIORITY[highest] || 0)
      ? normalizedCurrent
      : highest;
  }, SCOPES.OWN);
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo centralizado de permissões — fonte de verdade para os editores visuais
// Cada entrada define: code (chave usada no can()), label, category, description
// ─────────────────────────────────────────────────────────────────────────────
export const PERMISSION_CATALOG = [
  // Dashboard
  { code: 'view_dashboard',         label: 'Ver Dashboard Pessoal',              category: 'Dashboard',   description: 'Painel principal com métricas do próprio usuário' },
  { code: 'view_dashboard_gerente', label: 'Ver Painel Gerencial',     category: 'Dashboard',   description: 'Painel operacional com métricas da loja ou empresa' },

  // Vendas
  { code: 'create_vendas',  label: 'Criar Vendas / PDV',     category: 'Vendas', description: 'Registrar novas vendas e usar o PDV' },
  { code: 'view_vendas',    label: 'Ver Vendas',             category: 'Vendas', description: 'Visualizar lista de vendas' },
  { code: 'manage_vendas',  label: 'Gerenciar Vendas',       category: 'Vendas', description: 'Editar e gerenciar vendas existentes' },
  { code: 'cancel_vendas',  label: 'Cancelar Vendas',        category: 'Vendas', description: 'Cancelar vendas e pedidos' },

  // Orçamentos
  { code: 'view_orcamentos',   label: 'Ver Orçamentos',    category: 'Orçamentos', description: 'Visualizar orçamentos' },
  { code: 'create_orcamentos', label: 'Criar Orçamentos',  category: 'Orçamentos', description: 'Criar novos orçamentos para clientes' },

  // Clientes
  { code: 'view_clientes',    label: 'Ver Clientes',          category: 'Clientes', description: 'Visualizar cadastro de clientes' },
  { code: 'create_clientes',  label: 'Cadastrar Clientes',    category: 'Clientes', description: 'Cadastrar novos clientes no sistema' },
  { code: 'manage_clientes',  label: 'Gerenciar Clientes',    category: 'Clientes', description: 'Editar e gerenciar dados dos clientes' },

  // Produtos
  { code: 'view_produtos',                label: 'Ver Produtos',                       category: 'Produtos', description: 'Visualizar catálogo de produtos' },
  { code: 'manage_produtos',              label: 'Gerenciar Produtos',                 category: 'Produtos', description: 'Editar e gerenciar produtos' },
  { code: 'manage_solicitacoes_cadastro', label: 'Aprovar Solicitações de Cadastro',   category: 'Produtos', description: 'Gerenciar e aprovar solicitações de cadastro de produtos' },
  { code: 'view_catalogo',                label: 'Ver Catálogo WhatsApp',              category: 'Produtos', description: 'Acessar catálogo para compartilhamento via WhatsApp' },

  // Estoque
  { code: 'view_estoque',    label: 'Ver Estoque',          category: 'Estoque', description: 'Visualizar níveis de estoque' },
  { code: 'manage_estoque',  label: 'Gerenciar Estoque',    category: 'Estoque', description: 'Gerenciar movimentações de estoque' },

  // Compras
  { code: 'view_compras',               label: 'Ver Compras',                    category: 'Compras', description: 'Visualizar setor de compras e ordens de compra' },
  { code: 'create_oc',                  label: 'Criar Ordem de Compra',          category: 'Compras', description: 'Criar novas ordens de compra' },
  { code: 'manage_compras',             label: 'Gerenciar Compras',              category: 'Compras', description: 'Gerenciar todo o processo de compras' },
  { code: 'manage_cost_prices',         label: 'Gerenciar Preços de Custo',      category: 'Compras', description: 'Visualizar e editar preços de custo dos produtos' },
  { code: 'send_oc',                    label: 'Enviar OC ao Fornecedor',        category: 'Compras', description: 'Transmitir ordens de compra aos fornecedores' },
  { code: 'receive_oc',                 label: 'Receber Mercadoria (OC)',         category: 'Compras', description: 'Registrar recebimento de mercadorias de OC' },
  { code: 'approve_oc',                 label: 'Aprovar Ordem de Compra',        category: 'Compras', description: 'Aprovar ordens de compra' },
  { code: 'approve_payment_oc',         label: 'Aprovar Pagamento de OC',        category: 'Compras', description: 'Autorizar pagamentos de ordens de compra' },
  { code: 'manage_bulk_price_adjustment', label: 'Ajuste de Preços em Massa',    category: 'Compras', description: 'Realizar ajustes de preços em lote' },
  { code: 'view_fornecedores',          label: 'Ver Fornecedores',               category: 'Compras', description: 'Visualizar cadastro de fornecedores' },

  // Logística
  { code: 'view_entregas',    label: 'Ver Entregas',          category: 'Logística', description: 'Visualizar entregas agendadas' },
  { code: 'manage_entregas',  label: 'Gerenciar Entregas',    category: 'Logística', description: 'Gerenciar, confirmar e roteirizar entregas' },

  // Montagem
  { code: 'view_montagem',    label: 'Ver Montagem',          category: 'Montagem', description: 'Visualizar agendamentos de montagem' },
  { code: 'manage_montagem',  label: 'Gerenciar Montagem',    category: 'Montagem', description: 'Gerenciar e agendar montagens' },

  // Assistência Técnica
  { code: 'view_assistencia',    label: 'Ver Assistência Técnica',       category: 'Assistência', description: 'Visualizar chamados de assistência técnica' },
  { code: 'manage_assistencia',  label: 'Gerenciar Assistência Técnica', category: 'Assistência', description: 'Gerenciar chamados de assistência técnica' },

  // Devoluções
  { code: 'view_devolucoes',    label: 'Ver Devoluções',       category: 'Devoluções', description: 'Visualizar devoluções registradas' },
  { code: 'approve_devolucoes', label: 'Aprovar Devoluções',   category: 'Devoluções', description: 'Aprovar ou rejeitar devoluções de clientes' },

  // Financeiro
  { code: 'view_financeiro',    label: 'Ver Financeiro',        category: 'Financeiro', description: 'Visualizar dados financeiros e lançamentos' },
  { code: 'manage_financeiro',  label: 'Gerenciar Financeiro',  category: 'Financeiro', description: 'Criar, editar e dar baixa em lançamentos, gerar recorrências e criar categorias. Exclusão e edição de categorias são exclusivas do administrador.' },

  // Relatórios
  { code: 'view_relatorios',             label: 'Ver Relatórios e Análises',    category: 'Relatórios', description: 'Acessar relatórios e central analítica' },
  { code: 'view_cliente_access_analytics', label: 'Ver Acessos do Portal',      category: 'Relatórios', description: 'Analytics de acesso do portal de clientes' },

  // Marketing
  { code: 'view_marketing', label: 'Ver Marketing', category: 'Marketing', description: 'Acessar ferramentas de marketing e campanhas' },

  // RH
  { code: 'view_rh',    label: 'Ver RH',          category: 'RH', description: 'Visualizar dados de recursos humanos' },
  { code: 'manage_rh',  label: 'Gerenciar RH',    category: 'RH', description: 'Gerenciar folha de pagamento e colaboradores' },

  // NF-e
  { code: 'view_nfe',                     label: 'Ver NF-e',                          category: 'NF-e', description: 'Visualizar notas fiscais emitidas' },

  // Mobile
  { code: 'view_mobile_entregador', label: 'App Entregador',  category: 'Mobile', description: 'Acesso ao aplicativo móvel de entregas' },
  { code: 'view_mobile_montador',   label: 'App Montador',    category: 'Mobile', description: 'Acesso ao aplicativo móvel de montagens' },

  // Administração
  { code: 'manage_user_access',      label: 'Gerenciar Usuários e Permissões', category: 'Administração', description: 'Gerenciar usuários, cargos e permissões do sistema' },
  { code: 'view_saas_operator_panel', label: 'Painel Operador SaaS',           category: 'Administração', description: 'Acesso ao painel de operação da plataforma SaaS' },
];

// Categorias para agrupamento visual dos editores de permissão
export const PERMISSION_CATEGORIES = [
  { key: 'Dashboard',     label: 'Dashboard',            color: '#07593f' },
  { key: 'Vendas',        label: 'Vendas',               color: '#3b82f6' },
  { key: 'Orçamentos',    label: 'Orçamentos',           color: '#06b6d4' },
  { key: 'Clientes',      label: 'Clientes',             color: '#8b5cf6' },
  { key: 'Produtos',      label: 'Produtos',             color: '#f59e0b' },
  { key: 'Estoque',       label: 'Estoque',              color: '#10b981' },
  { key: 'Compras',       label: 'Compras',              color: '#f97316' },
  { key: 'Logística',     label: 'Logística',            color: '#0ea5e9' },
  { key: 'Montagem',      label: 'Montagem',             color: '#d97706' },
  { key: 'Assistência',   label: 'Assistência Técnica',  color: '#ef4444' },
  { key: 'Devoluções',    label: 'Devoluções',           color: '#dc2626' },
  { key: 'Financeiro',    label: 'Financeiro',           color: '#8b5cf6' },
  { key: 'Relatórios',    label: 'Relatórios',           color: '#0284c7' },
  { key: 'Marketing',     label: 'Marketing',            color: '#ec4899' },
  { key: 'RH',            label: 'Recursos Humanos',     color: '#db2777' },
  { key: 'NF-e',          label: 'NF-e Fiscal',          color: '#64748b' },
  { key: 'Mobile',        label: 'Aplicativos Mobile',   color: '#22c55e' },
  { key: 'Administração', label: 'Administração',        color: '#dc2626' },
];

// Menu Lateral Configurado
// ATENÇÃO: Links em PascalCase para bater com o nome dos arquivos (Limitação da plataforma)
// NOTA: A propriedade 'module' indica qual feature flag controla a visibilidade do item
export const MENU_ITEMS = [
  { title: "Meu Painel", url: "/admin/Dashboard", icon: LayoutDashboard, permission: 'view_dashboard', section: "Principal" },
  { title: "Painel Gerencial", url: "/admin/DashboardGerente", icon: Target, permission: 'view_dashboard_gerente', section: "Principal" },
  { title: "PDV", url: "/admin/PDV", icon: CreditCard, permission: 'create_vendas', section: "Principal" },

  { title: "Pedidos", url: "/admin/Pedidos", icon: ShoppingCart, permission: 'view_vendas', section: "Vendas" },
  { title: "Orçamentos", url: "/admin/Orcamentos", icon: FileText, permission: 'view_orcamentos', section: "Vendas" },
  { title: "CRM", url: "/admin/CRM", icon: Users, permission: 'view_clientes', section: "Vendas" },

  { title: "Produtos", url: "/admin/Produtos", icon: Tag, permission: 'view_produtos', section: "Operacional" },
  { title: "Estoque", url: "/admin/Estoque", icon: Warehouse, permission: 'view_estoque', section: "Operacional" },
  { title: "Setor de Compras", url: "/admin/Compras", icon: ShoppingCart, permission: 'view_compras', section: "Operacional" },
  { title: "Fornecedores", url: "/admin/Fornecedores", icon: Building2, permission: 'view_fornecedores', section: "Operacional" },
  { title: "Logística", url: "/admin/LogisticaSemanal", icon: CalendarDays, permission: 'view_entregas', section: "Operacional" },
  { title: "Montagem", url: "/admin/Montagem", icon: Building2, permission: 'view_montagem', section: "Operacional", module: 'montagem' },
  { title: "Assistência Técnica", url: "/admin/AssistenciaTecnica", icon: Wrench, permission: 'view_assistencia', section: "Operacional", module: 'assistencia_tecnica' },
  { title: "Devoluções", url: "/admin/Devolucoes", icon: RotateCcw, permission: 'view_vendas', section: "Operacional" },

  { title: "Financeiro", url: "/admin/Financeiro", icon: DollarSign, permission: 'view_financeiro', section: "Gestão" },
  { title: "Central Analítica", url: "/admin/CentralAnalitica", icon: TrendingUp, permission: ['view_relatorios', 'view_financeiro'], section: "Gestão" },
  { title: "Marketing", url: "/admin/Marketing", icon: Tag, permission: 'view_marketing', section: "Gestão", module: 'marketing' },
  { title: "RH", url: "/admin/RecursosHumanos", icon: UserCog, permission: 'view_rh', section: "Gestão", module: 'rh' },

  { title: "WhatsApp", url: "/admin/CatalogoWhatsApp", icon: MessageCircle, permission: 'view_catalogo', section: "Ferramentas", module: 'catalogo_whatsapp' },

  // Mobile Modules - Apenas Admin pode ver no menu (são apps separados)
  { title: "App Entregador", url: "/admin/Entregador", icon: Truck, permission: 'admin_only', section: "Mobile Modules" },
  { title: "App Montador", url: "/admin/MontadorExterno", icon: Wrench, permission: 'admin_only', section: "Mobile Modules", module: 'montagem' },

  { title: "Gestão de Acessos", url: "/admin/GerenciamentoUsuarios", icon: Users, permission: 'manage_user_access', section: "Admin" },
  { title: "Configurações", url: "/admin/Configuracoes", icon: Settings, permission: 'manage_user_access', section: "Admin" }
];

/**
 * Calcula as permissoes efetivas de um usuario
 * Combina ROLE_RULES do cargo com custom_permissions do usuario
 * 
 * @param {Object} user - Usuario com cargo e custom_permissions
 * @returns {Object} { permissions: string[], scope: string }
 */
export function getUserEffectivePermissions(user) {
  if (!user) return { permissions: [], scope: SCOPES.OWN };

  const roles = getUserRoles(user);
  const roleRulesList = roles.map((role) => ROLE_RULES[role]).filter(Boolean);
  const fallbackRules = ROLE_RULES['Vendedor'];
  const effectiveRoleRules = roleRulesList.length > 0 ? roleRulesList : [fallbackRules];

  // Administrador tem acesso total
  if (effectiveRoleRules.some((rules) => rules.can.includes('*'))) {
    return {
      permissions: ['*'],
      scope: SCOPES.ALL
    };
  }

  // Pega permissoes base da uniao de cargos
  let basePermissions = Array.from(new Set(effectiveRoleRules.flatMap((rules) => rules.can)));

  // Aplica custom_permissions se existir
  const custom = user.custom_permissions;
  if (custom && typeof custom === 'object') {
    // Se nao herda do cargo, comeca do zero
    if (custom.inherit === false) {
      basePermissions = [];
    }

    // Adiciona permissoes allowed
    if (Array.isArray(custom.allowed)) {
      custom.allowed.forEach(p => {
        if (!basePermissions.includes(p)) {
          basePermissions.push(p);
        }
      });
    }

    // Remove permissoes denied
    if (Array.isArray(custom.denied)) {
      basePermissions = basePermissions.filter(p => !custom.denied.includes(p));
    }
  }

  return {
    permissions: basePermissions,
    scope: getHighestScope(effectiveRoleRules.map((rules) => rules.scope))
  };
}

/**
 * Verifica se usuario tem uma permissao especifica
 * @param {Object} user - Usuario
 * @param {string} permission - Permissao a verificar
 * @returns {boolean}
 */
export function userCan(user, permission) {
  if (Array.isArray(permission)) {
    return permission.some((item) => userCan(user, item));
  }

  const { permissions } = getUserEffectivePermissions(user);

  // Wildcard tem acesso total
  if (permissions.includes('*')) return true;

  // Permissao especifica
  return permissions.includes(permission);
}

/** Verifica se o registro pertence ao usuario (created_by, vendedor_id, etc.) */
export function isRecordOwner(user, record, fields = ['created_by']) {
  if (!user || !record) return false;

  return fields.some((field) => {
    const value = record[field];
    if (!value) return false;
    return value === user.id || value === user.email;
  });
}

/** Gerentes editam todos; vendedores apenas clientes que criaram */
export function canEditCliente(user, cliente, canFn) {
  if (!user || !cliente || typeof canFn !== 'function') return false;
  if (canFn('manage_clientes')) return true;
  if (!canFn('create_clientes')) return false;
  return isRecordOwner(user, cliente);
}

/**
 * Retorna os itens de menu visiveis para um usuario
 * @param {Object} user - Usuario
 * @returns {Array} Menu items filtrados
 */
export function getVisibleMenuItems(user) {
  const { permissions } = getUserEffectivePermissions(user);

  return MENU_ITEMS.filter(item => {
    const itemPermissions = Array.isArray(item.permission) ? item.permission : [item.permission];

    // Itens com * sao visiveis para todos
    if (itemPermissions.includes('*')) return true;

    // Admin only items
    if (itemPermissions.includes('admin_only')) {
      return permissions.includes('*');
    }

    // Verifica permissao
    if (permissions.includes('*')) return true;
    return itemPermissions.some((permission) => permissions.includes(permission));
  });
}

/**
 * Retorna todas as permissoes unicas do sistema
 * @returns {Array} Lista de permissoes
 */
export function getAllPermissions() {
  const permSet = new Set();

  MENU_ITEMS.forEach(item => {
    const itemPermissions = Array.isArray(item.permission) ? item.permission : [item.permission];
    itemPermissions.forEach((permission) => {
      if (permission && permission !== '*' && permission !== 'admin_only') {
        permSet.add(permission);
      }
    });
  });

  // Adiciona permissoes extras que nao estao no menu
  Object.values(ROLE_RULES).forEach(rule => {
    rule.can.forEach(p => {
      if (p !== '*') permSet.add(p);
    });
  });

  return Array.from(permSet).sort();
}

/**
 * Retorna o estado de cada permissao para um usuario
 * @param {Object} user - Usuario
 * @returns {Object} { permission: { active: boolean, source: 'role'|'custom_allowed'|'custom_denied' } }
 */
export function getPermissionStates(user) {
  if (!user) return {};

  const roles = getUserRoles(user);
  const roleRulesList = roles.map((role) => ROLE_RULES[role]).filter(Boolean);
  const effectiveRoleRules = roleRulesList.length > 0 ? roleRulesList : [ROLE_RULES['Vendedor']];
  const custom = user.custom_permissions || { inherit: true, allowed: [], denied: [] };
  const allPerms = getAllPermissions();

  const states = {};

  allPerms.forEach(perm => {
    const fromRole = effectiveRoleRules.some((rules) => rules.can.includes('*') || rules.can.includes(perm));
    const inAllowed = Array.isArray(custom.allowed) && custom.allowed.includes(perm);
    const inDenied = Array.isArray(custom.denied) && custom.denied.includes(perm);

    let active = false;
    let source = 'role';

    if (custom.inherit === false) {
      // Nao herda - apenas allowed conta
      active = inAllowed;
      source = inAllowed ? 'custom_allowed' : 'none';
    } else {
      // Herda do cargo
      if (inDenied) {
        active = false;
        source = 'custom_denied';
      } else if (inAllowed) {
        active = true;
        source = 'custom_allowed';
      } else {
        active = fromRole;
        source = 'role';
      }
    }

    states[perm] = { active, source, fromRole };
  });

  return states;
}
