import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, AlertTriangle, CheckCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { comprasService } from '@/services/comprasService';
import { supabase } from '@/lib/supabase';

/**
 * Modal para registrar o recebimento de uma OC
 * Permite validar quantidade de itens e registrar entrada em estoque
 */
export default function RecebimentoModal({
  isOpen,
  onClose,
  oc = null,
  onSuccess,
}) {
  const queryClient = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => { requestId.current = crypto.randomUUID(); }, [isOpen, oc?.id]);
  const [dados, setDados] = useState({
    chave_nfe: '',
    observacoes: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [itens, setItens] = useState([]);

  const getSaldoPendente = (item) => {
    const pedida = item.quantidade_pedida || 0;
    const recebidaAnterior = item.quantidade_recebida_anterior || 0;
    return Math.max(pedida - recebidaAnterior, 0);
  };

  const getQuantidadeEntrega = (item) => item.quantidade_recebida || 0;

  const getStatusPreview = (item) => {
    const pedida = item.quantidade_pedida || 0;
    const recebidaAnterior = item.quantidade_recebida_anterior || 0;
    const recebidaNestaEntrega = getQuantidadeEntrega(item);
    const totalRecebida = recebidaAnterior + recebidaNestaEntrega;

    if (totalRecebida >= pedida) return 'Completo';
    if (totalRecebida > 0) return 'Parcial';
    return 'Pendente';
  };

  // Buscar itens da OC ao abrir modal
  useEffect(() => {
    if (isOpen && oc?.id) {
      (async () => {
        try {
          const { data } = await supabase
            .from('compras_oc_itens')
            .select(`
              *,
              produtos!inner(
                id,
                nome,
                descricao,
                modelo_referencia,
                cor,
                material
              )
            `)
            .eq('ordem_compra_id', oc.id);

          setItens((data || []).map(item => {
            const quantidadeRecebidaAnterior = item.quantidade_recebida || 0;
            const saldoPendente = Math.max((item.quantidade_pedida || 0) - quantidadeRecebidaAnterior, 0);

            return {
              ...item,
              quantidade_recebida_anterior: quantidadeRecebidaAnterior,
              quantidade_recebida: 0,
              chegou: false,
              saldo_pendente: saldoPendente,
            };
          }));

          setDados({
            chave_nfe: '',
            observacoes: '',
          });
        } catch {
          toast.error('Erro ao carregar itens da OC');
        }
      })();
    }
  }, [isOpen, oc]);

  const handleToggleChegou = (index, checked) => {
    const itemAtualizado = { ...itens[index] };
    const saldoPendente = getSaldoPendente(itemAtualizado);

    if (checked) {
      itemAtualizado.chegou = true;
      itemAtualizado.quantidade_recebida = saldoPendente;
    } else {
      itemAtualizado.chegou = false;
      itemAtualizado.quantidade_recebida = 0;
    }

    const novoItens = [...itens];
    novoItens[index] = itemAtualizado;
    setItens(novoItens);
  };

  const handleQuantidadeChange = (index, novaQuantidade) => {
    const itemAtualizado = { ...itens[index] };
    const saldoPendente = getSaldoPendente(itemAtualizado);
    const valorAjustado = Math.max(0, Math.min(novaQuantidade, saldoPendente));
    itemAtualizado.quantidade_recebida = valorAjustado;
    itemAtualizado.chegou = valorAjustado > 0;

    const novoItens = [...itens];
    novoItens[index] = itemAtualizado;
    setItens(novoItens);
  };

  const itensRecebidosSelecionados = itens
    .filter(item => item.chegou && getQuantidadeEntrega(item) > 0)
    .map(item => ({
      item_id: item.id,
      quantidade_recebida: getQuantidadeEntrega(item),
    }));

  const totalItensRecebidosAgora = itensRecebidosSelecionados.length;

  const totalItensPendentes = itens.filter(item => {
    const restante = Math.max(
      (item.quantidade_pedida || 0) - ((item.quantidade_recebida_anterior || 0) + getQuantidadeEntrega(item)),
      0
    );
    return restante > 0;
  }).length;

  const temPendencia = totalItensPendentes > 0;

  // Mutation: registrar recebimento
  const receberMutation = useMutation({
    mutationFn: async () => {
      if (itensRecebidosSelecionados.length === 0) {
        throw new Error('Marque pelo menos um item como recebido para confirmar.');
      }

      setIsLoading(true);
      try {
        await comprasService.receberOc(oc.id, {
          request_id: requestId.current,
          itens_recebidos: itensRecebidosSelecionados,
          chave_nfe: dados.chave_nfe || '',
          observacoes: dados.observacoes || '',
        });
        toast.success(`OC ${oc.numero_pedido} recebida com sucesso`);
        return true;
      } finally {
        setIsLoading(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compras'] });
      queryClient.invalidateQueries({ queryKey: ['estoque'] });
      queryClient.invalidateQueries({ queryKey: ['pedidos-compra-recebimento'] });
      queryClient.invalidateQueries({ queryKey: ['pedidos-compra-recebimento-count'] });
      queryClient.invalidateQueries({ queryKey: ['historico-recebimentos-oc'] });
      onSuccess?.();
      onClose();
    },
    onError: (error) => {
      toast.error(`Erro ao receber OC: ${error.message}`);
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Registrar Recebimento - OC {oc?.numero_pedido}
            </div>
          </DialogTitle>
          <DialogDescription>
            Valide as quantidades recebidas de cada item
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Alerta de pendência */}
          {temPendencia && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-amber-900">Recebimento com itens pendentes</p>
                <p className="text-xs text-amber-700">
                  O que não for marcado como chegou ficará pendente para o próximo recebimento.
                </p>
              </div>
            </div>
          )}

          {/* Checklist de itens */}
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-24 text-center">Chegou?</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right w-24">Qtd Pedida</TableHead>
                  <TableHead className="text-right w-24">Já Recebida</TableHead>
                  <TableHead className="text-right w-28">Qtd Nesta Entrega</TableHead>
                  <TableHead className="text-right w-20">Falta</TableHead>
                  <TableHead className="text-right w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((item, index) => {
                  const saldoPendente = getSaldoPendente(item);
                  const recebidaNestaEntrega = getQuantidadeEntrega(item);
                  const faltaAposEntrega = Math.max(saldoPendente - recebidaNestaEntrega, 0);
                  const statusPreview = getStatusPreview(item);
                  const itemCompleto = saldoPendente === 0;

                  return (
                    <TableRow key={item.id} className={item.chegou ? 'bg-green-50/40' : ''}>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={itemCompleto ? true : item.chegou}
                          onCheckedChange={(checked) => handleToggleChegou(index, !!checked)}
                          disabled={itemCompleto}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">
                            {item.produto_nome}
                            {item.produtos?.modelo_referencia && <span className="text-blue-600 font-semibold ml-1">({item.produtos.modelo_referencia})</span>}
                          </span>
                          <div className="text-xs text-gray-700 space-y-0.5">
                            {item.produtos?.cor && (
                              <div><span className="font-medium">Cor:</span> {item.produtos.cor}</div>
                            )}
                            {item.produtos?.material && (
                              <div><span className="font-medium">Material:</span> {item.produtos.material}</div>
                            )}
                            {item.produtos?.descricao && (
                              <div><span className="font-medium">Desc:</span> {item.produtos.descricao}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {item.quantidade_pedida}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-gray-600">
                        {item.quantidade_recebida_anterior || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          max={saldoPendente}
                          value={recebidaNestaEntrega}
                          onChange={(e) =>
                            handleQuantidadeChange(index, parseInt(e.target.value) || 0)
                          }
                          disabled={!item.chegou || itemCompleto}
                          className="text-right font-mono text-sm w-full"
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {faltaAposEntrega}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <Badge
                          variant={
                            statusPreview === 'Completo'
                              ? 'default'
                              : statusPreview === 'Parcial'
                                ? 'secondary'
                                : 'outline'
                          }
                          className={statusPreview === 'Completo' ? 'bg-green-600' : ''}
                        >
                          {statusPreview}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Campos adicionais */}
          <div className="space-y-4 border-t pt-4">
            {/* Chave NFe */}
            <div>
              <Label htmlFor="chave_nfe">Chave NFe (opcional)</Label>
              <Input
                id="chave_nfe"
                placeholder="Chave de acesso da nota fiscal"
                value={dados.chave_nfe}
                onChange={(e) =>
                  setDados(prev => ({ ...prev, chave_nfe: e.target.value }))
                }
              />
            </div>

            {/* Observações */}
            <div>
              <Label htmlFor="observacoes">Observações</Label>
              <Textarea
                id="observacoes"
                placeholder="Alguma observação sobre o recebimento?"
                value={dados.observacoes}
                onChange={(e) =>
                  setDados(prev => ({ ...prev, observacoes: e.target.value }))
                }
                rows={3}
              />
            </div>
          </div>

          {/* Resumo */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <p className="font-semibold text-sm text-green-900">
                Checklist pronto para registrar
              </p>
            </div>
            <p className="text-xs text-green-700">
              Itens recebidos agora: {totalItensRecebidosAgora} | Itens pendentes: {totalItensPendentes}.
              O que não chegar agora continuará pendente para próximo recebimento.
            </p>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => receberMutation.mutate()}
            disabled={isLoading || itens.length === 0 || totalItensRecebidosAgora === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirmar Recebimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
