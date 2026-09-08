import React, { useState, useEffect } from "react";
import { base44, supabase } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  FileText, CheckCircle, AlertTriangle, Loader2, Plus, Search,
  Barcode, Upload, Building2, Package, DollarSign, Truck,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Info
} from "lucide-react";
import { toast } from "sonner";
import { isValidGTIN, normalizeGTIN, generateSafeSKU } from "@/utils/gtinValidator";

export default function ImportarNFe({ user }) {
  const [activeTab, setActiveTab] = useState("arquivo");
  const [processando, setProcessando] = useState(false);
  const [dadosCompletos, setDadosCompletos] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [etapaAtual, setEtapaAtual] = useState("");
  const [cnpjSelecionado, setCnpjSelecionado] = useState("49129137000130");
  const [impostoExpandido, setImpostoExpandido] = useState(false);
  const [itensExpandido, setItensExpandido] = useState(true);

  const queryClient = useQueryClient();

  // Queries para dados existentes
  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: () => base44.entities.Fornecedor.list(),
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list(),
  });

  const EMPRESAS = [
    { cnpj: "49129137000130", nome: "Atacadao Outlet", cnpjFormatado: "49.129.137/0001-30" },
    { cnpj: "04842257000141", nome: "Moveis Pedro II", cnpjFormatado: "04.842.257/0001-41" },
    { cnpj: "42316614000127", nome: "Massi Home Design", cnpjFormatado: "42.316.614/0001-27" },
    { cnpj: "53795479000166", nome: "Alta Performance Decoracoes", cnpjFormatado: "53.795.479/0001-66" },
  ];

  const empresaSelecionada = EMPRESAS.find(e => e.cnpj === cnpjSelecionado) || EMPRESAS[0];

  // Helper para extrair texto de tag XML
  const getTagText = (parent, tagName) => {
    if (!parent) return null;
    const el = parent.getElementsByTagName(tagName)[0];
    return el?.textContent || null;
  };

  const getTagFloat = (parent, tagName) => {
    const text = getTagText(parent, tagName);
    return text ? parseFloat(text) : 0;
  };

  // Parser completo do XML da NFe
  const parseXMLCompleto = (xmlContent) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");

    const infNFe = xmlDoc.getElementsByTagName("infNFe")[0];
    if (!infNFe) throw new Error("XML invalido - infNFe nao encontrado");

    const ide = xmlDoc.getElementsByTagName("ide")[0];
    const emit = xmlDoc.getElementsByTagName("emit")[0];
    const dest = xmlDoc.getElementsByTagName("dest")[0];
    const total = xmlDoc.getElementsByTagName("total")[0];
    const ICMSTot = total?.getElementsByTagName("ICMSTot")[0];
    const transp = xmlDoc.getElementsByTagName("transp")[0];
    const pag = xmlDoc.getElementsByTagName("pag")[0];
    const infAdic = xmlDoc.getElementsByTagName("infAdic")[0];
    const dets = xmlDoc.getElementsByTagName("det");

    // Dados da Nota
    const dadosNota = {
      chave_acesso: infNFe.getAttribute("Id")?.replace("NFe", "") || "",
      numero_nota: getTagText(ide, "nNF"),
      serie: getTagText(ide, "serie"),
      data_emissao: getTagText(ide, "dhEmi"),
      natureza_operacao: getTagText(ide, "natOp"),
    };

    // Emitente (Fornecedor)
    const emitEndereco = emit?.getElementsByTagName("enderEmit")[0];
    const dadosEmitente = {
      cnpj: getTagText(emit, "CNPJ"),
      razao_social: getTagText(emit, "xNome"),
      nome_fantasia: getTagText(emit, "xFant"),
      ie: getTagText(emit, "IE"),
      endereco: emitEndereco ? `${getTagText(emitEndereco, "xLgr")}, ${getTagText(emitEndereco, "nro")}` : "",
      bairro: getTagText(emitEndereco, "xBairro"),
      cidade: getTagText(emitEndereco, "xMun"),
      uf: getTagText(emitEndereco, "UF"),
      cep: getTagText(emitEndereco, "CEP"),
      telefone: getTagText(emitEndereco, "fone"),
    };

    // Destinatario
    const dadosDestinatario = {
      cnpj: getTagText(dest, "CNPJ"),
      razao_social: getTagText(dest, "xNome"),
    };

    // Totais e Impostos
    const totais = {
      valor_produtos: getTagFloat(ICMSTot, "vProd"),
      valor_frete: getTagFloat(ICMSTot, "vFrete"),
      valor_seguro: getTagFloat(ICMSTot, "vSeg"),
      valor_desconto: getTagFloat(ICMSTot, "vDesc"),
      valor_outras_despesas: getTagFloat(ICMSTot, "vOutro"),
      valor_total_nota: getTagFloat(ICMSTot, "vNF"),
      // ICMS
      base_icms: getTagFloat(ICMSTot, "vBC"),
      valor_icms: getTagFloat(ICMSTot, "vICMS"),
      base_icms_st: getTagFloat(ICMSTot, "vBCST"),
      valor_icms_st: getTagFloat(ICMSTot, "vST"),
      valor_fcp: getTagFloat(ICMSTot, "vFCP"),
      valor_fcp_st: getTagFloat(ICMSTot, "vFCPST"),
      // Outros impostos
      valor_ipi: getTagFloat(ICMSTot, "vIPI"),
      valor_ii: getTagFloat(ICMSTot, "vII"),
      valor_pis: getTagFloat(ICMSTot, "vPIS"),
      valor_cofins: getTagFloat(ICMSTot, "vCOFINS"),
      valor_aproximado_tributos: getTagFloat(ICMSTot, "vTotTrib"),
    };

    // Transporte
    const transporta = transp?.getElementsByTagName("transporta")[0];
    const veicTransp = transp?.getElementsByTagName("veicTransp")[0];
    const vol = transp?.getElementsByTagName("vol")[0];
    const dadosTransporte = {
      modalidade_frete: getTagText(transp, "modFrete"),
      transportadora_cnpj: getTagText(transporta, "CNPJ"),
      transportadora_nome: getTagText(transporta, "xNome"),
      transportadora_ie: getTagText(transporta, "IE"),
      placa_veiculo: getTagText(veicTransp, "placa"),
      uf_veiculo: getTagText(veicTransp, "UF"),
      quantidade_volumes: parseInt(getTagText(vol, "qVol")) || 0,
      especie_volumes: getTagText(vol, "esp"),
      peso_liquido: getTagFloat(vol, "pesoL"),
      peso_bruto: getTagFloat(vol, "pesoB"),
    };

    // Pagamento
    const detPag = pag?.getElementsByTagName("detPag")[0];
    const dadosPagamento = {
      forma_pagamento: getTagText(detPag, "tPag"),
      valor_pagamento: getTagFloat(detPag, "vPag"),
    };

    // Informacoes Adicionais
    const infoAdicionais = {
      informacoes_complementares: getTagText(infAdic, "infCpl"),
      informacoes_fisco: getTagText(infAdic, "infAdFisco"),
    };

    // Itens da Nota
    const itens = [];
    for (let i = 0; i < dets.length; i++) {
      const det = dets[i];
      const prod = det.getElementsByTagName("prod")[0];
      const imposto = det.getElementsByTagName("imposto")[0];

      // ICMS - pode estar em diferentes tags
      const icmsGroup = imposto?.getElementsByTagName("ICMS")[0];
      const icms = icmsGroup?.children[0]; // ICMS00, ICMS10, etc.

      // IPI
      const ipiGroup = imposto?.getElementsByTagName("IPI")[0];
      const ipiTrib = ipiGroup?.getElementsByTagName("IPITrib")[0];

      // PIS
      const pisGroup = imposto?.getElementsByTagName("PIS")[0];
      const pis = pisGroup?.children[0];

      // COFINS
      const cofinsGroup = imposto?.getElementsByTagName("COFINS")[0];
      const cofins = cofinsGroup?.children[0];

      let rawEan = getTagText(prod, "cEAN");
      let ean = (rawEan && rawEan !== "SEM GTIN" && isValidGTIN(rawEan)) ? normalizeGTIN(rawEan, true) : null;

      itens.push({
        numero_item: parseInt(det.getAttribute("nItem")) || i + 1,
        // Produto
        codigo_produto_fornecedor: getTagText(prod, "cProd"),
        codigo_barras_ean: ean,
        codigo_barras_tributavel: getTagText(prod, "cEANTrib"),
        descricao_produto: getTagText(prod, "xProd"),
        ncm: getTagText(prod, "NCM"),
        cest: getTagText(prod, "CEST"),
        cfop: getTagText(prod, "CFOP"),
        unidade_comercial: getTagText(prod, "uCom"),
        unidade_tributavel: getTagText(prod, "uTrib"),
        // Valores
        quantidade: getTagFloat(prod, "qCom"),
        quantidade_tributavel: getTagFloat(prod, "qTrib"),
        valor_unitario: getTagFloat(prod, "vUnCom"),
        valor_unitario_tributavel: getTagFloat(prod, "vUnTrib"),
        valor_total_produto: getTagFloat(prod, "vProd"),
        valor_frete_rateado: getTagFloat(prod, "vFrete"),
        valor_seguro_rateado: getTagFloat(prod, "vSeg"),
        valor_desconto: getTagFloat(prod, "vDesc"),
        valor_outras_despesas: getTagFloat(prod, "vOutro"),
        // ICMS
        origem_mercadoria: getTagText(icms, "orig"),
        cst_icms: getTagText(icms, "CST") || getTagText(icms, "CSOSN"),
        modalidade_bc_icms: getTagText(icms, "modBC"),
        base_calculo_icms: getTagFloat(icms, "vBC"),
        percentual_reducao_bc: getTagFloat(icms, "pRedBC"),
        aliquota_icms: getTagFloat(icms, "pICMS"),
        valor_icms: getTagFloat(icms, "vICMS"),
        // ICMS ST
        modalidade_bc_icms_st: getTagText(icms, "modBCST"),
        percentual_mva_st: getTagFloat(icms, "pMVAST"),
        base_calculo_icms_st: getTagFloat(icms, "vBCST"),
        aliquota_icms_st: getTagFloat(icms, "pICMSST"),
        valor_icms_st: getTagFloat(icms, "vICMSST"),
        // IPI
        cst_ipi: getTagText(ipiTrib, "CST") || getTagText(ipiGroup?.getElementsByTagName("IPINT")[0], "CST"),
        codigo_enquadramento_ipi: getTagText(ipiGroup, "cEnq"),
        base_calculo_ipi: getTagFloat(ipiTrib, "vBC"),
        aliquota_ipi: getTagFloat(ipiTrib, "pIPI"),
        valor_ipi: getTagFloat(ipiTrib, "vIPI"),
        // PIS
        cst_pis: getTagText(pis, "CST"),
        base_calculo_pis: getTagFloat(pis, "vBC"),
        aliquota_pis: getTagFloat(pis, "pPIS"),
        valor_pis: getTagFloat(pis, "vPIS"),
        // COFINS
        cst_cofins: getTagText(cofins, "CST"),
        base_calculo_cofins: getTagFloat(cofins, "vBC"),
        aliquota_cofins: getTagFloat(cofins, "pCOFINS"),
        valor_cofins: getTagFloat(cofins, "vCOFINS"),
        // Tributos aproximados
        valor_aproximado_tributos: getTagFloat(imposto, "vTotTrib"),
        // Info adicional do item
        informacoes_adicionais: getTagText(det, "infAdProd"),
      });
    }

    return {
      nota: dadosNota,
      emitente: dadosEmitente,
      destinatario: dadosDestinatario,
      totais,
      transporte: dadosTransporte,
      pagamento: dadosPagamento,
      infoAdicionais,
      itens,
      xmlOriginal: xmlContent,
    };
  };

  // Buscar nota via Edge Function (SEGURO - sem credenciais no frontend)
  const consultarNotaNaAPI = async () => {
    // Processar importacao completa
  const processarImportacao = async () => {
    if (!dadosCompletos) return;

    setProcessando(true);
    const acoes = [];

    try {
      // 1. Verificar/Criar Fornecedor
      setEtapaAtual("Verificando fornecedor...");
      let fornecedorId = null;
      const fornecedorExistente = fornecedores.find(f =>
        f.cnpj?.replace(/\D/g, '') === dadosCompletos.emitente.cnpj
      );

      if (fornecedorExistente) {
        fornecedorId = fornecedorExistente.id;
        acoes.push({ tipo: 'info', texto: `Fornecedor vinculado: ${fornecedorExistente.nome_empresa}` });
      } else {
        setEtapaAtual("Criando fornecedor...");
        const novoFornecedor = await base44.entities.Fornecedor.create({
          nome_empresa: dadosCompletos.emitente.razao_social,
          nome: dadosCompletos.emitente.nome_fantasia || dadosCompletos.emitente.razao_social,
          cnpj: dadosCompletos.emitente.cnpj,
          telefone: dadosCompletos.emitente.telefone,
          contato: dadosCompletos.emitente.nome_fantasia,
        });
        fornecedorId = novoFornecedor.id;
        acoes.push({ tipo: 'sucesso', texto: `Fornecedor criado: ${dadosCompletos.emitente.razao_social}` });
      }

      // 2. Criar registro da NFe
      setEtapaAtual("Registrando nota fiscal...");
      const nfe = await base44.entities.NotaFiscalEntrada.create({
        chave_acesso: dadosCompletos.nota.chave_acesso,
        numero_nota: dadosCompletos.nota.numero_nota,
        serie: dadosCompletos.nota.serie,
        data_emissao: dadosCompletos.nota.data_emissao,
        fornecedor_id: fornecedorId,
        fornecedor_cnpj: dadosCompletos.emitente.cnpj,
        fornecedor_razao_social: dadosCompletos.emitente.razao_social,
        fornecedor_nome_fantasia: dadosCompletos.emitente.nome_fantasia,
        fornecedor_ie: dadosCompletos.emitente.ie,
        destinatario_cnpj: dadosCompletos.destinatario.cnpj,
        destinatario_razao_social: dadosCompletos.destinatario.razao_social,
        empresa_destino: empresaSelecionada.nome,
        ...dadosCompletos.totais,
        ...dadosCompletos.transporte,
        ...dadosCompletos.pagamento,
        informacoes_complementares: dadosCompletos.infoAdicionais.informacoes_complementares,
        xml_original: dadosCompletos.xmlOriginal,
        importado_por: user?.id,
        importado_por_nome: user?.full_name || user?.email,
        status: 'Importada',
      });

      acoes.push({ tipo: 'sucesso', texto: `NFe ${dadosCompletos.nota.numero_nota} registrada` });

      // 3. Processar cada item
      setEtapaAtual("Processando itens...");
      let produtosCriados = 0;
      let produtosAtualizados = 0;
      let produtosComAtencao = 0;

      for (const item of dadosCompletos.itens) {
        let produtoId = null;
        let produtoVinculado = false;
        let produtoCriado = false;
        let requerAtencao = false;
        let motivoAtencao = null;

        // Buscar por EAN
        let produtoExistente = item.codigo_barras_ean ?
          produtos.find(p => p.codigo_barras && normalizeGTIN(p.codigo_barras, true) === item.codigo_barras_ean) : null;

        // Buscar por nome similar
        if (!produtoExistente) {
          const nomeNormalizado = item.descricao_produto.toLowerCase().trim();
          produtoExistente = produtos.find(p =>
            p.nome?.toLowerCase().trim() === nomeNormalizado
          );
          if (produtoExistente) {
            requerAtencao = true;
            motivoAtencao = "Vinculado por nome - verificar se e o produto correto";
          }
        }

        if (produtoExistente) {
          // Atualizar estoque e custo
          await base44.entities.Produto.update(produtoExistente.id, {
            quantidade_estoque: (produtoExistente.quantidade_estoque || 0) + item.quantidade,
            estoque_cd: (produtoExistente.estoque_cd || 0) + item.quantidade,
            preco_custo: item.valor_unitario,
            ncm: item.ncm || produtoExistente.ncm,
            ultima_nfe_id: nfe.id,
          });
          produtoId = produtoExistente.id;
          produtoVinculado = true;
          produtosAtualizados++;
        } else {
          // Criar novo produto com SKU seguro e EAN válido (ou null)
          const safeSku = item.codigo_produto_fornecedor
            ? generateSafeSKU(`NFE-${item.codigo_produto_fornecedor}`.substring(0, 30))
            : generateSafeSKU('NFE');

          const novoProduto = await base44.entities.Produto.create({
            nome: item.descricao_produto,
            sku: safeSku,
            codigo_barras: item.codigo_barras_ean,
            categoria: "Outros",
            preco_custo: item.valor_unitario,
            preco_venda: item.valor_unitario * (1 + (parseFloat(localStorage.getItem("nfe_margem_lucro") || "80") / 100)),
            quantidade_estoque: item.quantidade,
            estoque_cd: item.quantidade,
            estoque_minimo: 5,
            ativo: true,
            ncm: item.ncm,
            origem_nfe: true,
            requer_atencao: true,
            motivo_atencao: "Produto importado via NFe - completar cadastro",
            ultima_nfe_id: nfe.id,
            descricao: `Importado da NFe ${dadosCompletos.nota.numero_nota}`,
          });
          produtoId = novoProduto.id;
          produtoCriado = true;
          requerAtencao = true;
          motivoAtencao = "Produto novo - completar cadastro (categoria, preco venda, fotos)";
          produtosCriados++;
          produtosComAtencao++;
        }

        // Registrar item da NFe
        await base44.entities.ItemNotaFiscal.create({
          nota_fiscal_id: nfe.id,
          produto_id: produtoId,
          ...item,
          produto_vinculado: produtoVinculado,
          produto_criado: produtoCriado,
          requer_atencao: requerAtencao,
          motivo_atencao: motivoAtencao,
        });
      }

      acoes.push({
        tipo: produtosComAtencao > 0 ? 'atencao' : 'sucesso',
        texto: `${produtosAtualizados} produtos atualizados, ${produtosCriados} criados${produtosComAtencao > 0 ? ` (${produtosComAtencao} requerem atencao)` : ''}`
      });

      // 4. Criar lancamento financeiro (conta a pagar)
      setEtapaAtual("Criando lancamento financeiro...");
      const lancamento = await base44.entities.LancamentoFinanceiro.create({
        descricao: `NFe ${dadosCompletos.nota.numero_nota} - ${dadosCompletos.emitente.razao_social}`,
        valor: dadosCompletos.totais.valor_total_nota,
        tipo: "Despesa",
        data_vencimento: new Date().toISOString().split('T')[0],
        data_lancamento: new Date().toISOString().split('T')[0],
        pago: false,
        status: "Pendente",
        categoria_nome: "Compra de Mercadorias",
        forma_pagamento: dadosCompletos.pagamento.forma_pagamento === "01" ? "Dinheiro" :
          dadosCompletos.pagamento.forma_pagamento === "03" ? "Cartao Credito" :
            dadosCompletos.pagamento.forma_pagamento === "04" ? "Cartao Debito" : "Boleto",
        observacao: `Importado automaticamente da NFe ${dadosCompletos.nota.chave_acesso}`,
      });

      // Atualizar NFe com ID do lancamento
      await base44.entities.NotaFiscalEntrada.update(nfe.id, {
        lancamento_financeiro_id: lancamento.id,
        status: 'Processada',
      });

      acoes.push({ tipo: 'sucesso', texto: `Conta a pagar criada: R$ ${dadosCompletos.totais.valor_total_nota.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` });

      // Invalidar queries
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-financeiros'] });
      queryClient.invalidateQueries({ queryKey: ['notas-fiscais'] });

      setResultado({
        tipo: 'completo',
        texto: 'Importacao concluida com sucesso!',
        acoes
      });

      toast.success("NFe importada e integrada com sucesso!");

    } catch (error) {
      console.error("Erro na importacao:", error);
      setResultado({ tipo: 'erro', texto: error.message });
      toast.error("Erro ao processar importacao");
    } finally {
      setProcessando(false);
      setEtapaAtual("");
    }
  };

  // Formatar valor em reais
  const formatMoney = (value) => {
    if (!value && value !== 0) return "-";
    return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-800">
            <FileText className="w-6 h-6" />
            Entrada de Nota Fiscal Eletronica
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Seletor de Empresa */}
          <div className="bg-gray-50 p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-gray-500" />
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-700 mb-1 block">Empresa Destinataria</label>
                <Select value={cnpjSelecionado} onValueChange={setCnpjSelecionado}>
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPRESAS.map(empresa => (
                      <SelectItem key={empresa.cnpj} value={empresa.cnpj}>
                        <span className="font-medium">{empresa.nome}</span>
                        <span className="text-xs text-gray-500 ml-2">{empresa.cnpjFormatado}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Tabs de entrada */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              
              <TabsTrigger value="arquivo">
                <Upload className="w-4 h-4 mr-2" />
                Arquivo XML
              </TabsTrigger>
            </TabsList>

            

            <TabsContent value="arquivo" className="mt-4">
              <label className="cursor-pointer block">
                <input type="file" accept=".xml" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const dados = parseXMLCompleto(ev.target.result);
                      setDadosCompletos(dados);
                      setResultado({ tipo: 'sucesso', texto: `Nota ${dados.nota.numero_nota} carregada!` });
                    } catch (err) {
                      setResultado({ tipo: 'erro', texto: "Erro ao ler XML: " + err.message });
                    }
                  };
                  reader.readAsText(file);
                }} />
                <div className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl hover:bg-gray-50 transition-colors border-gray-300">
                  <FileText className="w-10 h-10 mb-2 text-green-700" />
                  <span className="text-sm font-medium text-gray-600">Clique para selecionar o XML</span>
                </div>
              </label>
            </TabsContent>
          </Tabs>

          {/* Status de etapa */}
          {etapaAtual && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              {etapaAtual}
            </div>
          )}

          {/* Resultado/Erro */}
          {resultado && resultado.tipo !== 'completo' && (
            <Alert className={resultado.tipo === 'erro' ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}>
              {resultado.tipo === 'erro' ? <AlertTriangle className="h-4 w-4 text-red-600" /> : <CheckCircle className="h-4 w-4 text-green-600" />}
              <AlertDescription className={resultado.tipo === 'erro' ? 'text-red-800' : 'text-green-800'}>
                {resultado.texto}
              </AlertDescription>
            </Alert>
          )}

          {/* Dados da Nota Carregada */}
          {dadosCompletos && (
            <div className="space-y-4">
              {/* Header da Nota */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border border-green-100">
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">Fornecedor</p>
                    <p className="font-bold text-green-800">{dadosCompletos.emitente.razao_social}</p>
                    <p className="text-xs text-gray-500">CNPJ: {dadosCompletos.emitente.cnpj?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500">Nota Fiscal</p>
                    <p className="font-bold text-2xl text-green-800">#{dadosCompletos.nota.numero_nota}</p>
                    <p className="text-xs text-gray-500">Serie {dadosCompletos.nota.serie}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Valor Total</p>
                    <p className="font-bold text-2xl text-green-800">{formatMoney(dadosCompletos.totais.valor_total_nota)}</p>
                    <p className="text-xs text-gray-500">{new Date(dadosCompletos.nota.data_emissao).toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
              </div>

              {/* Totais e Impostos */}
              <Collapsible open={impostoExpandido} onOpenChange={setImpostoExpandido}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-gray-500" />
                    <span className="font-medium">Totais e Impostos</span>
                  </div>
                  {impostoExpandido ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <div className="grid md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-500">Produtos</p>
                      <p className="font-semibold">{formatMoney(dadosCompletos.totais.valor_produtos)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Frete</p>
                      <p className="font-semibold">{formatMoney(dadosCompletos.totais.valor_frete)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Desconto</p>
                      <p className="font-semibold text-red-600">-{formatMoney(dadosCompletos.totais.valor_desconto)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Outras Despesas</p>
                      <p className="font-semibold">{formatMoney(dadosCompletos.totais.valor_outras_despesas)}</p>
                    </div>
                    <div className="border-t pt-2">
                      <p className="text-xs text-gray-500">ICMS</p>
                      <p className="font-semibold">{formatMoney(dadosCompletos.totais.valor_icms)}</p>
                    </div>
                    <div className="border-t pt-2">
                      <p className="text-xs text-gray-500">ICMS ST</p>
                      <p className="font-semibold">{formatMoney(dadosCompletos.totais.valor_icms_st)}</p>
                    </div>
                    <div className="border-t pt-2">
                      <p className="text-xs text-gray-500">IPI</p>
                      <p className="font-semibold">{formatMoney(dadosCompletos.totais.valor_ipi)}</p>
                    </div>
                    <div className="border-t pt-2">
                      <p className="text-xs text-gray-500">PIS + COFINS</p>
                      <p className="font-semibold">{formatMoney(dadosCompletos.totais.valor_pis + dadosCompletos.totais.valor_cofins)}</p>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Transporte */}
              {dadosCompletos.transporte.transportadora_nome && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <Truck className="w-4 h-4 text-blue-600" />
                  <span className="text-sm">
                    <span className="font-medium">{dadosCompletos.transporte.transportadora_nome}</span>
                    {dadosCompletos.transporte.placa_veiculo && ` - Placa: ${dadosCompletos.transporte.placa_veiculo}`}
                    {dadosCompletos.transporte.quantidade_volumes > 0 && ` - ${dadosCompletos.transporte.quantidade_volumes} volumes`}
                  </span>
                </div>
              )}

              {/* Itens */}
              <Collapsible open={itensExpandido} onOpenChange={setItensExpandido}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-500" />
                    <span className="font-medium">Itens da Nota ({dadosCompletos.itens.length})</span>
                  </div>
                  {itensExpandido ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-96 overflow-auto">
                      <Table>
                        <TableHeader className="bg-gray-50 sticky top-0">
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Produto</TableHead>
                            <TableHead className="text-center">NCM</TableHead>
                            <TableHead className="text-center">Qtd</TableHead>
                            <TableHead className="text-right">Unit.</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">ICMS</TableHead>
                            <TableHead className="text-right">IPI</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dadosCompletos.itens.map((item, idx) => (
                            <TableRow key={idx} className="hover:bg-gray-50">
                              <TableCell className="text-gray-500">{item.numero_item}</TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-sm line-clamp-1">{item.descricao_produto}</p>
                                  <div className="flex gap-2 text-xs text-gray-500">
                                    {item.codigo_barras_ean && <span>EAN: {item.codigo_barras_ean}</span>}
                                    <span>CFOP: {item.cfop}</span>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-center font-mono text-xs">{item.ncm}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant="secondary">{item.quantidade} {item.unidade_comercial}</Badge>
                              </TableCell>
                              <TableCell className="text-right text-sm">{formatMoney(item.valor_unitario)}</TableCell>
                              <TableCell className="text-right font-semibold">{formatMoney(item.valor_total_produto)}</TableCell>
                              <TableCell className="text-right text-sm">
                                {item.valor_icms > 0 ? (
                                  <span className="text-orange-600">{formatMoney(item.valor_icms)}</span>
                                ) : '-'}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {item.valor_ipi > 0 ? (
                                  <span className="text-orange-600">{formatMoney(item.valor_ipi)}</span>
                                ) : '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Botao de Importar */}
              {resultado?.tipo !== 'completo' && (
                <Button
                  onClick={processarImportacao}
                  disabled={processando}
                  className="w-full h-12 text-lg bg-green-700 hover:bg-green-800"
                >
                  {processando ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      {etapaAtual || "Processando..."}
                    </>
                  ) : (
                    <>
                      <Plus className="w-5 h-5 mr-2" />
                      Confirmar Entrada
                    </>
                  )}
                </Button>
              )}

              {/* Resultado Final */}
              {resultado?.tipo === 'completo' && (
                <div className="space-y-3">
                  <Alert className="border-green-200 bg-green-50">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <AlertDescription className="text-green-800 font-medium">
                      {resultado.texto}
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    {resultado.acoes?.map((acao, idx) => (
                      <div key={idx} className={`flex items-center gap-2 p-2 rounded text-sm ${acao.tipo === 'sucesso' ? 'bg-green-50 text-green-800' :
                        acao.tipo === 'atencao' ? 'bg-yellow-50 text-yellow-800' :
                          'bg-blue-50 text-blue-800'
                        }`}>
                        {acao.tipo === 'sucesso' ? <CheckCircle2 className="w-4 h-4" /> :
                          acao.tipo === 'atencao' ? <AlertCircle className="w-4 h-4" /> :
                            <Info className="w-4 h-4" />}
                        {acao.texto}
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDadosCompletos(null);
                      setChaveAcesso("");
                      setResultado(null);
                    }}
                    className="w-full"
                  >
                    Importar Nova Nota
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
