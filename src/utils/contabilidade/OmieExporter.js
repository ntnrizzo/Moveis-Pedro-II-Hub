/**
 * Exportador para formato Omie
 * 
 * Gera arquivo CSV compatível com importação Omie ERP
 */

const formatarData = (data) => {
    if (!data) return '';
    const d = new Date(data);
    return d.toLocaleDateString('pt-BR');
};

const formatarValor = (valor) => {
    if (!valor) return '0,00';
    return Number(valor).toFixed(2).replace('.', ',');
};

const isLancamentoCancelado = (status) =>
    String(status || '').trim().toLowerCase().startsWith('cancelad');

/**
 * Exporta lançamentos financeiros para formato Omie
 */
export function exportarLancamentosOmie(lancamentos, options = {}) {
    const { incluirCancelados = false } = options;

    const lancamentosFiltrados = lancamentos.filter(l =>
        incluirCancelados || !isLancamentoCancelado(l.status)
    );

    // Cabeçalho padrão Omie para contas a pagar/receber
    const header = [
        'Data Vencimento',
        'Data Previsao',
        'Codigo Cliente Fornecedor',
        'Nome Cliente Fornecedor',
        'Valor Documento',
        'Numero Documento',
        'Codigo Categoria',
        'Descricao',
        'Observacao'
    ].join(';');

    const linhas = lancamentosFiltrados.map(l => {
        return [
            formatarData(l.data_lancamento),
            formatarData(l.data_lancamento),
            l.cliente_id || l.fornecedor_id || '',
            `"${(l.cliente_nome || l.fornecedor_nome || 'Diversos').replace(/"/g, '""')}"`,
            formatarValor(Math.abs(l.valor)),
            l.numero_pedido || l.id || '',
            mapearCategoriaOmie(l.categoria),
            `"${(l.descricao || '').replace(/"/g, '""')}"`,
            `"${(l.observacao || '').replace(/"/g, '""')}"`
        ].join(';');
    });

    return [header, ...linhas].join('\n');
}

/**
 * Exporta produtos para formato Omie
 */
export function exportarProdutosOmie(produtos) {
    const header = [
        'Codigo',
        'Descricao',
        'Codigo Familia',
        'Unidade',
        'NCM',
        'Valor Unitario',
        'Quantidade Estoque'
    ].join(';');

    const linhas = produtos.map(p => {
        return [
            p.sku || p.id || '',
            `"${(p.nome || '').replace(/"/g, '""')}"`,
            mapearCategoriaOmie(p.categoria),
            'UN',
            p.ncm || '',
            formatarValor(p.preco_venda),
            p.quantidade_estoque || 0
        ].join(';');
    });

    return [header, ...linhas].join('\n');
}

/**
 * Exporta clientes para formato Omie
 */
export function exportarClientesOmie(clientes) {
    const header = [
        'Codigo Cliente Omie',
        'Razao Social',
        'Nome Fantasia',
        'CNPJ CPF',
        'Inscricao Estadual',
        'Email',
        'Telefone 1 DDD',
        'Telefone 1 Numero',
        'Endereco',
        'Endereco Numero',
        'Bairro',
        'Cidade',
        'Estado',
        'CEP'
    ].join(';');

    const linhas = clientes.map(c => {
        const telefone = (c.telefone || '').replace(/\D/g, '');
        const ddd = telefone.substring(0, 2);
        const numero = telefone.substring(2);

        return [
            '', // Codigo - deixar vazio para Omie gerar
            `"${(c.razao_social || c.nome_completo || '').replace(/"/g, '""')}"`,
            `"${(c.nome_completo || '').replace(/"/g, '""')}"`,
            c.cnpj || c.cpf || '',
            c.inscricao_estadual || '',
            c.email || '',
            ddd,
            numero,
            `"${(c.endereco || '').replace(/"/g, '""')}"`,
            c.numero || '',
            c.bairro || '',
            c.cidade || '',
            c.estado || '',
            (c.cep || '').replace(/\D/g, '')
        ].join(';');
    });

    return [header, ...linhas].join('\n');
}

/**
 * Mapeia categorias do sistema para códigos Omie
 */
function mapearCategoriaOmie(categoria) {
    const mapeamento = {
        'Vendas': '1.01.01',
        'Serviços': '1.01.02',
        'Aluguel': '2.01.01',
        'Salários': '2.02.01',
        'Fornecedores': '2.03.01',
        'Impostos': '2.04.01',
        'Marketing': '2.05.01',
        'Outros': '2.99.99'
    };
    return mapeamento[categoria] || '2.99.99';
}

export function downloadCSV(conteudo, nomeArquivo) {
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + conteudo], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export default {
    exportarLancamentosOmie,
    exportarProdutosOmie,
    exportarClientesOmie,
    downloadCSV
};
