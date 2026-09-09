import { useState, useEffect, createContext, useContext } from "react";
import { base44, supabase } from "@/api/base44Client";
import { getActiveAuthMode, setActiveAuthMode, clearActiveAuthMode, AUTH_MODES } from "@/lib/supabase";
import { ROLE_RULES, SCOPES, userCan, getUserRoles, getHighestScope, hasRole, getUserEffectivePermissions } from "@/config/permissions";
import { canAccessLojaId, filterDataByLoja } from "@/lib/utils";
import { FINANCIAL_CAPABILITIES, createFinancialAccessLoader } from '@/lib/financialCapabilities';

const AuthContext = createContext(null);

function normalizeUserRoles(user) {
  const roles = getUserRoles(user);
  return {
    ...user,
    cargos: roles,
    // Preserva cargo legado; não sobrescreve com default de roles para não
    // dar cargo a clientes sem cargo atribuído.
    cargo: user?.cargo || null
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cargoPermissoes, setCargoPermissoes] = useState(null);
  const [authType, setAuthType] = useState(null); // 'employee' | 'supabase' | null
  const [authError, setAuthError] = useState(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [financialAccess, setFinancialAccess] = useState(null);

  useEffect(() => {
    setFinancialAccess(null);
    if (!user?.id || !user?.organization_id) return;
    const loader = createFinancialAccessLoader(supabase, user, setFinancialAccess);
    const refresh = loader.refresh;
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('financial-permissions-changed', refresh);
    const interval = setInterval(refresh, 60000);
    return () => {
      loader.dispose();
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('financial-permissions-changed', refresh);
    };
  }, [user, authAttempt]);

  // Admin Store Selection State
  const [selectedStore, setSelectedStoreState] = useState(() => {
    return localStorage.getItem('admin_selected_store') || null;
  });

  const setSelectedStore = (store) => {
    setSelectedStoreState(store);
    if (store) {
      localStorage.setItem('admin_selected_store', store);
    } else {
      localStorage.removeItem('admin_selected_store');
    }
  };

  const getMergedRolePermissions = (roles = [], rawRolePermissions = []) => {
    const allPermissions = new Set();
    for (const role of roles) {
      const dbRow = rawRolePermissions.find(r => r.cargo === role);
      // Base: hardcoded ROLE_RULES (fallback when no DB row exists)
      (ROLE_RULES[role]?.can || []).forEach(p => allPermissions.add(p));
      if (dbRow) {
        // Explicitly added permissions (extras beyond ROLE_RULES)
        (dbRow.permissions || []).forEach(p => allPermissions.add(p));
        // Explicitly denied permissions (removed from ROLE_RULES)
        (dbRow.denied_permissions || []).forEach(p => allPermissions.delete(p));
      }
    }
    return Array.from(allPermissions);
  };

  useEffect(() => {
    let mounted = true;

    const isTimeoutError = (error) => {
      return error?.message?.includes('Timeout em');
    };

    const startLoadingFailsafe = () => {
      return setTimeout(() => {
        if (mounted) {
          console.warn('[Auth] Failsafe acionado: finalizando loading para evitar tela travada.');
          setLoading(false);
        }
      }, 10000);
    };

    const withTimeout = async (promise, ms, label) => {
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timeout em ${label}`)), ms);
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // Flag interna: se o usuário já foi autenticado, timeouts subsequentes
    // (ex.: permissões, base44.auth.me em Strict Mode) NÃO devem gerar authError.
    let userAlreadyResolved = false;

    const loadPermissionsForUser = async (targetUser) => {
      try {
        const rolePermissions = await withTimeout(
          base44.entities.RolePermission.list(),
          10000,
          'RolePermission.list'
        );
        const roles = getUserRoles(targetUser);
        // Filter DB rows matching the user's roles
        const userRoleRows = rolePermissions.filter(c => roles.includes(c.cargo));
        const permissions = getMergedRolePermissions(roles, userRoleRows);

        if (permissions.length > 0 && mounted) {
          // Scope: prefer DB scope (supports custom cargos), fallback to ROLE_RULES
          const scopePerRole = roles.map(role => {
            const dbRow = userRoleRows.find(r => r.cargo === role);
            return dbRow?.scope || ROLE_RULES[role]?.scope || SCOPES.OWN;
          });
          setCargoPermissoes({
            can: permissions,
            scope: getHighestScope(scopePerRole)
          });
        }
      } catch (e) {
        // Permissões são não-críticas: fallback hardcoded já cobre.
        // NÃO setar authError aqui — o usuário já foi autenticado com sucesso.
        console.warn('[Auth] Usando permissões hardcoded (fallback)', e);
      }
    };

    // Função auxiliar para carregar o perfil completo (Supabase)
    const loadSupabaseProfile = async (sessionUser) => {
      try {
        if (!sessionUser) {
          return null;
        }

        const { data: u, error: profileError } = await supabase
          .from('public_users')
          .select('*')
          .eq('id', sessionUser.id)
          .maybeSingle();

        if (profileError && profileError.code !== 'PGRST116') {
          console.error('Erro ao buscar perfil:', profileError);
        }

        // Mescla dados da sessão com dados do perfil e normaliza cargos
        const fullUser = u ? { ...sessionUser, ...u } : sessionUser;
        return normalizeUserRoles(fullUser);
      } catch (err) {
        console.error('Erro ao carregar perfil Supabase:', err);
        return sessionUser;
      }
    };

    // Função para verificar autenticação de funcionário (agora via Supabase direto)
    const checkEmployeeAuth = async () => {
      // Verifica se há dados de usuário em localStorage (cache do login)
      const cachedUser = localStorage.getItem('employee_user');
      if (!cachedUser) return null;

      try {
        // Valida que o cache é JSON v\u00e1lido antes de prosseguir (cache corrompido = limpar e sair)
        JSON.parse(cachedUser);

        const parsedCachedUser = normalizeUserRoles(JSON.parse(cachedUser));

        // Verificar se ainda tem sessão Supabase ativa (com timeout)
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          8000,
          'supabase.auth.getSession'
        );

        if (!session) {
          // Sessão expirada, limpar cache
          localStorage.removeItem('employee_user');
          return null;
        }

        // Buscar perfil atualizado do banco para garantir dados recentes
        let userProfile = null;
        let error = null;
        try {
          const profileResponse = await withTimeout(
            supabase
              .from('public_users')
              .select('*')
              .eq('id', session.user.id)
              .maybeSingle(),
            15000,
            'public_users.profile'
          );
          userProfile = profileResponse?.data || null;
          error = profileResponse?.error || null;
        } catch (profileTimeoutError) {
          console.warn('[Auth] Timeout ao buscar perfil, usando cache local.', profileTimeoutError);
          return normalizeUserRoles({
            ...session.user,
            ...parsedCachedUser,
            full_name: parsedCachedUser.full_name || parsedCachedUser.matricula || session.user.email
          });
        }

        if (error || !userProfile) {
          console.warn('[Auth] Perfil não encontrado no banco');
          return normalizeUserRoles({
            ...session.user,
            ...parsedCachedUser,
            full_name: parsedCachedUser.full_name || parsedCachedUser.matricula || session.user.email
          });
        }

        if (!userProfile.ativo) {
          console.warn('[Auth] Usuário inativo');
          localStorage.removeItem('employee_user');
          await supabase.auth.signOut();
          return null;
        }

        // Atualizar cache com dados atualizados
        localStorage.setItem('employee_user', JSON.stringify(userProfile));

        return normalizeUserRoles({
          ...session.user,
          ...userProfile,
          full_name: userProfile.full_name || userProfile.matricula
        });
      } catch (e) {
        console.error("Erro ao verificar auth de funcionário:", e);
        try {
          const parsedCachedUser = JSON.parse(cachedUser);
          if (isTimeoutError(e)) {
            console.warn('[Auth] Timeout ao validar sessão remota, mantendo cache local temporariamente.');
          } else {
            console.warn('[Auth] Falha na validação remota, mantendo cache local temporariamente.');
          }
          return normalizeUserRoles(parsedCachedUser);
        } catch {
          localStorage.removeItem('employee_user');
          return null;
        }
      }
    };

    // Carrega estado inicial
    const initAuth = async () => {
      console.log('[Auth] Iniciando verificação de autenticação...');

      try {
        if (mounted) {
          setAuthError(null);
        }

        // Limpar token legado do backend (não mais utilizado)
        if (localStorage.getItem('employee_token')) {
          console.log('[Auth] Removendo token legado do backend...');
          localStorage.removeItem('employee_token');
        }

        // ISOLAMENTO: Se o modo ativo é 'operator', não carregar perfil de tenant
        const currentMode = getActiveAuthMode();
        if (currentMode === AUTH_MODES.OPERATOR) {
          console.log('[Auth] Modo operador ativo. Ignorando sessão de tenant.');
          if (mounted) {
            setUser(null);
            setLoading(false);
          }
          return;
        }

        // 1. Primeiro verifica se há cache de funcionário
        const hasCachedUser = localStorage.getItem('employee_user');

        if (hasCachedUser) {
          console.log('[Auth] Cache de funcionário encontrado, verificando...');
          const employeeUser = await checkEmployeeAuth();

          if (employeeUser && mounted) {
            console.log('[Auth] ✅ Funcionário autenticado:', employeeUser.full_name, '- Cargos:', employeeUser.cargos?.join(', ') || employeeUser.cargo);
            userAlreadyResolved = true;
            setAuthType('employee');
            setUser(employeeUser);
            setLoading(false);

            // Carrega permissões sem bloquear navegação inicial
            void loadPermissionsForUser(employeeUser);

            return;
          } else {
            console.log('[Auth] ⚠️ Cache inválido ou sessão expirada');
          }
        }

        // 2. Se não tem funcionário logado, verifica Supabase Auth (para clientes)
        console.log('[Auth] Verificando autenticação Supabase...');
        const supabaseUser = await withTimeout(
          base44.auth.me(),
          15000,
          'base44.auth.me'
        );

        if (supabaseUser && mounted) {
          const fullProfile = await loadSupabaseProfile(supabaseUser);

          if (fullProfile) {
            console.log('[Auth] Supabase user encontrado:', fullProfile.email, '- Cargos:', fullProfile.cargos?.join(', ') || fullProfile.cargo || 'Nenhum');
            setAuthType('supabase');
            setUser(fullProfile);

            // Buscar permissões dos cargos se existir
            if (fullProfile.cargos?.length || fullProfile.cargo) {
              void loadPermissionsForUser(fullProfile);
            }
          }
        }
      } catch (error) {
        console.error('[Auth] Erro durante initAuth:', error);
        // Só exibe tela de erro se o usuário ainda não foi resolvido com sucesso.
        // Em React Strict Mode, o useEffect pode rodar duas vezes; a segunda
        // invocação pode dar timeout enquanto a primeira já autenticou o user.
        if (isTimeoutError(error) && mounted && !userAlreadyResolved) {
          setUser(null);
          setCargoPermissoes(null);
          setAuthType(null);
          setAuthError({
            code: 'auth-timeout',
            source: error?.message?.replace('Timeout em ', '') || 'auth',
            message: 'Nao foi possivel validar sua sessao dentro do tempo esperado. Tente novamente em instantes.'
          });
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    const failsafeId = startLoadingFailsafe();
    initAuth().finally(() => clearTimeout(failsafeId));

    // Inscreve para mudanças no Supabase Auth
    const { data: { subscription } } = base44.auth.onAuthStateChange?.((event, session) => {
      if (event === 'SIGNED_OUT' && authType === 'supabase') {
        setUser(null);
        setCargoPermissoes(null);
        setAuthType(null);
        setLoading(false);
        localStorage.removeItem('admin_selected_store'); // Limpa seleção ao sair
      } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && !localStorage.getItem('employee_user')) {
        // Só atualiza se não estiver logado como funcionário E se não estiver em modo operador
        if (getActiveAuthMode() === AUTH_MODES.OPERATOR) return;
        loadSupabaseProfile(session?.user).then(profile => {
          if (mounted && profile) {
            setAuthType('supabase');
            setUser(profile);
          }
        });
      }
    }) || { data: { subscription: null } };

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [authAttempt]);

  // Sync effect: If user has fixed store, force selectedStore to match
  useEffect(() => {
    if (user?.loja) {
      if (selectedStore !== user.loja) {
        setSelectedStoreState(user.loja);
        localStorage.setItem('admin_selected_store', user.loja);
      }
    }
  }, [user?.loja]);

  // Função de logout que funciona para ambos os tipos
  const logout = async () => {
    // Limpar cache de funcionário
    localStorage.removeItem('employee_user');
    // Limpar modo de autenticação
    clearActiveAuthMode();
    // Sempre tenta deslogar do Supabase também
    await base44.auth.logout();
    setUser(null);
    setAuthType(null);
    setCargoPermissoes(null);
    setAuthError(null);
    setSelectedStore(null); // Limpa seleção
    window.location.href = '/login';
  };

  const retryAuth = () => {
    setLoading(true);
    setAuthError(null);
    setAuthAttempt(prev => prev + 1);
  };

  // Verifica permissão - primeiro tenta banco, depois fallback hardcoded
  const can = (permission) => {
    if (!user) return false;
    if (Array.isArray(permission)) return permission.some(p => can(p));
    if (FINANCIAL_CAPABILITIES.has(permission)) {
      return user.ativo !== false && financialAccess?.user_id === user.id &&
        financialAccess?.organization_id === user.organization_id &&
        financialAccess?.[permission] === true;
    }

    const roles = getUserRoles(user);
    if (!roles.length) return false;

    // Se cargo é Administrador no banco OU tem permissão especial '*'
    if (hasRole(user, 'Administrador')) return true;

    // Tenta usar permissões do banco primeiro
    if (cargoPermissoes?.can) {
      if (cargoPermissoes.can.includes('*')) return true;
      return cargoPermissoes.can.includes(permission);
    }

    // Fallback para regras hardcoded multi-cargo
    return userCan(user, permission);
  };

  // Pega o escopo (all, store, own)
  const getScope = () => {
    if (!user) return SCOPES.OWN;

    // Tenta banco primeiro
    if (cargoPermissoes?.scope) {
      return cargoPermissoes.scope;
    }

    // Fallback
    return getUserEffectivePermissions(user).scope;
  };

  // Verifica se usuario e Gerente
  const isGerente = () => {
    return hasRole(user, 'Gerente');
  };

  // Pega a loja do usuario (Prioridade: Loja fixa do user -> Loja selecionada pelo Admin)
  const getUserLoja = () => {
    return user?.loja || selectedStore || null;
  };

  const getUserLojas = () => {
    const lojas = [user?.loja, selectedStore].filter(Boolean);
    return Array.from(new Set(lojas));
  };

  const canAccessLoja = (lojaId) => {
    return canAccessLojaId(lojaId, getUserLojas());
  };

  // Verifica se deve filtrar por loja (Gerente)
  const shouldFilterByStore = () => {
    return getUserLojas().length > 0;
  };

  // Filtra dados automaticamente por escopo
  const filterData = (data, options = {}) => {
    if (!data || !user) return [];
    if (!Array.isArray(data)) return [];

    const normalizedOptions = typeof options === 'string'
      ? { scopeOverride: options }
      : (options || {});

    const userLojas = getUserLojas();
    const dataWithinUserStores = userLojas.length > 0
      ? filterDataByLoja(data, userLojas, { lojaField: normalizedOptions.lojaField })
      : data;

    const scope = normalizedOptions.scopeOverride || getScope();

    // Mesmo admins do tenant continuam limitados a suas lojas atribuídas.
    if (scope === SCOPES.ALL || scope === 'all') return dataWithinUserStores;

    // Gerente ve apenas da sua loja
    if (scope === SCOPES.STORE || scope === 'store') {
      if (!userLojas.length) {
        console.warn('[useAuth] Gerente sem loja definida, filtrando tudo');
        return [];
      }

      return dataWithinUserStores;
    }

    // Vendedor ve apenas o proprio
    if (scope === SCOPES.OWN || scope === 'own') {
      const userIdField = normalizedOptions.userField || 'responsavel_id';
      const userIdFields = [userIdField, 'vendedor_id', 'created_by', 'user_id'];

      return dataWithinUserStores.filter(item => {
        for (const field of userIdFields) {
          if (item[field] === user.id || item[field] === user.email) {
            return true;
          }
        }
        return false;
      });
    }

    return [];
  };

  const value = {
    user,
    loading,
    authError,
    logout,
    retryAuth,
    authType,
    can,
    getScope,
    filterData,
    isGerente,
    getUserLoja,
    getUserLojas,
    canAccessLoja,
    shouldFilterByStore,
    SCOPES,
    selectedStore,
    setSelectedStore
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined || context === null) {
    console.error('[useAuth] Context is missing! AuthContext:', AuthContext);
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
