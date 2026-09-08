import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { formatarDataExibicao } from "@/utils/dateUtils";

export default function ResultadosBusca({ titulo, icon: Icon, dados, tipo, onClicar, termo }) {
  const destacarTexto = (texto, termo) => {
    if (!texto || !termo) return texto;
    const textoStr = String(texto);
    const regex = new RegExp(`(${termo})`, 'gi');
    const partes = textoStr.split(regex);
    
    return partes.map((parte, i) => 
      regex.test(parte) ? 
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-900 font-semibold">{parte}</mark> : 
        parte
    );
  };

  const renderizarItem = (item) => {
    switch(tipo) {
      case 'vendas':
        return (
          <div
            key={item.id}
            onClick={() => onClicar(tipo, item)}
            className="p-4 hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer border-b last:border-b-0 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {destacarTexto(item.numero_pedido, termo)}
                  </span>
                  <Badge variant={
                    item.status === 'Pago' ? 'default' : 
                    item.status === 'Cancelado' ? 'destructive' : 
                    'secondary'
                  }>
                    {item.status}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Cliente: {destacarTexto(item.cliente_nome, termo)}
                </p>
                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                  <span>📅 {formatarDataExibicao(item.data_venda)}</span>
                  <span>💰 R$ {item.valor_total?.toFixed(2)}</span>
                  <span>🏪 {item.loja}</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        );

      case 'clientes':
        return (
          <div
            key={item.id}
            onClick={() => onClicar(tipo, item)}
            className="p-4 hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer border-b last:border-b-0 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="font-semibold text-gray-900 dark:text-white mb-1">
                  {destacarTexto(item.nome_completo, termo)}
                </div>
                <div className="flex gap-3 text-sm text-gray-600 dark:text-gray-400">
                  <span>📱 {destacarTexto(item.telefone, termo)}</span>
                  {item.email && <span>📧 {destacarTexto(item.email, termo)}</span>}
                </div>
                {item.cidade && (
                  <p className="text-xs text-gray-500 mt-1">
                    📍 {item.cidade} - {item.estado}
                  </p>
                )}
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        );

      case 'produtos':
        return (
          <div
            key={item.id}
            onClick={() => onClicar(tipo, item)}
            className="p-4 hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer border-b last:border-b-0 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="font-semibold text-gray-900 dark:text-white mb-1">
                  {destacarTexto(item.nome, termo)}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Badge variant="outline">{item.categoria}</Badge>
                  {item.sku && (
                    <span className="text-xs font-mono font-medium text-gray-800 dark:text-gray-200">SKU: {destacarTexto(item.sku, termo)}</span>
                  )}
                  {item.codigo_barras && (
                    <span className="text-xs font-mono text-gray-600 dark:text-gray-400">EAN: {destacarTexto(item.codigo_barras, termo)}</span>
                  )}
                  {item.modelo_referencia && (
                    <span className="text-xs text-gray-500">Ref: {destacarTexto(item.modelo_referencia, termo)}</span>
                  )}
                </div>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="text-green-600 font-semibold">R$ {item.preco_venda?.toFixed(2)}</span>
                  <span className="text-gray-500">
                    Estoque: {item.quantidade_estoque || 0} un.
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        );

      case 'orcamentos':
        return (
          <div
            key={item.id}
            onClick={() => onClicar(tipo, item)}
            className="p-4 hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer border-b last:border-b-0 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {destacarTexto(item.numero_orcamento, termo)}
                  </span>
                  <Badge variant={
                    item.status === 'Aprovado' ? 'default' :
                    item.status === 'Convertido' ? 'default' :
                    item.status === 'Rejeitado' ? 'destructive' :
                    'secondary'
                  }>
                    {item.status}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Cliente: {destacarTexto(item.cliente_nome, termo)}
                </p>
                <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                  <span>📅 {formatarDataExibicao(item.data_orcamento)}</span>
                  <span>💰 R$ {item.valor_total?.toFixed(2)}</span>
                  <span>⏰ Validade: {formatarDataExibicao(item.validade)}</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        );

      case 'entregas':
        return (
          <div
            key={item.id}
            onClick={() => onClicar(tipo, item)}
            className="p-4 hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer border-b last:border-b-0 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {destacarTexto(item.numero_pedido, termo)}
                  </span>
                  <Badge variant={
                    item.status === 'Entregue' ? 'default' :
                    item.status === 'Em Rota' ? 'secondary' :
                    item.status === 'Cancelada' ? 'destructive' :
                    'outline'
                  }>
                    {item.status}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                  Cliente: {destacarTexto(item.cliente_nome, termo)}
                </p>
                <p className="text-xs text-gray-500 line-clamp-1">
                  📍 {destacarTexto(item.endereco_entrega, termo)}
                </p>
                {item.data_agendada && (
                  <p className="text-xs text-gray-500 mt-1">
                    📅 Agendada: {formatarDataExibicao(item.data_agendada)} - {item.turno}
                  </p>
                )}
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3 px-4">
        <Icon className="w-5 h-5 text-gray-500" />
        <h3 className="font-semibold text-gray-900 dark:text-white">{titulo}</h3>
        <Badge variant="secondary">{dados.length}</Badge>
      </div>
      <Card className="divide-y overflow-hidden">
        {dados.map(renderizarItem)}
      </Card>
    </div>
  );
}