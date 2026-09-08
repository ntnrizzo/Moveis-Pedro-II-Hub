import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Package, ArrowRightLeft,
  ClipboardCheck, Truck, ScanBarcode
} from "lucide-react";

// Tab Components
import EstoqueTab from "../components/legacy_estoque/EstoqueTab";
import BipagemTab from "../components/legacy_estoque/BipagemTab";
import TransferenciasTab from "../components/legacy_estoque/TransferenciasTab";
import InventarioTab from "../components/legacy_estoque/InventarioTab";
import RecebimentosTab from "../components/legacy_estoque/RecebimentosTab";
import { comprasService } from '@/services/comprasService';

export default function Estoque() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState("estoque");

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list('nome'),
  });

  const { data: transferencias = [] } = useQuery({
    queryKey: ['transferencias-estoque'],
    queryFn: () => base44.entities.TransferenciaEstoque.list(),
  });

  const transferenciasPendentes = transferencias.filter(t => t.status === 'Pendente').length;

  const { data: pedidos = [] } = useQuery({
    queryKey: ['pedidos-compra-recebimento-count'],
    queryFn: async () => {
      const data = await comprasService.listOcs('-created_at');
      return (data || []).filter(p => ['Pedido Enviado', 'Parcialmente Recebido'].includes(p.status));
    }
  });
  const pedidosPendentes = pedidos.length;

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-700" />
      </div>
    );
  }

  const tabs = [
    { id: "estoque", label: "Produtos", icon: Package, count: produtos.length },
    { id: "recebimentos", label: "Recebimentos", icon: Truck, count: pedidosPendentes, variant: "default" },
    { id: "transferencias", label: "Transferências", icon: ArrowRightLeft, count: transferenciasPendentes },
    { id: "bipagem", label: "Bipagem Rápida", icon: ScanBarcode },
    { id: "inventario", label: "Inventário", icon: ClipboardCheck },
  ];

  return (
    <div className="p-4 md:p-8 space-y-6">


      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex w-full md:w-max h-auto p-1.5 bg-gray-100/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-sm gap-1 overflow-x-auto no-scrollbar">
          {tabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex items-center gap-2.5 px-6 py-2.5 rounded-xl transition-all duration-200 data-[state=active]:bg-white data-[state=active]:text-green-700 data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-gray-200 hover:bg-white/50 whitespace-nowrap"
            >
              <tab.icon className="w-4 h-4 transition-colors" />
              <span className="font-semibold text-sm">{tab.label}</span>
              {tab.count > 0 && (
                <Badge
                  variant={tab.variant || "secondary"}
                  className={`ml-1 h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full ${tab.variant === "destructive"
                    ? "bg-red-100 text-red-700"
                    : "bg-green-100 text-green-700"
                    }`}
                >
                  {tab.count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="estoque" className="m-0">
            <EstoqueTab user={user} />
          </TabsContent>
          <TabsContent value="transferencias" className="m-0">
            <TransferenciasTab user={user} />
          </TabsContent>
          <TabsContent value="recebimentos" className="m-0">
            <RecebimentosTab />
          </TabsContent>
          <TabsContent value="bipagem" className="m-0">
            <BipagemTab />
          </TabsContent>
          <TabsContent value="inventario" className="m-0">
            <InventarioTab user={user} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}