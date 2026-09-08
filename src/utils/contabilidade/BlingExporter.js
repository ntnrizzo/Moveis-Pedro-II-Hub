/**
 * Exportador para formato Bling
 * 
 * Gera arquivo XML compatível com importação Bling ERP
 */

import { isValidGTIN } from '../gtinValidator';

const formatarData = (data) => {
    if (!data) return '';
    const d = new Date(data);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
};

const formatarValor = (valor) => {
    if (!valor) return '0.00';
    return Number(valor).toFixed(2);
};

const escaparXML = (texto) => {
    if (!texto) return '';
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
};

/**
 * Exporta vendas/pedidos para formato Bling XML
 */
export function exportarPedidosBling(vendas) {
    const pedidos = vendas.map(v => `
        <pedido>
            <idPedido>${v.id}</idPedido>
            <numero>${escaparXML(v.numero_pedido || '')}</numero>
            <dataVenda>${formatarData(v.data_venda)}</dataVenda>
            <cliente>
                <nome>${escaparXML(v.cliente_nome || 'Cliente')}</nome>
                <cpf_cnpj>${escaparXML(v.cliente_cpf || v.cliente_cnpj || '')}</cpf_cnpj>
                <email>${escaparXML(v.cliente_email || '')}</email>
                <fone>${escaparXML(v.cliente_telefone || '')}</fone>
                <endereco>${escaparXML(v.endereco_entrega || '')}</endereco>
            </cliente>
            <vendedor>${escaparXML(v.vendedor_nome || '')}</vendedor>
            <itens>
                ${(v.itens || []).map(item => `
                    <item>
                        <codigo>${escaparXML(item.produto_sku || item.sku || item.produto_codigo || item.produto_id || '')}</codigo>
                        <descricao>${escaparXML(item.produto_nome || 'Produto')}</descricao>
                        <qtde>${item.quantidade || 1}</qtde>
                        <vlr_unit>${formatarValor(item.preco_unitario)}</vlr_unit>
                    </item>
                `).join('')}
            </itens>
            <vlr_frete>0.00</vlr_frete>
            <vlr_desconto>${formatarValor(v.desconto || 0)}</vlr_desconto>
            <obs>${escaparXML(v.observacoes || '')}</obs>
            <obs_internas>Exportado do Sistema de Gestão</obs_internas>
        </pedido>
    `).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<pedidos>
    ${pedidos}
</pedidos>`;
}

/**
 * Exporta produtos para formato Bling XML
 */
export function exportarProdutosBling(produtos) {
    const itens = produtos.map(p => {
        const codigoValido = p.sku || p.id || '';
        const gtinValido = isValidGTIN(p.codigo_barras) ? p.codigo_barras : '';
        return `
        <produto>
            <codigo>${escaparXML(codigoValido)}</codigo>
            ${gtinValido ? `<gtin>${escaparXML(gtinValido)}</gtin>` : ''}
            <descricao>${escaparXML(p.nome)}</descricao>
            <un>UN</un>
            <vlr_unit>${formatarValor(p.preco_venda)}</vlr_unit>
            <preco_custo>${formatarValor(p.preco_custo)}</preco_custo>
            <peso_bruto>0</peso_bruto>
            <peso_liq>0</peso_liq>
            <class_fiscal>${escaparXML(p.ncm || '')}</class_fiscal>
            <origem>${p.origem || '0'}</origem>
            <estoque>${p.quantidade_estoque || 0}</estoque>
            <deposito>Geral</deposito>
            <descricaoComplementar>${escaparXML(p.descricao || '')}</descricaoComplementar>
            <tipo>P</tipo>
            <situacao>A</situacao>
            <unidadeMedida>UN</unidadeMedida>
            <categoria>${escaparXML(p.categoria || 'Móveis')}</categoria>
        </produto>
    `;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<produtos>
    ${itens}
</produtos>`;
}

/**
 * Exporta clientes/contatos para formato Bling XML
 */
export function exportarContatosBling(clientes) {
    const contatos = clientes.map(c => `
        <contato>
            <nome>${escaparXML(c.nome_completo || c.razao_social)}</nome>
            <fantasia>${escaparXML(c.nome_completo || '')}</fantasia>
            <tipoPessoa>${c.tipo_pessoa === 'PJ' ? 'J' : 'F'}</tipoPessoa>
            <cpf_cnpj>${escaparXML(c.cpf || c.cnpj || '')}</cpf_cnpj>
            <ie_rg>${escaparXML(c.inscricao_estadual || c.rg || '')}</ie_rg>
            <endereco>${escaparXML(c.endereco || '')}</endereco>
            <numero>${escaparXML(c.numero || '')}</numero>
            <complemento>${escaparXML(c.complemento || '')}</complemento>
            <bairro>${escaparXML(c.bairro || '')}</bairro>
            <cidade>${escaparXML(c.cidade || '')}</cidade>
            <uf>${escaparXML(c.estado || '')}</uf>
            <cep>${escaparXML((c.cep || '').replace(/\D/g, ''))}</cep>
            <fone>${escaparXML(c.telefone || '')}</fone>
            <email>${escaparXML(c.email || '')}</email>
            <contribuinte>9</contribuinte>
        </contato>
    `).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<contatos>
    ${contatos}
</contatos>`;
}

/**
 * Exporta contas a pagar/receber para Bling
 */
export function exportarContasBling(lancamentos) {
    const contas = lancamentos.map(l => `
        <conta>
            <dataEmissao>${formatarData(l.created_at || l.data_lancamento)}</dataEmissao>
            <vencimentoOriginal>${formatarData(l.data_lancamento)}</vencimentoOriginal>
            <competencia>${formatarData(l.data_lancamento)}</competencia>
            <nroDocumento>${escaparXML(l.numero_pedido || l.id)}</nroDocumento>
            <valor>${formatarValor(Math.abs(l.valor))}</valor>
            <historico>${escaparXML(l.descricao || '')}</historico>
            <categoria>${escaparXML(l.categoria || 'Outros')}</categoria>
            <idFormaPagamento></idFormaPagamento>
            <portador>Caixa Principal</portador>
            <ocorrencia>U</ocorrencia>
        </conta>
    `).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<contas>
    ${contas}
</contas>`;
}

export function downloadXML(conteudo, nomeArquivo) {
    const blob = new Blob([conteudo], { type: 'application/xml;charset=utf-8' });
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
    exportarPedidosBling,
    exportarProdutosBling,
    exportarContatosBling,
    exportarContasBling,
    downloadXML
};
