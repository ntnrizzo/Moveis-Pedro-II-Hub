import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/hooks/useAuth";
import { Search, X, ShoppingCart, Users, Package, FileText, Receipt, Truck, Calendar } from "lucide-react";
import { useNavigate } from "react-router-dom";
import FiltrosAvancados from "./FiltrosAvancados";
import ResultadosBusca from "./ResultadosBusca";

export default function BuscaGlobal({ open, onClose }) {
  const [termoBusca, setTermoBusca] = useState("");
  const [filtros, setFiltros] = useState({
    dataInicio: "",
    dataFim: "",
    status: "todos",
    valorMin: "",
    valorMax: "",
    loja: "todas"
  });
  const [secaoAtiva, setSecaoAtiva] = useState("todos");
  const { user, can, filterData } = useAuth();
  const navigate = useNavigate();

  // Debounce para busca
  const [termoDebounced, setTermoDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTermoDebounced(termoBusca), 300);
    return () => clearTimeout(timer);
  }, [termoBusca]);

  // Buscar dados apenas quando há termo de busca
  const habilitarBusca = termoDebounced.length >= 2 && open;

  // Vendas
  const { data: vendas = [] } = useQuery({
    queryKey: ['busca-vendas', termoDebounced, filtros],
    queryFn: async () => {
      const data = await base44.entities.Venda.list();
      return filterData(data);
    },
    enabled: habilitarBusca && can('view_vendas')
  });

  // Clientes
  const { data: clientes = [] } = useQuery({
    queryKey: ['busca-clientes', termoDebounced],
    queryFn: () => base44.entities.Cliente.list(),
    enabled: habilitarBusca && can('view_clientes')
  });

  // Produtos
  const { data: produtos = [] } = useQuery({
    queryKey: ['busca-produtos', termoDebounced],
    queryFn: () => base44.entities.Produto.list(),
    enabled: habilitarBusca && can('view_produtos')
  });

  // Orçamentos
  const { data: orcamentos = [] } = useQuery({
    queryKey: ['busca-orcamentos', termoDebounced],
    queryFn: async () => {
      const data = await base44.entities.Orcamento.list();
      return filterData(data);
    },
    enabled: habilitarBusca && can('view_orcamentos')
  });

  // Entregas
  const { data: entregas = [] } = useQuery({
    queryKey: ['busca-entregas', termoDebounced],
    queryFn: () => base44.entities.Entrega.list(),
    enabled: habilitarBusca && can('view_entregas')
  });



  // Filtrar resultados
  const filtrarResultados = (dados, tipo) => {
    if (!termoDebounced) return [];

    let resultado = dados.filter(item => {
      const termo = termoDebounced.toLowerCase();

      switch (tipo) {
        case 'vendas':
          return item.numero_pedido?.toLowerCase().includes(termo) ||
            item.cliente_nome?.toLowerCase().includes(termo);
        case 'clientes':
          return item.nome_completo?.toLowerCase().includes(termo) ||
            item.telefone?.includes(termo) ||
            item.cpf?.includes(termo) ||
            item.email?.toLowerCase().includes(termo);
        case 'produtos':
          return item.nome?.toLowerCase().includes(termo) ||
            item.sku?.toLowerCase().includes(termo) ||
            item.codigo_barras?.includes(termo) ||
            item.modelo_referencia?.toLowerCase().includes(termo) ||
            item.categoria?.toLowerCase().includes(termo);
        case 'orcamentos':
          return item.numero_orcamento?.toLowerCase().includes(termo) ||
            item.cliente_nome?.toLowerCase().includes(termo);
        case 'entregas':
          return item.numero_pedido?.toLowerCase().includes(termo) ||
            item.cliente_nome?.toLowerCase().includes(termo) ||
            item.endereco_entrega?.toLowerCase().includes(termo);
        default:
          return false;
      }
    });

    // Aplicar filtros avançados
    if (filtros.dataInicio && tipo === 'vendas') {
      resultado = resultado.filter(item => item.data_venda >= filtros.dataInicio);
    }
    if (filtros.dataFim && tipo === 'vendas') {
      resultado = resultado.filter(item => item.data_venda <= filtros.dataFim);
    }
    if (filtros.status !== 'todos' && (tipo === 'vendas' || tipo === 'orcamentos')) {
      resultado = resultado.filter(item => item.status === filtros.status);
    }
    if (filtros.valorMin && tipo === 'vendas') {
      resultado = resultado.filter(item => item.valor_total >= parseFloat(filtros.valorMin));
    }
    if (filtros.valorMax && tipo === 'vendas') {
      resultado = resultado.filter(item => item.valor_total <= parseFloat(filtros.valorMax));
    }
    if (filtros.loja !== 'todas' && tipo === 'vendas') {
      resultado = resultado.filter(item => item.loja === filtros.loja);
    }

    return resultado;
  };

  const vendasFiltradas = filtrarResultados(vendas, 'vendas');
  const clientesFiltrados = filtrarResultados(clientes, 'clientes');
  const produtosFiltrados = filtrarResultados(produtos, 'produtos');
  const orcamentosFiltrados = filtrarResultados(orcamentos, 'orcamentos');
  const entregasFiltradas = filtrarResultados(entregas, 'entregas');

  const totalResultados = vendasFiltradas.length + clientesFiltrados.length +
    produtosFiltrados.length + orcamentosFiltrados.length +
    entregasFiltradas.length;

  const navegarPara = (tipo, item) => {
    switch (tipo) {
      case 'vendas':
        navigate('/admin/Pedidos');
        break;
      case 'clientes':
        navigate('/Clientes');
        break;
      case 'produtos':
        navigate('/Estoque');
        break;
      case 'orcamentos':
        navigate('/Orcamentos');
        break;
      case 'entregas':
        navigate('/Entregas');
        break;
    }
    onClose();
  };

  const limparBusca = () => {
    setTermoBusca("");
    setFiltros({
      dataInicio: "",
      dataFim: "",
      status: "todos",
      valorMin: "",
      valorMax: "",
      loja: "todas"
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <Search className="w-5 h-5 text-gray-400" />
            <Input
              placeholder="Buscar em pedidos, clientes, produtos, orçamentos..."
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              className="flex-1 border-0 focus-visible:ring-0 text-lg"
              autoFocus
            />
            {termoBusca && (
              <Button variant="ghost" size="sm" onClick={limparBusca}>
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
          {termoDebounced.length >= 2 && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-sm text-gray-500">
                {totalResultados} {totalResultados === 1 ? 'resultado encontrado' : 'resultados encontrados'}
              </p>
              <FiltrosAvancados filtros={filtros} onChange={setFiltros} />
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-auto p-6">
          {termoDebounced.length < 2 ? (
            <div className="text-center py-12">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Digite pelo menos 2 caracteres para buscar</p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center">
                <Badge variant="outline">Pedidos</Badge>
                <Badge variant="outline">Clientes</Badge>
                <Badge variant="outline">Produtos</Badge>
                <Badge variant="outline">Orçamentos</Badge>
                <Badge variant="outline">Entregas</Badge>
              </div>
            </div>
          ) : totalResultados === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Search className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium">Nenhum resultado encontrado</p>
              <p className="text-sm text-gray-400 mt-1">Tente usar outros termos de busca</p>
            </div>
          ) : (
            <Tabs value={secaoAtiva} onValueChange={setSecaoAtiva}>
              <TabsList className="mb-4">
                <TabsTrigger value="todos">
                  Todos ({totalResultados})
                </TabsTrigger>
                {vendasFiltradas.length > 0 && (
                  <TabsTrigger value="vendas">
                    <ShoppingCart className="w-4 h-4 mr-1" />
                    Pedidos ({vendasFiltradas.length})
                  </TabsTrigger>
                )}
                {clientesFiltrados.length > 0 && (
                  <TabsTrigger value="clientes">
                    <Users className="w-4 h-4 mr-1" />
                    Clientes ({clientesFiltrados.length})
                  </TabsTrigger>
                )}
                {produtosFiltrados.length > 0 && (
                  <TabsTrigger value="produtos">
                    <Package className="w-4 h-4 mr-1" />
                    Produtos ({produtosFiltrados.length})
                  </TabsTrigger>
                )}
                {orcamentosFiltrados.length > 0 && (
                  <TabsTrigger value="orcamentos">
                    <FileText className="w-4 h-4 mr-1" />
                    Orçamentos ({orcamentosFiltrados.length})
                  </TabsTrigger>
                )}
                {entregasFiltradas.length > 0 && (
                  <TabsTrigger value="entregas">
                    <Truck className="w-4 h-4 mr-1" />
                    Entregas ({entregasFiltradas.length})
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="todos" className="space-y-4">
                {vendasFiltradas.length > 0 && (
                  <ResultadosBusca
                    titulo="Pedidos"
                    icon={ShoppingCart}
                    dados={vendasFiltradas.slice(0, 5)}
                    tipo="vendas"
                    onClicar={navegarPara}
                    termo={termoDebounced}
                  />
                )}
                {clientesFiltrados.length > 0 && (
                  <ResultadosBusca
                    titulo="Clientes"
                    icon={Users}
                    dados={clientesFiltrados.slice(0, 5)}
                    tipo="clientes"
                    onClicar={navegarPara}
                    termo={termoDebounced}
                  />
                )}
                {produtosFiltrados.length > 0 && (
                  <ResultadosBusca
                    titulo="Produtos"
                    icon={Package}
                    dados={produtosFiltrados.slice(0, 5)}
                    tipo="produtos"
                    onClicar={navegarPara}
                    termo={termoDebounced}
                  />
                )}
                {orcamentosFiltrados.length > 0 && (
                  <ResultadosBusca
                    titulo="Orçamentos"
                    icon={FileText}
                    dados={orcamentosFiltrados.slice(0, 5)}
                    tipo="orcamentos"
                    onClicar={navegarPara}
                    termo={termoDebounced}
                  />
                )}
                {entregasFiltradas.length > 0 && (
                  <ResultadosBusca
                    titulo="Entregas"
                    icon={Truck}
                    dados={entregasFiltradas.slice(0, 5)}
                    tipo="entregas"
                    onClicar={navegarPara}
                    termo={termoDebounced}
                  />
                )}
              </TabsContent>

              <TabsContent value="vendas">
                <ResultadosBusca
                  titulo="Pedidos"
                  icon={ShoppingCart}
                  dados={vendasFiltradas}
                  tipo="vendas"
                  onClicar={navegarPara}
                  termo={termoDebounced}
                />
              </TabsContent>

              <TabsContent value="clientes">
                <ResultadosBusca
                  titulo="Clientes"
                  icon={Users}
                  dados={clientesFiltrados}
                  tipo="clientes"
                  onClicar={navegarPara}
                  termo={termoDebounced}
                />
              </TabsContent>

              <TabsContent value="produtos">
                <ResultadosBusca
                  titulo="Produtos"
                  icon={Package}
                  dados={produtosFiltrados}
                  tipo="produtos"
                  onClicar={navegarPara}
                  termo={termoDebounced}
                />
              </TabsContent>

              <TabsContent value="orcamentos">
                <ResultadosBusca
                  titulo="Orçamentos"
                  icon={FileText}
                  dados={orcamentosFiltrados}
                  tipo="orcamentos"
                  onClicar={navegarPara}
                  termo={termoDebounced}
                />
              </TabsContent>

              <TabsContent value="entregas">
                <ResultadosBusca
                  titulo="Entregas"
                  icon={Truck}
                  dados={entregasFiltradas}
                  tipo="entregas"
                  onClicar={navegarPara}
                  termo={termoDebounced}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>

        <div className="border-t p-4 bg-gray-50 dark:bg-neutral-900 text-xs text-gray-500 flex items-center justify-between">
          <div className="flex gap-4">
            <kbd className="px-2 py-1 bg-white dark:bg-neutral-800 border rounded">↑↓</kbd>
            <span>Navegar</span>
            <kbd className="px-2 py-1 bg-white dark:bg-neutral-800 border rounded">Enter</kbd>
            <span>Selecionar</span>
          </div>
          <div>
            <kbd className="px-2 py-1 bg-white dark:bg-neutral-800 border rounded">Esc</kbd>
            <span className="ml-2">Fechar</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}