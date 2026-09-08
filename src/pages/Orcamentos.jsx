import { identityKey } from '@/utils/identityStorage';
import React, { useState, useEffect } from "react";
import { base44, supabase } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Filter, FileText, Trash2, Edit, Loader2, ArrowRight, Printer, AlertTriangle } from "lucide-react";
import OrcamentoModal from "../components/orcamentos/OrcamentoModal";
import { useConfirm } from "@/hooks/useConfirm";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";
import { formatarTelefone, formatarNome } from "@/utils/formatters";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/contexts/TenantContext";
import { formatarDataExibicao } from "@/utils/dateUtils";


export default function Orcamentos() {
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [fornecedorFilter, setFornecedorFilter] = useState("all");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingOrcamento, setEditingOrcamento] = useState(null);
    const queryClient = useQueryClient();
    const confirm = useConfirm();
    const navigate = useNavigate();
    const { user, filterData } = useAuth();
    const { brandName, lojas } = useTenant();
    const [generatingPdfId, setGeneratingPdfId] = useState(null);

    const handleGerarPDF = async (orcamento) => {
        setGeneratingPdfId(orcamento.id);
        try {
            const orcamentoFull = await base44.entities.Orcamento.getById(orcamento.id);
            const { abrirOrcamentoPDF } = await import("../utils/orcamentoPDF");
            
            const sellerId = orcamentoFull.vendedor_id;
            const seller = sellerId ? users.find(u => u.id === sellerId) : null;
            const sellerName = seller?.full_name || seller?.email || user?.full_name || user?.nome || '';
            
            const cliente = clientes.find(c => c.id === orcamentoFull.cliente_id);
            if (cliente) {
                orcamentoFull.endereco = cliente.endereco || orcamentoFull.endereco || '';
                orcamentoFull.bairro = cliente.bairro || orcamentoFull.bairro || '';
                orcamentoFull.cidade = cliente.cidade || orcamentoFull.cidade || '';
            }
            
            const lojaInfoPdf = lojas.find(l => String(l.nome).trim().toLowerCase() === String(orcamentoFull.loja || '').trim().toLowerCase()) || null;
            abrirOrcamentoPDF(orcamentoFull, sellerName, lojaInfoPdf ? { ...lojaInfoPdf, empresa_nome: brandName } : null);
            toast.success("PDF gerado com sucesso!");
        } catch (err) {
            console.error(err);
            toast.error("Erro ao gerar PDF do orçamento.");
        } finally {
            setGeneratingPdfId(null);
        }
    };

    const checkExpirado = (orcamento) => {
        if (!orcamento.validade) return false;
        try {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const dataString = String(orcamento.validade).split('T')[0].replace(/-/g, '/');
            const dataValidade = new Date(dataString);
            dataValidade.setHours(0, 0, 0, 0);
            return hoje.getTime() > dataValidade.getTime();
        } catch (e) {
            return false;
        }
    };

    const handleConverterVenda = async (orcamento) => {
        try {
            const orcamentoFull = await base44.entities.Orcamento.getById(orcamento.id);
            const cliente = clientes.find(c => c.id === orcamentoFull.cliente_id);
            const pdvState = {
                cliente_id: orcamentoFull.cliente_id,
                orcamento_id: orcamentoFull.id,
                itens: (orcamentoFull.itens || []).map(item => ({
                    ...item,
                    preco_sugerido: item.preco_sugerido || item.preco_unitario,
                    tipo_entrega: item.tipo_entrega || null,
                    is_encomenda: item.is_encomenda || false,
                    tipo_montagem_padrao: item.tipo_montagem_padrao || null
                })),
                desconto: parseFloat(orcamentoFull.desconto) || 0,
                pagamentos: orcamentoFull.pagamentos || [],
                observacoes: orcamentoFull.observacoes || "",
                loja: orcamentoFull.loja || "",
                cidade: cliente?.cidade || orcamentoFull.cidade || "",
                bairro: cliente?.bairro || orcamentoFull.bairro || "",
                endereco: cliente?.endereco || orcamentoFull.endereco || "",
                valor_frete: parseFloat(orcamentoFull.valor_frete) || 0,
                selectedVendedorId: orcamentoFull.vendedor_id || null
            };
            // Marcar o orçamento como Convertido para impedir dupla conversão
            await base44.entities.Orcamento.update(orcamentoFull.id, { status: 'Convertido' });
            queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
            const { data: { session: pdvSession } } = await supabase.auth.getSession();
            const { data: pdvProfile, error: pdvProfileError } = await supabase.from('public_users').select('organization_id').eq('id', pdvSession?.user?.id).single();
            if (pdvProfileError || !pdvProfile?.organization_id) throw new Error('Organização indisponível');
            sessionStorage.setItem(identityKey('moveispedroii_pdv_state', pdvProfile.organization_id, pdvSession.user.id), JSON.stringify(pdvState));
            // Disparar evento customizado para o PDV detectar (SPA)
            window.dispatchEvent(new Event('orcamento-para-pdv'));
            navigate(createPageUrl("PDV"));
            toast.success("Orçamento transferido para o PDV!");
        } catch (err) {
            console.error(err);
            toast.error("Erro ao carregar orçamento para o PDV.");
        }
    };
    const { data: orcamentos = [], isLoading } = useQuery({
        queryKey: ['orcamentos'],
        queryFn: () => base44.entities.Orcamento.list('-created_date'),
    });

    const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
    const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });
    const { data: fornecedores = [] } = useQuery({ queryKey: ['fornecedores'], queryFn: () => base44.entities.Fornecedor.list('nome_empresa') });
    const { data: users = [] } = useQuery({ queryKey: ['users_list'], queryFn: () => base44.entities.User.list() });

    const produtosById = produtos.reduce((acc, produto) => {
        acc[String(produto.id)] = produto;
        return acc;
    }, {});

    useEffect(() => {
        const channel = supabase
            .channel('orcamentos-produtos-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'produtos' },
                () => {
                    queryClient.invalidateQueries({ queryKey: ['produtos'] });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [queryClient]);

    const createMutation = useMutation({
        mutationFn: (data) => base44.entities.Orcamento.create(data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orcamentos'] }); setIsModalOpen(false); setEditingOrcamento(null); }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.Orcamento.update(id, data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orcamentos'] }); setIsModalOpen(false); setEditingOrcamento(null); }
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.Orcamento.delete(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orcamentos'] })
    });

    // Filtra orçamentos pelo escopo do usuário (Admin=todos, Gerente=loja, Vendedor=próprios)
    const orcamentosPermitidos = filterData(orcamentos, {
        userField: 'vendedor_id',
        lojaField: 'loja'
    });

    const filtered = orcamentosPermitidos.filter(orc => {
        const matchesSearch = orc.numero_orcamento?.toLowerCase().includes(searchTerm.toLowerCase()) || orc.cliente_nome?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === "all" || orc.status === statusFilter;
        const matchesFornecedor = fornecedorFilter === "all" || (orc.itens || []).some((item) => {
            const produto = produtosById[String(item.produto_id)];
            return String(produto?.fornecedor_id || "") === fornecedorFilter;
        });
        return matchesSearch && matchesStatus && matchesFornecedor;
    });

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex justify-end items-center">
                <Button
                    onClick={() => { setEditingOrcamento(null); setIsModalOpen(true); }}
                    className="bg-green-700 hover:bg-green-800 text-white font-medium"
                >
                    <Plus className="w-4 h-4 mr-2" /> Novo Orçamento
                </Button>
            </div>

            <div className="flex gap-4 items-center bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                        placeholder="Buscar por número ou cliente..."
                        className="pl-9 border-gray-200 dark:border-neutral-700"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <Select value={fornecedorFilter} onValueChange={(value) => setFornecedorFilter(String(value))}>
                    <SelectTrigger className="w-[220px] border-gray-200 dark:border-neutral-700">
                        <div className="flex items-center gap-2 text-gray-500">
                            <Filter className="w-4 h-4" />
                            <SelectValue placeholder="Fornecedor" />
                        </div>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os Fornecedores</SelectItem>
                        {fornecedores.map(f => (
                            <SelectItem key={f.id} value={String(f.id)}>{f.nome_empresa}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[200px] border-gray-200 dark:border-neutral-700">
                        <div className="flex items-center gap-2 text-gray-500">
                            <Filter className="w-4 h-4" />
                            <SelectValue placeholder="Status" />
                        </div>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os Status</SelectItem>
                        <SelectItem value="Pendente">Pendente</SelectItem>
                        <SelectItem value="Aprovado">Aprovado</SelectItem>
                        <SelectItem value="Rejeitado">Rejeitado</SelectItem>
                        <SelectItem value="Convertido">Convertido</SelectItem>
                        <SelectItem value="Expirado">Expirado</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800 overflow-hidden">
                <Table>
                    <TableHeader className="bg-gray-50 dark:bg-neutral-950">
                        <TableRow>
                            <TableHead>Número</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Vendedor</TableHead>
                            <TableHead>Emissão</TableHead>
                            <TableHead>Validade</TableHead>
                            <TableHead>Total</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></TableCell></TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">Nenhum orçamento encontrado.</TableCell></TableRow>
                        ) : (
                            filtered.map(orc => {
                                const expirado = checkExpirado(orc);
                                return (
                                <TableRow key={orc.id}>
                                    <TableCell className="font-medium">#{orc.numero_orcamento}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-medium text-gray-900 dark:text-white">{formatarNome(orc.cliente_nome)}</span>
                                            <span className="text-xs text-gray-500">{formatarTelefone(orc.cliente_telefone)}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {(() => {
                                            const seller = orc.vendedor_id ? users.find(u => u.id === orc.vendedor_id) : null;
                                            const nome = seller?.full_name || seller?.email || null;
                                            return nome ? (
                                                <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{nome}</span>
                                            ) : (
                                                <span className="text-xs text-gray-400">—</span>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">{formatarDataExibicao(orc.data_orcamento)}</span>
                                            <span className="text-xs text-gray-400">{new Date(orc.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {orc.validade ? (
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-sm ${expirado ? 'text-red-600 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                                                    {formatarDataExibicao(orc.validade)}
                                                </span>
                                                {expirado && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-400">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="font-bold text-gray-900 dark:text-white">R$ {orc.valor_total?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                                    <TableCell><StatusBadge status={expirado && orc.status === 'Pendente' ? 'Expirado' : orc.status} /></TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleGerarPDF(orc)}
                                                disabled={generatingPdfId !== null}
                                                title="Gerar PDF"
                                            >
                                                {generatingPdfId === orc.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                                                ) : (
                                                    <Printer className="w-4 h-4 text-gray-600 hover:text-gray-800" />
                                                )}
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => { setEditingOrcamento(orc); setIsModalOpen(true); }} title="Editar">
                                                <Edit className="w-4 h-4 text-blue-600" />
                                            </Button>
                                            <Button variant="ghost" size="icon" title="Excluir" onClick={async () => {
                                                const confirmed = await confirm({
                                                    title: "Excluir Orçamento",
                                                    message: "Tem certeza que deseja excluir este orçamento?",
                                                    confirmText: "Excluir",
                                                    variant: "destructive"
                                                });
                                                if (confirmed) deleteMutation.mutate(orc.id);
                                            }}>
                                                <Trash2 className="w-4 h-4 text-red-600" />
                                            </Button>
                                            {orc.status === 'Pendente' && !expirado && (
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleConverterVenda(orc)}
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-3 text-xs gap-1"
                                                >
                                                    <ArrowRight className="w-3.5 h-3.5" />
                                                    Venda
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <OrcamentoModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setEditingOrcamento(null); }}
                onSave={(data) => editingOrcamento ? updateMutation.mutate({ id: editingOrcamento.id, data }) : createMutation.mutate(data)}
                orcamento={editingOrcamento}
                clientes={clientes}
                produtos={produtos}
                fornecedores={fornecedores}
                fornecedorSelecionado={fornecedorFilter}
                isLoading={createMutation.isPending || updateMutation.isPending}
            />
        </div>
    );
}

function StatusBadge({ status }) {
    const styles = {
        "Aprovado": "bg-green-100 text-green-800 border-green-200",
        "Convertido": "bg-blue-100 text-blue-800 border-blue-200",
        "Pendente": "bg-yellow-100 text-yellow-800 border-yellow-200",
        "Rejeitado": "bg-red-100 text-red-800 border-red-200",
        "Expirado": "bg-gray-100 text-gray-800 border-gray-200"
    };
    return <Badge className={`${styles[status] || "bg-gray-100 text-gray-800"} border px-2 py-0.5 text-[10px] uppercase tracking-wider`}>{status}</Badge>;
}