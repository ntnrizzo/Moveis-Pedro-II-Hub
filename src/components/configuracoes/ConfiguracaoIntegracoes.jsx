import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Key,
    Eye,
    EyeOff,
    Save,
    Loader2,
    Search,
    Sparkles,
    ExternalLink,
    Brain
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function ConfiguracaoIntegracoes() {
    const queryClient = useQueryClient();
    const [showKey, setShowKey] = useState({});

    const toggleShowKey = (key) => {
        setShowKey(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const [formData, setFormData] = useState({
        google_api_key: "",
        google_cse_id: ""
    });

    // Buscar configuração existente
    const { data: config, isLoading } = useQuery({
        queryKey: ['config-integracoes'],
        queryFn: async () => {
            const configs = await base44.entities.ConfiguracaoSistema.list();
            return configs.find(c => c.tipo === 'integracoes') || null;
        }
    });

    // Preencher campos
    useEffect(() => {
        if (config?.dados) {
            setFormData({
                google_api_key: config.dados.google_api_key || "",
                google_cse_id: config.dados.google_cse_id || ""
            });
        }
    }, [config]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // Mutation para salvar
    const saveMutation = useMutation({
        mutationFn: async (dados) => {
            if (config?.id) {
                return base44.entities.ConfiguracaoSistema.update(config.id, { dados });
            } else {
                return base44.entities.ConfiguracaoSistema.create({
                    tipo: 'integracoes',
                    nome: 'Configurações de Integrações',
                    dados
                });
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['config-integracoes'] });
            toast.success("Configurações atualizadas com sucesso!");
        },
        onError: (error) => {
            console.error("Erro ao salvar:", error);
            toast.error("Erro ao salvar configurações");
        }
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Brain className="w-8 h-8 text-purple-600" />
                    Central de Inteligência e Integrações
                </h2>
                <p className="text-gray-500 mt-1">Conecte seu sistema aos serviços de IA e busca do Google Cloud.</p>
            </div>

            {/* Google Ecosystem Card */}
            <Card className="border-t-4 border-t-blue-500 shadow-sm">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-xl flex items-center gap-2">
                                Google Cloud Services
                            </CardTitle>
                            <CardDescription>
                                Configure a busca de imagens de produtos.
                            </CardDescription>
                        </div>
                        <div className="flex gap-2">
                            {formData.google_api_key && <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Search Ativo</Badge>}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">

                    {/* Seção 1: Busca e Imagens */}
                    <div className="grid md:grid-cols-2 gap-6 p-4 bg-gray-50 rounded-lg border border-gray-100">
                        <div className="col-span-2">
                            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                                <Search className="w-4 h-4 text-blue-600" />
                                Motor de Busca (Custom Search)
                            </h3>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="google_key">Google API Key (Search)</Label>
                            <div className="relative">
                                <Input
                                    id="google_key"
                                    type={showKey.google ? "text" : "password"}
                                    value={formData.google_api_key}
                                    onChange={(e) => handleChange('google_api_key', e.target.value)}
                                    placeholder="AIza..."
                                    className="pr-10 bg-white"
                                />
                                <button
                                    type="button"
                                    onClick={() => toggleShowKey('google')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    {showKey.google ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            <p className="text-xs text-gray-500">Usada para buscar imagens de produtos automaticamente.</p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="cse_id">Search Engine ID (CSE)</Label>
                            <Input
                                id="cse_id"
                                value={formData.google_cse_id}
                                onChange={(e) => handleChange('google_cse_id', e.target.value)}
                                placeholder="01757666...:aaaaa"
                                className="bg-white"
                            />
                            <p className="text-xs text-gray-500">ID do mecanismo de busca programável.</p>
                        </div>
                    </div>

                </CardContent>
            </Card>

            {/* Barra de Ação Fixa ou no Fluxo */}
            <div className="flex justify-end pt-4 border-t">
                <Button
                    onClick={() => saveMutation.mutate(formData)}
                    disabled={saveMutation.isPending}
                    className="bg-green-600 hover:bg-green-700 min-w-[150px]"
                >
                    {saveMutation.isPending ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Salvando...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4 mr-2" />
                            Salvar Alterações
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}
