import React, { forwardRef } from 'react';
import { EMPRESA } from "@/config/empresa";

// O componente de EtiquetaImpressao
// Ref é usado pelo react-to-print para capturar o nó DOM que será impresso
const LAYOUT_CONFIGS = {
    "1/4": {
        pageSize: 'A4 portrait',
        gridClass: 'grid-cols-2',
        width: '105mm',
        height: '148.5mm',
        padding: '10mm',
        logoMaxHeight: 'max-h-16',
        logoMaxWidth: 'max-w-[200px]',
        companyNameSize: 'text-lg',
        productNameSize: 'text-xl',
        detailsSize: 'text-lg',
        detailsLabelSize: 'text-base',
        priceBoxMinHeight: 'min-h-[70px]',
        priceLabelSize: 'text-xl',
        priceSize: 'text-4xl',
        priceNormalSize: 'text-lg',
        headerMargin: 'mb-6 mt-4',
        productNameMargin: 'mb-3',
        detailsMargin: 'mb-3',
    },
    "1/6": {
        pageSize: 'A4 landscape',
        gridClass: 'grid-cols-3',
        width: '85mm',
        height: '105mm',
        padding: '6mm',
        logoMaxHeight: 'max-h-11',
        logoMaxWidth: 'max-w-[150px]',
        companyNameSize: 'text-sm',
        productNameSize: 'text-base',
        detailsSize: 'text-sm',
        detailsLabelSize: 'text-xs',
        priceBoxMinHeight: 'min-h-[50px]',
        priceLabelSize: 'text-sm',
        priceSize: 'text-2xl',
        priceNormalSize: 'text-xs',
        headerMargin: 'mb-2 mt-1',
        productNameMargin: 'mb-1.5',
        detailsMargin: 'mb-1.5',
    },
    "1/2": {
        pageSize: 'A4 portrait',
        gridClass: 'grid-cols-1',
        width: '210mm',
        height: '148.5mm',
        padding: '12mm',
        logoMaxHeight: 'max-h-20',
        logoMaxWidth: 'max-w-[250px]',
        companyNameSize: 'text-xl',
        productNameSize: 'text-2xl',
        detailsSize: 'text-xl',
        detailsLabelSize: 'text-lg',
        priceBoxMinHeight: 'min-h-[80px]',
        priceLabelSize: 'text-2xl',
        priceSize: 'text-5xl',
        priceNormalSize: 'text-xl',
        headerMargin: 'mb-6 mt-4',
        productNameMargin: 'mb-4',
        detailsMargin: 'mb-4',
    },
    "inteira": {
        pageSize: 'A4 portrait',
        gridClass: 'grid-cols-1',
        width: '210mm',
        height: '297mm',
        padding: '20mm',
        logoMaxHeight: 'max-h-32',
        logoMaxWidth: 'max-w-[350px]',
        companyNameSize: 'text-3xl',
        productNameSize: 'text-4xl',
        detailsSize: 'text-2xl',
        detailsLabelSize: 'text-xl',
        priceBoxMinHeight: 'min-h-[120px]',
        priceLabelSize: 'text-3xl',
        priceSize: 'text-7xl',
        priceNormalSize: 'text-2xl',
        headerMargin: 'mb-12 mt-8',
        productNameMargin: 'mb-8',
        detailsMargin: 'mb-8',
    }
};

export const EtiquetaImpressao = forwardRef(({ empresa, produtos, logoOption = 'default', logoCustomizadaUrl = '', layout = '1/4' }, ref) => {
    // Carregar configuração de tamanho base
    const currentLayout = LAYOUT_CONFIGS[layout] || LAYOUT_CONFIGS["1/4"];

    // Determinar o logo de acordo com a opção configurada
    let logoUrl = null;
    if (logoOption === 'default') {
        logoUrl = empresa?.logo_url || EMPRESA.logo_url;
    } else if (logoOption === 'custom') {
        logoUrl = logoCustomizadaUrl;
    }

    const showFallbackBox = logoOption !== 'none' && !logoUrl;
    const nomeEmpresa = empresa?.name || EMPRESA.nome;
    const isA5 = layout === "1/2";

    return (
        <div ref={ref} className="bg-white p-4 print:p-0">
            <style type="text/css" media="print">
                {`
          @page {
            size: ${currentLayout.pageSize};
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
            background-color: white;
          }
          .etiqueta-container {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          @media print {
            .no-print {
              display: none !important;
            }
          }
        `}
            </style>

            {/* Grid container dinâmico para organizar as etiquetas na página A4 */}
            <div className={`grid ${currentLayout.gridClass} gap-x-2 gap-y-2 print:gap-x-0 print:gap-y-0 pb-10 print:pb-0 justify-items-center`}>
                {produtos.map((produto, index) => (
                    <div
                        key={`${produto.id}-${index}`}
                        className="etiqueta-container relative bg-white border border-gray-300 print:border-none overflow-hidden font-sans"
                        style={{
                            width: currentLayout.width,
                            height: currentLayout.height,
                            background: 'linear-gradient(160deg, #1f1f1f 40%, #2b2b2b 60%, #4caf50 100%)',
                            padding: currentLayout.padding,
                            display: 'flex',
                            flexDirection: 'column',
                            boxSizing: 'border-box',
                        }}
                    >
                        {/* Header com Logo e Nome da Empresa */}
                        <div className={`flex flex-col items-center justify-center ${currentLayout.headerMargin}`}>
                            {logoUrl && (
                                <img
                                    src={logoUrl}
                                    alt={nomeEmpresa}
                                    className={`${currentLayout.logoMaxHeight} ${currentLayout.logoMaxWidth} object-contain mb-2 shadow-sm`}
                                />
                            )}
                            {showFallbackBox && (
                                <div className={`${layout === 'inteira' ? 'h-24 w-24' : layout === '1/6' ? 'h-10 w-10' : 'h-16 w-16'} bg-white/20 rounded mb-2 flex items-center justify-center`}>
                                    <span className={`text-white font-bold ${layout === 'inteira' ? 'text-3xl' : layout === '1/6' ? 'text-sm' : 'text-xl'}`}>
                                        {nomeEmpresa.charAt(0)}
                                    </span>
                                </div>
                            )}
                            <h1 className={`text-white font-bold uppercase tracking-widest text-center ${currentLayout.companyNameSize}`}>
                                {nomeEmpresa}
                            </h1>
                        </div>

                        {/* Nome do Produto em Destaque Branca arredondada */}
                        <div className={`bg-white rounded-xl py-2 px-3 ${currentLayout.productNameMargin} shadow-sm w-full border border-gray-200`}>
                            <h2 className={`${currentLayout.productNameSize} font-bold text-gray-800 text-center uppercase break-words leading-tight`}>
                                {produto.nome} {produto.modelo_referencia ? ` ${produto.modelo_referencia}` : ''}
                            </h2>
                        </div>

                        {isA5 ? (
                            /* Layout especial lado a lado para 1/2 Folha */
                            <div className="flex gap-4 flex-grow min-h-0">
                                {/* Detalhes (60%) */}
                                <div className="bg-white rounded-xl py-3 px-4 shadow-sm border border-gray-200 flex-[1.5] flex flex-col justify-center min-w-0">
                                    <div className="space-y-1 overflow-hidden">
                                        {produto.sku ? (
                                            <p className={`${currentLayout.detailsSize} font-medium text-gray-700 uppercase leading-snug truncate`}>
                                                SKU: {produto.sku}
                                            </p>
                                        ) : produto.codigo_barras ? null : (
                                            <p className={`${currentLayout.detailsSize} font-medium text-gray-700 uppercase leading-snug truncate`}>
                                                COD: {produto.id?.substring(0, 8)}
                                            </p>
                                        )}
                                        {produto.codigo_barras && (
                                            <p className={`${currentLayout.detailsSize} font-medium text-gray-700 uppercase leading-snug truncate`}>
                                                EAN: {produto.codigo_barras}
                                            </p>
                                        )}
                                        <p className={`${currentLayout.detailsSize} font-medium text-gray-700 uppercase leading-snug truncate`}>
                                            COR: {produto.cor || 'A CONSULTAR'}
                                        </p>
                                        {(produto.largura || produto.altura || produto.profundidade) && (
                                            <p className={`${currentLayout.detailsLabelSize} font-medium text-gray-600 uppercase leading-snug truncate`}>
                                                MEDIDAS: {produto.largura || '?'}x{produto.altura || '?'}x{produto.profundidade || '?'} CM
                                            </p>
                                        )}
                                        <p className="text-sm font-medium text-gray-400 uppercase leading-snug text-right mt-auto">
                                            {produto.origem_nfe ? 'NFE / ' : ''}
                                        </p>
                                    </div>
                                </div>
                                {/* Preço (40%) */}
                                <div className="bg-white rounded-xl py-3 px-4 shadow-sm border border-gray-200 flex-1 flex items-center justify-center relative min-w-0">
                                    {produto.preco_promocional && produto.preco_promocional > 0 && produto.preco_promocional < produto.preco_venda ? (
                                        <div className="flex flex-col items-center w-full min-w-0">
                                            <div className="text-gray-400 font-bold text-sm line-through truncate">
                                                R$ {produto.preco_venda?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </div>
                                            <div className="flex items-baseline gap-1 min-w-0">
                                                <span className="text-gray-900 font-bold text-base">R$</span>
                                                <span className="text-gray-900 font-black text-3xl tracking-tight leading-none truncate">
                                                    {produto.preco_promocional?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-baseline gap-1 min-w-0">
                                            <span className="text-gray-900 font-bold text-base">R$</span>
                                            <span className="text-gray-900 font-black text-3xl tracking-tight leading-none truncate">
                                                {produto.preco_venda?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            /* Layout padrão empilhado para 1/4, 1/6, inteira */
                            <>
                                {/* Detalhes do Produto */}
                                <div className={`bg-white rounded-xl py-2 px-4 ${currentLayout.detailsMargin} shadow-sm w-full border border-gray-200 flex-grow flex flex-col justify-center min-h-0`}>
                                    <div className="space-y-1">
                                        {produto.sku ? (
                                            <p className={`${currentLayout.detailsSize} font-medium text-gray-700 uppercase leading-snug truncate`}>
                                                SKU: {produto.sku}
                                            </p>
                                        ) : produto.codigo_barras ? null : (
                                            <p className={`${currentLayout.detailsSize} font-medium text-gray-700 uppercase leading-snug truncate`}>
                                                COD: {produto.id?.substring(0, 8)}
                                            </p>
                                        )}
                                        {produto.codigo_barras && (
                                            <p className={`${currentLayout.detailsSize} font-medium text-gray-700 uppercase leading-snug truncate`}>
                                                EAN: {produto.codigo_barras}
                                            </p>
                                        )}
                                        <p className={`${currentLayout.detailsSize} font-medium text-gray-700 uppercase leading-snug truncate`}>
                                            COR: {produto.cor || 'A CONSULTAR'}
                                        </p>
                                        {(produto.largura || produto.altura || produto.profundidade) && (
                                            <p className={`${currentLayout.detailsLabelSize} font-medium text-gray-600 uppercase leading-snug truncate`}>
                                                MEDIDAS: {produto.largura || '?'}x{produto.altura || '?'}x{produto.profundidade || '?'} CM
                                            </p>
                                        )}
                                        <p className="text-xs font-medium text-gray-400 uppercase leading-snug text-right mt-auto">
                                            {produto.origem_nfe ? 'NFE / ' : ''}
                                        </p>
                                    </div>
                                </div>

                                {/* Preço */}
                                <div className={`bg-white rounded-xl py-2 px-4 shadow-sm w-full border border-gray-200 mt-auto flex items-center justify-center relative min-h-0 ${currentLayout.priceBoxMinHeight}`}>
                                    {produto.preco_promocional && produto.preco_promocional > 0 && produto.preco_promocional < produto.preco_venda ? (
                                        <div className="flex flex-col items-center w-full min-w-0">
                                            <div className={`${currentLayout.priceNormalSize} text-gray-400 font-bold line-through -mb-1 truncate`}>
                                                R$ {produto.preco_venda?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </div>
                                            <div className="flex items-baseline gap-1 min-w-0">
                                                <span className={`${currentLayout.priceLabelSize} text-gray-900 font-bold`}>R$</span>
                                                <span className={`${currentLayout.priceSize} text-gray-900 font-black tracking-tight leading-none truncate`}>
                                                    {produto.preco_promocional?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-baseline gap-1 min-w-0">
                                            <span className={`${currentLayout.priceLabelSize} text-gray-900 font-bold`}>R$</span>
                                            <span className={`${currentLayout.priceSize} text-gray-900 font-black tracking-tight leading-none truncate`}>
                                                {produto.preco_venda?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                    </div>
                ))}
            </div>
        </div>
    );
});

EtiquetaImpressao.displayName = 'EtiquetaImpressao';

export default EtiquetaImpressao;
