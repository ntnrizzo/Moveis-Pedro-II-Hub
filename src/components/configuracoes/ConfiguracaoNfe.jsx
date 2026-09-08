import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Building2, Save, Edit, AlertCircle, Search, Loader2
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/contexts/TenantContext";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

// Formatação de CNPJ para exibição
const formatarCnpj = (cnpj) => {
    if (!cnpj) return '';
    const digits = cnpj.replace(/\D/g, '');
    if (digits.length !== 14) return cnpj;
    return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12,14)}`;
};

const REGIMES_TRIBUTARIOS = [
    { value: "1", label: "Simples Nacional" },
    { value: "2", label: "Simples Nacional - Excesso de sublimite" },
    { value: "3", label: "Regime Normal (Lucro Presumido/Real)" },
];

// Lê do localStorage como fallback (dados legados)
const carregarDadosFiscaisLocal = () => {
    try {
        const dados = localStorage.getItem("nfe_empresas_fiscais");
        return dados ? JSON.parse(dados) : {};
    } catch {
        return {};
    }
};

// Mapeia config do banco → objeto empresa para exibição
const dbConfigParaEmpresa = (config) => ({
    cnpj: (config.emitente_cnpj || '').replace(/\D/g, ''),
    nome: config.emitente_nome || 'Empresa não configurada',
    cnpjFormatado: formatarCnpj(config.emitente_cnpj),
    email: config.emitente_email || '',
});

// Mapeia colunas do banco → objeto formEmpresa
const dbConfigParaForm = (config) => ({
    ie: config.emitente_ie || "",
    regimeTributario: String(config.emitente_crt || "1"),
    logradouro: config.emitente_logradouro || "",
    numero: config.emitente_numero || "",
    complemento: config.emitente_complemento || "",
    bairro: config.emitente_bairro || "",
    municipio: config.emitente_municipio || "",
    codigoMunicipio: config.emitente_codigo_municipio || "",
    uf: config.emitente_uf || "ES",
    cep: config.emitente_cep || "",
});

export default function ConfiguracaoNfe() {
    const { organization } = useTenant();
    const orgId = organization?.id || DEFAULT_ORG_ID;

    // Empresa emissora carregada do banco para este tenant
    const [empresaEmissora, setEmpresaEmissora] = useState(null);
    const [empresaPadrao, setEmpresaPadrao] = useState(() => {
        return localStorage.getItem("nfe_empresa_padrao") || '';
    });

    const [dadosFiscais, setDadosFiscais] = useState(carregarDadosFiscaisLocal);
    const [editandoEmpresa, setEditandoEmpresa] = useState(null);
    const [formEmpresa, setFormEmpresa] = useState({});
    const [highlightEmitente, setHighlightEmitente] = useState(false);
    const [savingDb, setSavingDb] = useState(false);
    // ─── Padrões Fiscais (org-level defaults) ────────────────────────────────
    const [fiscalDefaults, setFiscalDefaults] = useState({
        csosn_padrao: '102',
        cst_icms_padrao: '00',
        cst_pis_padrao: '49',
        cst_cofins_padrao: '49',
        aliquota_icms_padrao: '17.00',
        aliquota_icms_interestadual_padrao: '12.00',
        aliquota_pis_padrao: '0.65',
        aliquota_cofins_padrao: '3.00',
        percentual_tributos_padrao: '17.00',
        mod_frete_padrao: '9',
    });
    const [savingFiscal, setSavingFiscal] = useState(false);
    const [fiscalLoaded, setFiscalLoaded] = useState(false);

    // Check for highlight signal from EmitirNFeModal
    useEffect(() => {
        const signal = localStorage.getItem('nfe_highlight_emitente');
        if (signal === '1') {
            localStorage.removeItem('nfe_highlight_emitente');
            setHighlightEmitente(true);
        }
    }, []);

    // ─── Carregar emitente ativo do banco ────────────────────────────────────
    useEffect(() => {
        async function carregarDoDb() {
            const { data, error } = await supabase
                .from('organization_nfe_configs')
                .select('emitente_cnpj, emitente_nome, emitente_ie, emitente_uf, emitente_crt, emitente_logradouro, emitente_numero, emitente_complemento, emitente_bairro, emitente_municipio, emitente_cep, emitente_codigo_municipio, emitente_email, csosn_padrao, cst_icms_padrao, cst_pis_padrao, cst_cofins_padrao, aliquota_icms_padrao, aliquota_icms_interestadual_padrao, aliquota_pis_padrao, aliquota_cofins_padrao, percentual_tributos_padrao, mod_frete_padrao')
                .eq('organization_id', orgId)
                .maybeSingle();

            if (error || !data) return;

            // Padrões Fiscais
            setFiscalDefaults(prev => ({
                csosn_padrao: data.csosn_padrao || prev.csosn_padrao,
                cst_icms_padrao: data.cst_icms_padrao || prev.cst_icms_padrao,
                cst_pis_padrao: data.cst_pis_padrao || prev.cst_pis_padrao,
                cst_cofins_padrao: data.cst_cofins_padrao || prev.cst_cofins_padrao,
                aliquota_icms_padrao: data.aliquota_icms_padrao != null ? String(data.aliquota_icms_padrao) : prev.aliquota_icms_padrao,
                aliquota_icms_interestadual_padrao: data.aliquota_icms_interestadual_padrao != null ? String(data.aliquota_icms_interestadual_padrao) : prev.aliquota_icms_interestadual_padrao,
                aliquota_pis_padrao: data.aliquota_pis_padrao != null ? String(data.aliquota_pis_padrao) : prev.aliquota_pis_padrao,
                aliquota_cofins_padrao: data.aliquota_cofins_padrao != null ? String(data.aliquota_cofins_padrao) : prev.aliquota_cofins_padrao,
                percentual_tributos_padrao: data.percentual_tributos_padrao != null ? String(data.percentual_tributos_padrao) : prev.percentual_tributos_padrao,
                mod_frete_padrao: data.mod_frete_padrao != null ? String(data.mod_frete_padrao) : prev.mod_frete_padrao,
            }));
            setFiscalLoaded(true);

            // Montar objeto empresa emissora a partir do banco
            const empresa = dbConfigParaEmpresa(data);
            setEmpresaEmissora(empresa);

            const { emitente_cnpj } = data;
            if (!emitente_cnpj) return;

            // Empresa padrão vem do banco
            const cnpjLimpo = emitente_cnpj.replace(/\D/g, '');
            setEmpresaPadrao(cnpjLimpo);
            localStorage.setItem("nfe_empresa_padrao", cnpjLimpo);

            // Dados fiscais come do banco (sobrescreve localStorage para esta empresa)
            setDadosFiscais(prev => ({
                ...prev,
                [cnpjLimpo]: dbConfigParaForm(data),
            }));
        }

        carregarDoDb();
    }, [orgId]);

    // Helper: upsert emitente no banco
    const salvarEmitenteNoBanco = async (empresa, form) => {
        const cnpjLimpo = empresa.cnpj.replace(/\D/g, '');
        const upsertData = {
            emitente_cnpj: cnpjLimpo,
            emitente_nome: empresa.nome,
            emitente_ie: form.ie || null,
            emitente_uf: form.uf || 'ES',
            emitente_crt: parseInt(form.regimeTributario || '1'),
            emitente_logradouro: form.logradouro || null,
            emitente_numero: form.numero || null,
            emitente_bairro: form.bairro || null,
            emitente_municipio: form.municipio || null,
            emitente_cep: (form.cep || '').replace(/\D/g, '') || null,
            emitente_codigo_municipio: form.codigoMunicipio || null,
        };

        // Atualiza todos os rows da org (homologação + produção)
        const { error } = await supabase
            .from('organization_nfe_configs')
            .update(upsertData)
            .eq('organization_id', orgId);

        return error;
    };

    const abrirEdicaoEmpresa = (empresa) => {
        const cnpj = empresa?.cnpj || empresaPadrao;
        const dados = dadosFiscais[cnpj] || {};
        setFormEmpresa({
            ie: dados.ie || "",
            regimeTributario: dados.regimeTributario || "1",
            logradouro: dados.logradouro || "",
            numero: dados.numero || "",
            complemento: dados.complemento || "",
            bairro: dados.bairro || "",
            municipio: dados.municipio || "",
            codigoMunicipio: dados.codigoMunicipio || "",
            uf: dados.uf || "ES",
            cep: dados.cep || "",
        });
        setEditandoEmpresa(empresa || empresaEmissora);
    };

    const formatarTexto = (valor) => {
        if (!valor) return "";
        return valor.toLowerCase().replace(/(?:^|\s|["'([{])+\S/g, match => match.toUpperCase());
    };

    const buscarCEP = async (cep) => {
        if (!cep) return;
        const cepLimpo = cep.replace(/\D/g, '');
        if (cepLimpo.length !== 8) return;

        const toastId = toast.loading("Buscando CEP...");

        try {
            const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
            const data = await response.json();

            if (!data.erro) {
                const novoEndereco = {
                    logradouro: formatarTexto(data.logradouro || ""),
                    bairro: formatarTexto(data.bairro || ""),
                    municipio: formatarTexto(data.localidade || ""),
                    uf: data.uf || "",
                    codigoMunicipio: data.ibge || ""
                };

                setFormEmpresa(prev => ({
                    ...prev,
                    ...novoEndereco
                }));

                toast.success("Endereço encontrado e preenchido!", { id: toastId });
            } else {
                toast.error("CEP não encontrado.", { id: toastId });
            }
        } catch (error) {
            toast.error("Erro ao buscar CEP.", { id: toastId });
        }
    };

    const buscarCNPJ = async (cnpj) => {
        const cnpjLimpo = cnpj.replace(/\D/g, '');
        if (cnpjLimpo.length !== 14) return;

        try {
            const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
            const data = await response.json();

            let regime = "1";
            if (data.opcao_pelo_simples === false) {
                regime = "3";
            }

            setFormEmpresa(prev => ({
                ...prev,
                municipio: formatarTexto(data.municipio || ""),
                codigoMunicipio: data.codigo_municipio_ibge || "",
                uf: data.uf || "",
                logradouro: formatarTexto(data.logradouro || ""),
                numero: data.numero || "",
                complemento: formatarTexto(data.complemento || ""),
                bairro: formatarTexto(data.bairro || ""),
                cep: data.cep?.replace(/\D/g, '') || "",
                regimeTributario: regime
            }));
            toast.success("Dados carregados!");
        } catch (error) {
            toast.error("Erro ao buscar CNPJ.");
        }
    };

    const salvarDadosEmpresa = async () => {
        if (!editandoEmpresa) return;

        // 1. Atualiza state local + localStorage (backward compat)
        const novosDados = { ...dadosFiscais, [editandoEmpresa.cnpj]: formEmpresa };
        setDadosFiscais(novosDados);
        localStorage.setItem("nfe_empresas_fiscais", JSON.stringify(novosDados));

        // 2. Se for a empresa padrão, persiste no banco
        if (editandoEmpresa.cnpj === empresaPadrao) {
            setSavingDb(true);
            try {
                const err = await salvarEmitenteNoBanco(editandoEmpresa, formEmpresa);
                if (err) {
                    console.error('[ConfiguracaoNfe] Erro ao salvar no banco:', err);
                    toast.warning(`Dados salvos localmente, mas não foi possível salvar no banco: ${err.message}`);
                } else {
                    toast.success(`Dados de ${editandoEmpresa.nome} salvos!`);
                }
            } finally {
                setSavingDb(false);
            }
        } else {
            toast.success(`Dados de ${editandoEmpresa.nome} salvos!`);
        }

        setEditandoEmpresa(null);
    };

    const getStatusEmpresa = (cnpj) => {
        const dados = dadosFiscais[cnpj];
        if (!dados?.ie || !dados?.logradouro) {
            return { ok: false, msg: "Incompleto" };
        }
        return { ok: true, msg: "Configurado" };
    };

    // ─── Salvar Padrões Fiscais ─────────────────────────────────────────────
    const handleSalvarFiscalDefaults = async () => {
        setSavingFiscal(true);
        try {
            const updateData = {
                csosn_padrao: fiscalDefaults.csosn_padrao || null,
                cst_icms_padrao: fiscalDefaults.cst_icms_padrao || null,
                cst_pis_padrao: fiscalDefaults.cst_pis_padrao || null,
                cst_cofins_padrao: fiscalDefaults.cst_cofins_padrao || null,
                aliquota_icms_padrao: fiscalDefaults.aliquota_icms_padrao ? parseFloat(fiscalDefaults.aliquota_icms_padrao) : null,
                aliquota_icms_interestadual_padrao: fiscalDefaults.aliquota_icms_interestadual_padrao ? parseFloat(fiscalDefaults.aliquota_icms_interestadual_padrao) : null,
                aliquota_pis_padrao: fiscalDefaults.aliquota_pis_padrao ? parseFloat(fiscalDefaults.aliquota_pis_padrao) : null,
                aliquota_cofins_padrao: fiscalDefaults.aliquota_cofins_padrao ? parseFloat(fiscalDefaults.aliquota_cofins_padrao) : null,
                percentual_tributos_padrao: fiscalDefaults.percentual_tributos_padrao ? parseFloat(fiscalDefaults.percentual_tributos_padrao) : null,
                mod_frete_padrao: fiscalDefaults.mod_frete_padrao != null ? parseInt(fiscalDefaults.mod_frete_padrao) : null,
            };

            const { error } = await supabase
                .from('organization_nfe_configs')
                .update(updateData)
                .eq('organization_id', orgId);

            if (error) throw error;
            toast.success('Padrões fiscais salvos com sucesso!');
        } catch (err) {
            toast.error('Erro ao salvar padrões fiscais: ' + err.message);
        } finally {
            setSavingFiscal(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Building2 className="w-8 h-8 text-green-600" />
                    Dados Fiscais das Empresas
                </h2>
                <p className="text-gray-500 mt-1">Gerencie os dados fiscais obrigatórios para cada CNPJ emissor.</p>
            </div>

            {/* ─── Padrões fiscais da empresa ───────────────── */}
            <Card className="border-t-4 border-t-amber-500 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-600" />
                        Padrões fiscais da empresa
                    </CardTitle>
                    <CardDescription>
                        Valores padrão de CSOSN/CST, alíquotas e tributação usados na emissão. Produtos com valores próprios terão prioridade.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {(() => {
                        const crtAtual = dadosFiscais[empresaPadrao]?.regimeTributario || '1';
                        const isSimplesNacional = crtAtual === '1' || crtAtual === '2';

                        return (
                            <>
                                {/* CSOSN ou CST ICMS dependendo do regime */}
                                <div>
                                    <h4 className="font-medium text-gray-700 mb-3">
                                        {isSimplesNacional ? 'ICMS - Simples Nacional' : 'ICMS - Regime Normal'}
                                    </h4>
                                    <div className="grid md:grid-cols-3 gap-4">
                                        {isSimplesNacional ? (
                                            <div>
                                                <Label>CSOSN Padrão</Label>
                                                <Select
                                                    value={fiscalDefaults.csosn_padrao}
                                                    onValueChange={(v) => setFiscalDefaults(prev => ({ ...prev, csosn_padrao: v }))}
                                                >
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="102">102 - Tributada sem permissão de crédito</SelectItem>
                                                        <SelectItem value="103">103 - Isenção do ICMS (faixa SN)</SelectItem>
                                                        <SelectItem value="300">300 - Imune</SelectItem>
                                                        <SelectItem value="400">400 - Não tributada</SelectItem>
                                                        <SelectItem value="500">500 - ICMS cobrado por ST</SelectItem>
                                                        <SelectItem value="900">900 - Outros</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        ) : (
                                            <>
                                                <div>
                                                    <Label>CST ICMS Padrão</Label>
                                                    <Select
                                                        value={fiscalDefaults.cst_icms_padrao}
                                                        onValueChange={(v) => setFiscalDefaults(prev => ({ ...prev, cst_icms_padrao: v }))}
                                                    >
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="00">00 - Tributada integralmente</SelectItem>
                                                            <SelectItem value="10">10 - Tributada com ST</SelectItem>
                                                            <SelectItem value="20">20 - Com redução de base</SelectItem>
                                                            <SelectItem value="40">40 - Isenta</SelectItem>
                                                            <SelectItem value="41">41 - Não tributada</SelectItem>
                                                            <SelectItem value="60">60 - ICMS cobrado por ST</SelectItem>
                                                            <SelectItem value="90">90 - Outros</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div>
                                                    <Label>Alíquota ICMS (%)</Label>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        value={fiscalDefaults.aliquota_icms_padrao}
                                                        onChange={(e) => setFiscalDefaults(prev => ({ ...prev, aliquota_icms_padrao: e.target.value }))}
                                                        placeholder="17.00"
                                                    />
                                                </div>
                                                <div>
                                                    <Label>Alíquota Interestadual (%)</Label>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        value={fiscalDefaults.aliquota_icms_interestadual_padrao}
                                                        onChange={(e) => setFiscalDefaults(prev => ({ ...prev, aliquota_icms_interestadual_padrao: e.target.value }))}
                                                        placeholder="12.00"
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* PIS / COFINS */}
                                <div className="border-t pt-4">
                                    <h4 className="font-medium text-gray-700 mb-3">PIS / COFINS</h4>
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <div>
                                            <Label>CST PIS Padrão</Label>
                                            <Select
                                                value={fiscalDefaults.cst_pis_padrao}
                                                onValueChange={(v) => setFiscalDefaults(prev => ({ ...prev, cst_pis_padrao: v }))}
                                            >
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {isSimplesNacional ? (
                                                        <>
                                                            <SelectItem value="49">49 - Outras saídas (SN)</SelectItem>
                                                            <SelectItem value="99">99 - Outras operações</SelectItem>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <SelectItem value="01">01 - Tributável (alíquota normal)</SelectItem>
                                                            <SelectItem value="04">04 - Monofásica (alíquota zero)</SelectItem>
                                                            <SelectItem value="06">06 - Alíquota zero</SelectItem>
                                                            <SelectItem value="07">07 - Isenta</SelectItem>
                                                            <SelectItem value="08">08 - Sem incidência</SelectItem>
                                                            <SelectItem value="09">09 - Com suspensão</SelectItem>
                                                            <SelectItem value="49">49 - Outras saídas</SelectItem>
                                                            <SelectItem value="99">99 - Outras operações</SelectItem>
                                                        </>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <Label>CST COFINS Padrão</Label>
                                            <Select
                                                value={fiscalDefaults.cst_cofins_padrao}
                                                onValueChange={(v) => setFiscalDefaults(prev => ({ ...prev, cst_cofins_padrao: v }))}
                                            >
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {isSimplesNacional ? (
                                                        <>
                                                            <SelectItem value="49">49 - Outras saídas (SN)</SelectItem>
                                                            <SelectItem value="99">99 - Outras operações</SelectItem>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <SelectItem value="01">01 - Tributável (alíquota normal)</SelectItem>
                                                            <SelectItem value="04">04 - Monofásica (alíquota zero)</SelectItem>
                                                            <SelectItem value="06">06 - Alíquota zero</SelectItem>
                                                            <SelectItem value="07">07 - Isenta</SelectItem>
                                                            <SelectItem value="08">08 - Sem incidência</SelectItem>
                                                            <SelectItem value="09">09 - Com suspensão</SelectItem>
                                                            <SelectItem value="49">49 - Outras saídas</SelectItem>
                                                            <SelectItem value="99">99 - Outras operações</SelectItem>
                                                        </>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    {!isSimplesNacional && (
                                        <div className="grid md:grid-cols-2 gap-4 mt-4">
                                            <div>
                                                <Label>Alíquota PIS (%)</Label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={fiscalDefaults.aliquota_pis_padrao}
                                                    onChange={(e) => setFiscalDefaults(prev => ({ ...prev, aliquota_pis_padrao: e.target.value }))}
                                                    placeholder="0.65"
                                                />
                                            </div>
                                            <div>
                                                <Label>Alíquota COFINS (%)</Label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={fiscalDefaults.aliquota_cofins_padrao}
                                                    onChange={(e) => setFiscalDefaults(prev => ({ ...prev, aliquota_cofins_padrao: e.target.value }))}
                                                    placeholder="3.00"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Tributos Aproximados + Frete */}
                                <div className="border-t pt-4">
                                    <h4 className="font-medium text-gray-700 mb-3">Outros Padrões</h4>
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <div>
                                            <Label>Percentual Tributos Aprox. (%)</Label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={fiscalDefaults.percentual_tributos_padrao}
                                                onChange={(e) => setFiscalDefaults(prev => ({ ...prev, percentual_tributos_padrao: e.target.value }))}
                                                placeholder="17.00"
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Lei da Transparência (12.741/2012) - valor informado ao consumidor</p>
                                        </div>
                                        <div>
                                            <Label>Modalidade de Frete Padrão</Label>
                                            <Select
                                                value={fiscalDefaults.mod_frete_padrao}
                                                onValueChange={(v) => setFiscalDefaults(prev => ({ ...prev, mod_frete_padrao: v }))}
                                            >
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="0">0 - CIF (emitente)</SelectItem>
                                                    <SelectItem value="1">1 - FOB (destinatário)</SelectItem>
                                                    <SelectItem value="2">2 - Terceiros</SelectItem>
                                                    <SelectItem value="3">3 - Próprio por conta do remetente</SelectItem>
                                                    <SelectItem value="4">4 - Próprio por conta do destinatário</SelectItem>
                                                    <SelectItem value="9">9 - Sem frete</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>

                                {/* Botão Salvar */}
                                <div className="flex items-center gap-3 pt-2">
                                    <Button onClick={handleSalvarFiscalDefaults} disabled={savingFiscal} className="bg-amber-600 hover:bg-amber-700">
                                        {savingFiscal ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                                        Salvar Padrões Fiscais
                                    </Button>
                                    {fiscalLoaded && (
                                        <Badge className="bg-green-100 text-green-800 border-green-200">Carregado do banco</Badge>
                                    )}
                                </div>
                            </>
                        );
                    })()}
                </CardContent>
            </Card>

            <Card className="border-t-4 border-t-green-600 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-gray-500" />
                        Empresa Emissora
                    </CardTitle>
                    <CardDescription>Dados fiscais da empresa emissora de NF-e desta organização</CardDescription>
                </CardHeader>
                <CardContent>
                    {highlightEmitente && (
                        <Alert className="mb-6 bg-red-50 border-red-200">
                            <AlertCircle className="h-4 w-4 text-red-600" />
                            <AlertDescription className="text-red-700">
                                <strong>Atenção:</strong> Dados fiscais obrigatórios estão faltando para emissão de notas.
                            </AlertDescription>
                        </Alert>
                    )}

                    {(() => {
                        const empresa = empresaEmissora;
                        const cnpj = empresa?.cnpj || empresaPadrao;
                        const dados = dadosFiscais[cnpj] || {};
                        const status = getStatusEmpresa(cnpj);

                        if (!cnpj) {
                            return (
                                <div className="text-center py-8">
                                    <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500 mb-4">Nenhuma empresa emissora configurada para esta organização.</p>
                                    <p className="text-sm text-gray-400 mb-4">Preencha os dados cadastrais da organização para continuar.</p>
                                </div>
                            );
                        }

                        return (
                            <div className="p-5 rounded-xl border-2 border-green-500 bg-green-50/50">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h4 className="font-bold text-gray-900">{empresa?.nome || organization?.name || 'Empresa'}</h4>
                                        <p className="text-xs text-gray-500 font-mono mt-0.5">{formatarCnpj(cnpj)}</p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <Badge className="bg-green-100 text-green-800 border-green-200">Emissora Ativa</Badge>
                                        <Badge variant="outline" className={status.ok ? "text-blue-600 bg-blue-50 border-blue-100" : "text-red-600 bg-red-50 border-red-100"}>
                                            {status.msg}
                                        </Badge>
                                    </div>
                                </div>

                                <div className="space-y-2 mb-5">
                                    <div className="flex justify-between text-sm py-1 border-b border-dashed border-gray-200">
                                        <span className="text-gray-500">Inscrição Estadual</span>
                                        <span className="font-mono">{dados.ie || "-"}</span>
                                    </div>
                                    <div className="flex justify-between text-sm py-1 border-b border-dashed border-gray-200">
                                        <span className="text-gray-500">Regime</span>
                                        <span>{REGIMES_TRIBUTARIOS.find(r => r.value === dados.regimeTributario)?.label.split(" - ")[0] || "-"}</span>
                                    </div>
                                    <div className="text-sm py-1">
                                        <span className="text-gray-500 block text-xs mb-0.5">Endereço Fiscal</span>
                                        <span className="line-clamp-1 text-gray-700">
                                            {dados.logradouro ? `${dados.logradouro}, ${dados.numero} - ${dados.municipio}/${dados.uf}` : "-"}
                                        </span>
                                    </div>
                                </div>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => abrirEdicaoEmpresa(empresa)}
                                >
                                    <Edit className="w-3.5 h-3.5 mr-2" />
                                    Editar Dados Fiscais
                                </Button>
                            </div>
                        );
                    })()}
                </CardContent>
            </Card>

            <Dialog open={!!editandoEmpresa} onOpenChange={() => setEditandoEmpresa(null)}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-green-600" />
                            Dados Fiscais - {editandoEmpresa?.nome}
                        </DialogTitle>
                        <DialogDescription>
                            Edite as informações fiscais (IE, Regime) e endereço da empresa.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="bg-blue-50 border border-blue-100 rounded-md p-3 mb-4 flex gap-4 text-sm text-blue-800">
                            <div className="flex items-center gap-2">
                                <Search className="w-4 h-4" />
                                <span className="font-semibold">Preencher via CNPJ:</span>
                                <Button variant="link" className="p-0 h-auto font-normal text-blue-700 underline" onClick={() => buscarCNPJ(editandoEmpresa.cnpj)}>
                                    Buscar dados de {editandoEmpresa?.cnpjFormatado || editandoEmpresa?.cnpj}
                                </Button>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <Label>Inscrição Estadual (IE)</Label>
                                <Input
                                    value={formEmpresa.ie || ""}
                                    onChange={(e) => setFormEmpresa({ ...formEmpresa, ie: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Regime Tributário</Label>
                                <Select
                                    value={formEmpresa.regimeTributario || "1"}
                                    onValueChange={(v) => setFormEmpresa({ ...formEmpresa, regimeTributario: v })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">Simples Nacional</SelectItem>
                                        <SelectItem value="3">Regime Normal</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="border-t pt-4">
                            <h4 className="font-medium mb-3 text-gray-700">Endereço Fiscal</h4>
                            <div className="grid md:grid-cols-3 gap-4 mb-4">
                                <div className="md:col-span-1">
                                    <Label>CEP</Label>
                                    <Input
                                        value={formEmpresa.cep || ""}
                                        onChange={(e) => setFormEmpresa({ ...formEmpresa, cep: e.target.value })}
                                        onBlur={(e) => buscarCEP(e.target.value)}
                                        placeholder="00000-000"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <Label>Logradouro</Label>
                                    <Input
                                        value={formEmpresa.logradouro || ""}
                                        onChange={(e) => setFormEmpresa({ ...formEmpresa, logradouro: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-3 gap-4 mb-4">
                                <div><Label>Número</Label><Input value={formEmpresa.numero || ""} onChange={(e) => setFormEmpresa({ ...formEmpresa, numero: e.target.value })} /></div>
                                <div className="md:col-span-2"><Label>Complemento</Label><Input value={formEmpresa.complemento || ""} onChange={(e) => setFormEmpresa({ ...formEmpresa, complemento: e.target.value })} /></div>
                            </div>

                            <div className="grid md:grid-cols-3 gap-4">
                                <div><Label>Bairro</Label><Input value={formEmpresa.bairro || ""} onChange={(e) => setFormEmpresa({ ...formEmpresa, bairro: e.target.value })} /></div>
                                <div><Label>Município *</Label><Input value={formEmpresa.municipio || ""} onChange={(e) => setFormEmpresa({ ...formEmpresa, municipio: e.target.value })} /></div>
                                <div>
                                    <Label>UF *</Label>
                                    <Select value={formEmpresa.uf || "ES"} onValueChange={(v) => setFormEmpresa({ ...formEmpresa, uf: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"].map(uf => (
                                                <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="border-t pt-4">
                        <Button variant="ghost" onClick={() => setEditandoEmpresa(null)}>Cancelar</Button>
                        <Button onClick={salvarDadosEmpresa} disabled={savingDb} className="bg-green-700 hover:bg-green-800">
                            {savingDb ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                            Salvar Dados Fiscais
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            
        </div>
    );
}
