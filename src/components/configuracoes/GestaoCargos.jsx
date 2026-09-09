import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Info, Key, Plus, Trash2, Loader2 } from "lucide-react";
import { CARGOS } from "@/config/cargos";
import { ROLE_RULES, SCOPES } from "@/config/permissions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import RolePermissionEditorModal from "./RolePermissionEditorModal";

const SCOPE_COLORS = {
    [SCOPES.ALL]:   '#dc2626',
    [SCOPES.STORE]: '#f97316',
    [SCOPES.OWN]:   '#3b82f6',
};

const SCOPE_LABELS = {
    [SCOPES.ALL]:   'Escopo: Todos',
    [SCOPES.STORE]: 'Escopo: Loja',
    [SCOPES.OWN]:   'Escopo: Próprio',
};

const SCOPE_SELECT_OPTIONS = [
    { value: SCOPES.ALL,   label: 'Todos os dados (toda a empresa)' },
    { value: SCOPES.STORE, label: 'Dados da loja do usuário' },
    { value: SCOPES.OWN,   label: 'Apenas dados próprios' },
];

export default function GestaoCargos() {
    const [editingCargo, setEditingCargo]         = useState(null);
    const [criarCargoOpen, setCriarCargoOpen]     = useState(false);
    const [novoCargo, setNovoCargo]               = useState({ nome: '', cor: '#6b7280', escopo: SCOPES.OWN, descricao: '' });
    const [confirmarExcluir, setConfirmarExcluir] = useState(null);
    const queryClient = useQueryClient();

    const { data: rolePermissions = [] } = useQuery({
        queryKey: ['role_permissions'],
        queryFn: () => base44.entities.RolePermission.list()
    });

    // Merge static CARGOS (config) + custom cargos created via UI (is_custom = true in DB)
    const allCargos = useMemo(() => {
        const staticList = CARGOS.map(c => {
            const dbRow = rolePermissions.find(r => r.cargo === c.value);
            return {
                value:       c.value,
                label:       c.label,
                color:       c.color,
                bgColor:     c.bgColor,
                description: c.description,
                icon:        c.icon,
                isCustom:    false,
                dbRow,
                scope: dbRow?.scope || ROLE_RULES[c.value]?.scope || SCOPES.OWN,
            };
        });

        const customList = rolePermissions
            .filter(r => r.is_custom && !CARGOS.find(c => c.value === r.cargo))
            .map(r => ({
                value:       r.cargo,
                label:       r.label || r.cargo,
                color:       r.color || '#6b7280',
                bgColor:     `${r.color || '#6b7280'}22`,
                description: r.description || '',
                icon:        Shield,
                isCustom:    true,
                dbRow:       r,
                scope:       r.scope || SCOPES.OWN,
            }));

        return [...staticList, ...customList];
    }, [rolePermissions]);

    // Save permissions (additions + denials) and scope for a cargo
    const savePermissionsMutation = useMutation({
        mutationFn: async ({ cargo, permissions, deniedPermissions, scope }) => {
            const existing = rolePermissions.find(r => r.cargo === cargo);
            const payload = {
                permissions:        permissions        || [],
                denied_permissions: deniedPermissions  || [],
                scope:              scope              || SCOPES.OWN,
                updated_at:         new Date().toISOString(),
            };
            if (existing) {
                await base44.entities.RolePermission.update(existing.id, payload);
            } else {
                await base44.entities.RolePermission.create({ cargo, ...payload });
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['role_permissions'] });
            window.dispatchEvent(new Event('financial-permissions-changed'));
            setEditingCargo(null);
            toast.success('Permissões do cargo atualizadas!');
        },
        onError: (e) => toast.error('Erro: ' + e.message)
    });

    // Create a new custom cargo in DB
    const createCargoMutation = useMutation({
        mutationFn: async ({ nome, cor, escopo, descricao }) => {
            const nomeNorm = nome.trim();
            if (!nomeNorm) throw new Error('Nome do cargo é obrigatório.');
            const existe = rolePermissions.find(r => r.cargo === nomeNorm) || CARGOS.find(c => c.value === nomeNorm);
            if (existe) throw new Error(`Cargo "${nomeNorm}" já existe.`);
            await base44.entities.RolePermission.create({
                cargo:              nomeNorm,
                permissions:        [],
                denied_permissions: [],
                scope:              escopo      || SCOPES.OWN,
                label:              nomeNorm,
                color:              cor         || '#6b7280',
                description:        descricao   || '',
                is_custom:          true,
                updated_at:         new Date().toISOString(),
            });
        },
        onSuccess: (_, { nome }) => {
            queryClient.invalidateQueries({ queryKey: ['role_permissions'] });
            window.dispatchEvent(new Event('financial-permissions-changed'));
            setCriarCargoOpen(false);
            setNovoCargo({ nome: '', cor: '#6b7280', escopo: SCOPES.OWN, descricao: '' });
            toast.success(`Cargo "${nome.trim()}" criado! Configure as permissões clicando em "Editar Permissões".`);
        },
        onError: (e) => toast.error('Erro: ' + e.message)
    });

    // Delete a custom cargo from DB
    const deleteCargoMutation = useMutation({
        mutationFn: async (cargo) => {
            const row = rolePermissions.find(r => r.cargo === cargo && r.is_custom);
            if (!row) throw new Error('Apenas cargos personalizados podem ser excluídos.');
            await base44.entities.RolePermission.delete(row.id);
        },
        onSuccess: (_, cargo) => {
            queryClient.invalidateQueries({ queryKey: ['role_permissions'] });
            window.dispatchEvent(new Event('financial-permissions-changed'));
            setConfirmarExcluir(null);
            toast.success(`Cargo "${cargo}" excluído.`);
        },
        onError: (e) => toast.error('Erro: ' + e.message)
    });

    const getCargoPermissions = (cargoValue) =>
        rolePermissions.find(r => r.cargo === cargoValue)?.permissions || [];

    const getCargoDenied = (cargoValue) =>
        rolePermissions.find(r => r.cargo === cargoValue)?.denied_permissions || [];

    const handleSavePermissions = ({ permissions, deniedPermissions, scope }) => {
        if (!editingCargo) return;
        savePermissionsMutation.mutate({
            cargo: editingCargo.value,
            permissions,
            deniedPermissions,
            scope,
        });
    };

    return (
        <div className="space-y-6">
            <Card className="border-0 shadow-lg">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2" style={{ color: '#07593f' }}>
                            <Shield className="w-6 h-6" />
                            Cargos do Sistema
                        </CardTitle>
                        <Button
                            onClick={() => setCriarCargoOpen(true)}
                            style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Criar Cargo
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <p className="text-gray-500 mb-6 text-sm">
                        Gerencie cargos e suas permissões. Cargos personalizados podem ser criados e excluídos.
                        Clique em &quot;Editar Permissões&quot; para ajustar o acesso de qualquer cargo.
                    </p>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {allCargos.map((cargo) => {
                            const Icon = cargo.icon;
                            const hasCustomPerms =
                                getCargoPermissions(cargo.value).length > 0 ||
                                getCargoDenied(cargo.value).length > 0;
                            const scopeValue = cargo.scope;

                            return (
                                <div
                                    key={cargo.value}
                                    className="p-4 rounded-xl border-2 transition-all hover:shadow-md"
                                    style={{ backgroundColor: cargo.bgColor, borderColor: cargo.color }}
                                >
                                    <div className="flex items-start gap-3">
                                        <div
                                            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                                            style={{ backgroundColor: `${cargo.color}20` }}
                                        >
                                            <Icon className="w-6 h-6" style={{ color: cargo.color }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-1 flex-wrap">
                                                <h3 className="font-bold truncate" style={{ color: cargo.color }}>
                                                    {cargo.label}
                                                </h3>
                                                <div className="flex gap-1 flex-shrink-0">
                                                    {hasCustomPerms && (
                                                        <Badge className="bg-blue-100 text-blue-700 text-xs">
                                                            <Key className="w-3 h-3 mr-1" />
                                                            Editado
                                                        </Badge>
                                                    )}
                                                    {cargo.isCustom && (
                                                        <Badge className="bg-purple-100 text-purple-700 text-xs">
                                                            Custom
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>

                                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                                {cargo.description}
                                            </p>

                                            <div className="mt-2">
                                                <Badge
                                                    className="text-xs"
                                                    style={{
                                                        backgroundColor: `${SCOPE_COLORS[scopeValue] || '#6b7280'}15`,
                                                        color:           SCOPE_COLORS[scopeValue] || '#6b7280',
                                                        border:          `1px solid ${SCOPE_COLORS[scopeValue] || '#6b7280'}40`,
                                                    }}
                                                >
                                                    {SCOPE_LABELS[scopeValue] || 'Escopo: Próprio'}
                                                </Badge>
                                            </div>

                                            <div className="flex gap-2 mt-3">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="flex-1 text-xs"
                                                    onClick={() => setEditingCargo(cargo)}
                                                    style={{ borderColor: cargo.color, color: cargo.color }}
                                                >
                                                    <Key className="w-3 h-3 mr-1" />
                                                    Editar Permissões
                                                </Button>
                                                {cargo.isCustom && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-red-600 hover:text-red-700 border-red-200"
                                                        onClick={() => setConfirmarExcluir(cargo.value)}
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            <Alert className="bg-blue-50 border-blue-200">
                <Info className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                    <strong>Escopo de dados:</strong> Controla quais registros o usuário enxerga — todos da empresa, apenas da loja dele, ou somente os próprios.
                    As permissões definem quais ações e telas estão disponíveis.
                </AlertDescription>
            </Alert>

            {/* ── Modal: Criar Cargo ── */}
            <Dialog open={criarCargoOpen} onOpenChange={setCriarCargoOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Criar Novo Cargo</DialogTitle>
                        <DialogDescription>
                            Crie um cargo personalizado e depois configure suas permissões.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="nome-cargo">Nome do Cargo *</Label>
                            <Input
                                id="nome-cargo"
                                value={novoCargo.nome}
                                onChange={(e) => setNovoCargo(prev => ({ ...prev, nome: e.target.value }))}
                                placeholder="Ex: Supervisor, Analista, Caixa..."
                                maxLength={50}
                            />
                        </div>
                        <div>
                            <Label>Escopo de Dados *</Label>
                            <Select
                                value={novoCargo.escopo}
                                onValueChange={(v) => setNovoCargo(prev => ({ ...prev, escopo: v }))}
                            >
                                <SelectTrigger className="mt-1">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {SCOPE_SELECT_OPTIONS.map(opt => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Cor de identificação</Label>
                            <div className="flex gap-2 items-center mt-1">
                                <input
                                    type="color"
                                    value={novoCargo.cor}
                                    onChange={(e) => setNovoCargo(prev => ({ ...prev, cor: e.target.value }))}
                                    className="w-10 h-10 rounded cursor-pointer border"
                                />
                                <span className="text-sm text-gray-500">Cor exibida no card do cargo</span>
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="descricao-cargo">Descrição (opcional)</Label>
                            <Input
                                id="descricao-cargo"
                                value={novoCargo.descricao}
                                onChange={(e) => setNovoCargo(prev => ({ ...prev, descricao: e.target.value }))}
                                placeholder="Responsabilidades principais..."
                                maxLength={120}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCriarCargoOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => createCargoMutation.mutate(novoCargo)}
                            disabled={!novoCargo.nome.trim() || createCargoMutation.isPending}
                            style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
                        >
                            {createCargoMutation.isPending && (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            )}
                            Criar Cargo
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Modal: Confirmar Exclusão ── */}
            <Dialog open={!!confirmarExcluir} onOpenChange={() => setConfirmarExcluir(null)}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Excluir Cargo</DialogTitle>
                        <DialogDescription>
                            Tem certeza que deseja excluir o cargo{' '}
                            <strong>&quot;{confirmarExcluir}&quot;</strong>?
                            Usuários com este cargo perderão as permissões associadas.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmarExcluir(null)}>
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteCargoMutation.mutate(confirmarExcluir)}
                            disabled={deleteCargoMutation.isPending}
                        >
                            {deleteCargoMutation.isPending && (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            )}
                            Excluir
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Modal: Editar Permissões do Cargo ── */}
            {editingCargo && (
                <RolePermissionEditorModal
                    cargo={editingCargo.value}
                    cargoLabel={editingCargo.label}
                    cargoColor={editingCargo.color}
                    currentPermissions={getCargoPermissions(editingCargo.value)}
                    currentDenied={getCargoDenied(editingCargo.value)}
                    currentScope={editingCargo.scope}
                    isCustomCargo={editingCargo.isCustom}
                    onClose={() => setEditingCargo(null)}
                    onSave={handleSavePermissions}
                    isSaving={savePermissionsMutation.isPending}
                />
            )}
        </div>
    );
}

