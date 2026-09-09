import { useAuth } from "@/hooks/useAuth";
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function CategoriasManager({ categorias }) {
  const { can } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategoria, setEditingCategoria] = useState(null);
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "Ambos",
    cor: "#07593f",
    ativa: true
  });

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => {
      if (!can("create_financial_category")) throw new Error("Sem permissão para criar categorias.");
      return base44.entities.CategoriaFinanceira.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias-financeiras'] });
      setIsModalOpen(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      if (!can("manage_financial_categories")) throw new Error("Somente administrador pode editar categorias.");
      return base44.entities.CategoriaFinanceira.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias-financeiras'] });
      setIsModalOpen(false);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => {
      if (!can("manage_financial_categories")) throw new Error("Somente administrador pode excluir categorias.");
      return base44.entities.CategoriaFinanceira.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias-financeiras'] });
    }
  });

  const resetForm = () => {
    setFormData({
      nome: "",
      tipo: "Ambos",
      cor: "#07593f",
      ativa: true
    });
    setEditingCategoria(null);
  };

  const handleEdit = (categoria) => {
    setEditingCategoria(categoria);
    setFormData({
      nome: categoria.nome,
      tipo: categoria.tipo,
      cor: categoria.cor || "#07593f",
      ativa: categoria.ativa !== false
    });
    setIsModalOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (editingCategoria) {
      updateMutation.mutate({
        id: editingCategoria.id,
        data: formData
      });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm('Tem certeza que deseja excluir esta categoria?')) {
      deleteMutation.mutate(id);
    }
  };

  const getTipoBadge = (tipo) => {
    const styles = {
      'Entrada': 'bg-green-100 text-green-800',
      'Saída': 'bg-red-100 text-red-800',
      'Ambos': 'bg-blue-100 text-blue-800'
    };
    
    return <Badge className={styles[tipo]}>{tipo}</Badge>;
  };

  const coresDisponiveis = [
    { nome: "Verde Escuro", valor: "#07593f" },
    { nome: "Laranja", valor: "#f38a4c" },
    { nome: "Azul", valor: "#3b82f6" },
    { nome: "Vermelho", valor: "#dc2626" },
    { nome: "Roxo", valor: "#8b5cf6" },
    { nome: "Verde", valor: "#10b981" },
    { nome: "Amarelo", valor: "#f59e0b" },
    { nome: "Rosa", valor: "#ec4899" }
  ];

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              Gerenciar Categorias
            </CardTitle>
            <Button
              onClick={() => {
                resetForm();
                setIsModalOpen(true);
              }}
              style={{ background: 'linear-gradient(135deg, #f38a4c 0%, #f5a164 100%)' }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Nova Categoria
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categorias.map((cat) => (
              <Card key={cat.id} className="border" style={{ borderColor: cat.cor || '#E5E0D8' }}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-8 h-8 rounded-full"
                        style={{ backgroundColor: cat.cor || '#07593f' }}
                      />
                      <div>
                        <h3 className="font-semibold" style={{ color: '#07593f' }}>
                          {cat.nome}
                        </h3>
                        {getTipoBadge(cat.tipo)}
                      </div>
                    </div>
                  </div>
                  
                  {!cat.ativa && (
                    <Badge variant="outline" className="mb-2">
                      Inativa
                    </Badge>
                  )}
                  
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!can("manage_financial_categories")}
                      onClick={() => handleEdit(cat)}
                      className="flex-1"
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(cat.id)}
                      disabled={!can("manage_financial_categories") || deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {categorias.length === 0 && (
            <div className="text-center py-12">
              <Tag className="w-16 h-16 mx-auto mb-4 opacity-20" style={{ color: '#07593f' }} />
              <p className="text-xl" style={{ color: '#8B8B8B' }}>
                Nenhuma categoria cadastrada
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCategoria ? 'Editar Categoria' : 'Nova Categoria'}
            </DialogTitle>
            <DialogDescription>
              Configure as informações da categoria financeira
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="nome">Nome da Categoria *</Label>
                <Input
                  id="nome"
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="Ex: Vendas, Aluguel, Salários..."
                  required
                />
              </div>

              <div>
                <Label htmlFor="tipo">Tipo *</Label>
                <Select
                  value={formData.tipo}
                  onValueChange={(value) => setFormData({ ...formData, tipo: value })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Entrada">Apenas Entradas</SelectItem>
                    <SelectItem value="Saída">Apenas Saídas</SelectItem>
                    <SelectItem value="Ambos">Ambos (Entrada e Saída)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="cor">Cor da Categoria</Label>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {coresDisponiveis.map((cor) => (
                    <button
                      key={cor.valor}
                      type="button"
                      onClick={() => setFormData({ ...formData, cor: cor.valor })}
                      className={`w-full h-12 rounded-lg transition-all ${
                        formData.cor === cor.valor ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''
                      }`}
                      style={{ backgroundColor: cor.valor }}
                      title={cor.nome}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="ativa"
                  checked={formData.ativa}
                  onChange={(e) => setFormData({ ...formData, ativa: e.target.checked })}
                  className="rounded"
                />
                <Label htmlFor="ativa" className="cursor-pointer">
                  Categoria Ativa
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => {
                  setIsModalOpen(false);
                  resetForm();
                }}
              >
                Cancelar
              </Button>
              <Button 
                type="submit"
                disabled={!(editingCategoria ? can("manage_financial_categories") : can("create_financial_category")) || createMutation.isPending || updateMutation.isPending}
                style={{ background: 'linear-gradient(135deg, #07593f 0%, #0a6b4d 100%)' }}
              >
                {(createMutation.isPending || updateMutation.isPending) ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}