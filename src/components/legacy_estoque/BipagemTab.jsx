import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useScanListener } from '@/hooks/useScanListener';
import { eanService } from '@/services/eanService';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Package, CheckCircle, AlertTriangle, Search, Link as LinkIcon,
    Plus, Minus, ArrowRight, RotateCcw, Loader2, ImageIcon,
    Layers, Ruler, RefreshCw
} from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ProdutoCadastroCompleto from '@/components/produtos/ProdutoCadastroCompleto';
import { getColorHex } from '@/components/produtos/FurnitureColorPicker';
import { toast } from 'sonner';
import { isValidGTIN, normalizeGTIN, generateSafeSKU } from '@/utils/gtinValidator';

// ─── Audio ────────────────────────────────────────────────────────
let audioCtx = null;
const playSound = (type) => {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        if (type === 'success') {
            osc.frequency.setValueAtTime(660, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
            osc.start(); osc.stop(audioCtx.currentTime + 0.1);
        } else if (type === 'error') {
            osc.frequency.setValueAtTime(220, audioCtx.currentTime);
            osc.type = 'sawtooth';
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            osc.start(); osc.stop(audioCtx.currentTime + 0.3);
        } else if (type === 'wait') {
            osc.frequency.setValueAtTime(440, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
            osc.start(); osc.stop(audioCtx.currentTime + 0.2);
        }
    } catch (e) { /* silently ignore */ }
};

// ─── Helper: compare names loosely ───────────────────────────────
function namesMatch(a, b) {
    if (!a || !b) return false;
    const normalize = s => s.toLowerCase().replace(/[^a-záàâãéèêíïóôõúç0-9]/gi, '').trim();
    return normalize(a) === normalize(b);
}

// ─── Multi-token search (same logic as EstoqueTab / supabase.js) ─
async function searchProdutosMultiToken(term) {
    if (!term || term.trim().length < 2) return [];
    const keywords = term.trim().split(/\s+/).filter(Boolean);

    let query = supabase.from('produtos').select('*');

    keywords.forEach(kw => {
        const escaped = kw.replace(/[%_]/g, '');
        query = query.or(
            `nome.ilike.%${escaped}%,` +
            `sku.ilike.%${escaped}%,` +
            `codigo_barras.ilike.%${escaped}%,` +
            `categoria.ilike.%${escaped}%,` +
            `modelo_referencia.ilike.%${escaped}%,` +
            `cor.ilike.%${escaped}%,` +
            `material.ilike.%${escaped}%,` +
            `ambiente.ilike.%${escaped}%,` +
            `fornecedor_nome.ilike.%${escaped}%,` +
            `descricao.ilike.%${escaped}%`
        );
    });

    const { data, error } = await query.order('nome').limit(15);
    if (error) { console.error('Search error:', error); return []; }
    return data || [];
}

// ═══════════════════════════════════════════════════════════════════
// STEPS: idle → loading → search → update → quantity → done
// ═══════════════════════════════════════════════════════════════════

export default function BipagemTab() {
    const { user } = useAuth();

    // ─── Wizard state ───────────────────────────────────────────
    const [step, setStep] = useState('idle');          // idle | loading | search | update | quantity | done
    const [pendingGtin, setPendingGtin] = useState(null);
    const [apiData, setApiData] = useState(null);      // normalized API result
    const [matchedProduct, setMatchedProduct] = useState(null); // selected internal product
    const [quantity, setQuantity] = useState(1);

    // ─── Search state ───────────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const debounceRef = useRef(null);

    // ─── Product creation modal ─────────────────────────────────
    const [showProdutoModal, setShowProdutoModal] = useState(false);
    const [savingProduct, setSavingProduct] = useState(false);

    // ─── History & feedback ─────────────────────────────────────
    const [scannedItems, setScannedItems] = useState([]);
    const [currentCard, setCurrentCard] = useState(null);
    const [manualCode, setManualCode] = useState('');

    // refs for auto-focus
    const searchInputRef = useRef(null);
    const quantityInputRef = useRef(null);

    // ─── Auto-focus when step changes ───────────────────────────
    useEffect(() => {
        if (step === 'search') {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        } else if (step === 'quantity') {
            setTimeout(() => {
                quantityInputRef.current?.focus();
                quantityInputRef.current?.select();
            }, 100);
        }
    }, [step]);

    // ─── Debounced search ───────────────────────────────────────
    const runSearch = useCallback((term) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!term || term.trim().length < 2) {
            setSearchResults([]);
            return;
        }
        setSearching(true);
        debounceRef.current = setTimeout(async () => {
            const results = await searchProdutosMultiToken(term);
            setSearchResults(results);
            setSearching(false);
        }, 350);
    }, []);

    // ─── Reset wizard ───────────────────────────────────────────
    const resetWizard = useCallback(() => {
        setStep('idle');
        setPendingGtin(null);
        setApiData(null);
        setMatchedProduct(null);
        setQuantity(1);
        setSearchTerm('');
        setSearchResults([]);
        setShowProdutoModal(false);
    }, []);

    // ═════════════════════════════════════════════════════════════
    // CORE: Handle a barcode scan
    // ═════════════════════════════════════════════════════════════
    const handleScan = useCallback(async (gtin) => {
        if (!gtin || step === 'loading') return;
        resetWizard();
        setStep('loading');
        setPendingGtin(gtin);
        setManualCode('');

        try {
            const result = await eanService.lookup(gtin);
            setApiData(result.apiData);

            if (result.source === 'internal') {
                const product = result.product;
                // Check if API data matches → skip to quantity or show update
                if (result.apiData && result.apiData.nome && !namesMatch(product.nome, result.apiData.nome)) {
                    // Internal product exists but name differs from universal registry
                    playSound('wait');
                    setMatchedProduct(product);
                    setStep('update');
                } else {
                    // Already correctly registered → go straight to quantity
                    playSound('wait');
                    setMatchedProduct(product);
                    setStep('quantity');
                }
            } else if (result.source === 'api') {
                // Found in API but not in internal DB → show search to find or create
                playSound('wait');
                setStep('search');
            } else {
                // Not found anywhere → show search to find or create
                playSound('error');
                setStep('search');
            }
        } catch (error) {
            console.error(error);
            playSound('error');
            setCurrentCard({ status: 'error', message: 'Erro ao processar: ' + error.message });
            setStep('idle');
        }
    }, [step, resetWizard]);

    // ═════════════════════════════════════════════════════════════
    // Select existing product from search results
    // ═════════════════════════════════════════════════════════════
    const handleSelectProduct = useCallback(async (product) => {
        if (!isValidGTIN(pendingGtin)) {
            toast.error('O código bipado não é um código de barras GTIN oficial válido (8, 12, 13 ou 14 dígitos).');
            return;
        }

        const validBarcode = normalizeGTIN(pendingGtin, true);

        // Link barcode to this product
        const { error } = await supabase
            .from('produtos')
            .update({ codigo_barras: validBarcode })
            .eq('id', product.id);

        if (error) {
            toast.error('Erro ao vincular código de barras: ' + error.message);
            return;
        }

        const updatedProduct = { ...product, codigo_barras: validBarcode };

        // Check if API has a better name
        if (apiData && apiData.nome && !namesMatch(product.nome, apiData.nome)) {
            setMatchedProduct(updatedProduct);
            setStep('update');
        } else {
            // Update NCM/foto if missing from API
            if (apiData) {
                const patch = {};
                if (!product.ncm && apiData.ncm) patch.ncm = apiData.ncm;
                if ((!product.fotos || !product.fotos.length) && apiData.foto_url) patch.fotos = [apiData.foto_url];
                if (Object.keys(patch).length > 0) {
                    await supabase.from('produtos').update(patch).eq('id', product.id);
                    Object.assign(updatedProduct, patch);
                }
            }
            setMatchedProduct(updatedProduct);
            setStep('quantity');
        }
    }, [pendingGtin, apiData]);

    const handleSkipUpdate = useCallback(() => {
        setStep('quantity');
    }, []);

    // ═════════════════════════════════════════════════════════════
    // Update product from API data
    // ═════════════════════════════════════════════════════════════
    const handleUpdateFromApi = useCallback(async () => {
        if (!matchedProduct || !apiData) return;

        const updates = { nome: apiData.nome };
        if (apiData.ncm && !matchedProduct.ncm) updates.ncm = apiData.ncm;
        if (apiData.foto_url && (!matchedProduct.fotos || matchedProduct.fotos.length === 0)) {
            updates.fotos = [apiData.foto_url];
        }

        const { error } = await supabase.from('produtos').update(updates).eq('id', matchedProduct.id);
        if (error) {
            toast.error('Erro ao atualizar: ' + error.message);
            return;
        }

        setMatchedProduct(prev => ({ ...prev, ...updates }));
        toast.success('Cadastro atualizado com informações do registro universal');
        setStep('quantity');
    }, [matchedProduct, apiData]);

    // ═════════════════════════════════════════════════════════════
    // Create new product flow (via ProdutoModal)
    // ═════════════════════════════════════════════════════════════
    const handleCreateProduct = useCallback(async (formData) => {
        setSavingProduct(true);
        try {
            const validGtin = (pendingGtin && isValidGTIN(pendingGtin))
                ? normalizeGTIN(pendingGtin, true)
                : (formData.codigo_barras && isValidGTIN(formData.codigo_barras) ? normalizeGTIN(formData.codigo_barras, true) : null);

            const { data, error } = await supabase.from('produtos').insert({
                ...formData,
                sku: formData.sku || generateSafeSKU('BIP'),
                codigo_barras: validGtin,
                ativo: true,
            }).select().single();

            if (error) throw error;

            setShowProdutoModal(false);
            setMatchedProduct(data);
            toast.success('Produto cadastrado');
            setStep('quantity');
        } catch (error) {
            toast.error('Erro ao cadastrar: ' + error.message);
        } finally {
            setSavingProduct(false);
        }
    }, [pendingGtin]);

    // ═════════════════════════════════════════════════════════════
    // Confirm quantity and update stock
    // ═════════════════════════════════════════════════════════════
    const handleConfirmQuantity = useCallback(async () => {
        if (!matchedProduct || quantity < 1) return;
        const tenantId = user?.loja || 'CD';
        const gtin = matchedProduct.codigo_barras || pendingGtin;

        try {
            const { error } = await supabase.from('estoque_loja').insert({
                gtin,
                tenant_id: tenantId,
                quantidade: quantity,
                data_movimento: new Date().toISOString()
            });
            if (error) throw error;

            await supabase.rpc('increment_estoque_global', { p_id: matchedProduct.id, p_qtd: quantity });

            playSound('success');
            setCurrentCard({
                status: 'success',
                message: `Estoque +${quantity}`,
                product: matchedProduct
            });
            setScannedItems(prev => [{
                ...matchedProduct,
                quantidade_adicionada: quantity,
                time: new Date().toLocaleTimeString(),
                status: 'success'
            }, ...prev.slice(0, 9)]);
            setStep('done');
        } catch (error) {
            playSound('error');
            toast.error('Erro ao atualizar estoque: ' + error.message);
        }
    }, [matchedProduct, quantity, pendingGtin, user]);

    // ─── Scan listener (disabled during active input steps) ─────
    const scanActive = step === 'idle' || step === 'done';
    useScanListener(scanActive ? handleScan : () => {});

    // ═════════════════════════════════════════════════════════════
    // RENDER
    // ═════════════════════════════════════════════════════════════
    return (
        <div className="flex flex-col h-full">
            <h1 className="text-3xl font-bold mb-6 flex items-center gap-2 text-slate-800">
                <Package className="h-8 w-8 text-primary" />
                Bipagem de Estoque
            </h1>

            {/* Manual input - always visible */}
            <div className="flex gap-4 mb-6">
                <Input
                    value={manualCode}
                    onChange={e => setManualCode(e.target.value)}
                    placeholder="Digitar ou bipar código de barras..."
                    className="text-lg py-6"
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            handleScan(manualCode);
                        }
                    }}
                    disabled={step === 'loading'}
                />
                <Button
                    size="lg"
                    onClick={() => handleScan(manualCode)}
                    disabled={step === 'loading' || !manualCode}
                >
                    {step === 'loading' ? <Loader2 className="h-5 w-5 animate-spin" /> : 'PROCESSAR'}
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* ─── Main Panel (2 cols) ─────────────────────── */}
                <div className="lg:col-span-2 flex flex-col">
                    {/* IDLE */}
                    {step === 'idle' && !currentCard && (
                        <div className="flex-1 flex items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 rounded-xl p-12">
                            <div className="text-center">
                                <Package className="w-16 h-16 mx-auto mb-4 opacity-30" />
                                <p className="text-xl">Aguardando leitura de código de barras...</p>
                                <p className="text-sm mt-2">Bipe um produto ou digite o código manualmente</p>
                            </div>
                        </div>
                    )}

                    {/* LOADING */}
                    {step === 'loading' && (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <Loader2 className="w-16 h-16 mx-auto mb-4 animate-spin text-primary" />
                                <p className="text-xl text-gray-600">Consultando código {pendingGtin}...</p>
                            </div>
                        </div>
                    )}

                    {/* SEARCH STEP: find or create product */}
                    {step === 'search' && (
                        <Card className="flex-1 flex flex-col">
                            <CardContent className="p-6 flex flex-col flex-1">
                                {/* API info header */}
                                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 mb-4">
                                    <p className="text-sm text-blue-600 font-medium">Código: {pendingGtin}</p>
                                    {apiData?.nome ? (
                                        <div className="mt-1">
                                            <p className="text-xs text-blue-500">Identificado no cadastro universal como:</p>
                                            <p className="font-bold text-lg text-blue-800">{apiData.nome}</p>
                                            {apiData.marca && <p className="text-sm text-blue-600">Marca: {apiData.marca}</p>}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-blue-500 mt-1">Nenhuma informação encontrada nas bases externas.</p>
                                    )}
                                </div>

                                <h3 className="font-semibold text-gray-800 mb-2">Este produto já está cadastrado no sistema?</h3>
                                <p className="text-sm text-gray-500 mb-3">Pesquise por nome, cor, material, categoria, fornecedor — em qualquer ordem.</p>

                                {/* Search input */}
                                <div className="relative mb-3">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <Input
                                        ref={searchInputRef}
                                        placeholder="Ex: guarda roupa henn branco"
                                        value={searchTerm}
                                        onChange={e => {
                                            setSearchTerm(e.target.value);
                                            runSearch(e.target.value);
                                        }}
                                        className="pl-10 h-11 border-2 border-primary/40 focus:border-primary"
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') e.preventDefault();
                                        }}
                                    />
                                    {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
                                </div>

                                {/* Search results */}
                                <ScrollArea className="flex-1 border rounded-lg min-h-0">
                                    {searchResults.length > 0 ? (
                                        <div className="divide-y">
                                            {searchResults.map(prod => {
                                                const qtd = (prod.quantidade_estoque || 0) - (prod.quantidade_reservada || 0);
                                                return (
                                                    <button
                                                        key={prod.id}
                                                        type="button"
                                                        onClick={() => handleSelectProduct(prod)}
                                                        className="w-full text-left px-4 py-3 hover:bg-green-50 transition-colors flex flex-col gap-1"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 shrink-0 border rounded overflow-hidden bg-gray-50 flex items-center justify-center">
                                                                {prod.fotos?.[0] ? (
                                                                    <img src={prod.fotos[0]} alt="" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <ImageIcon className="w-5 h-5 text-gray-300" />
                                                                )}
                                                            </div>
                                                            <span className="flex-1 text-sm font-medium text-gray-800 truncate">
                                                                {prod.nome}
                                                                {prod.modelo_referencia && <span className="text-gray-400 ml-1">- {prod.modelo_referencia}</span>}
                                                            </span>
                                                            <span className={`text-xs font-medium ${qtd > 0 ? 'text-green-600' : 'text-orange-500'}`}>
                                                                {qtd}un
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center flex-wrap gap-1.5 ml-13 pl-13">
                                                            {prod.cor && (
                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-700 font-medium flex items-center gap-1">
                                                                    {(() => {
                                                                        const colors = prod.cor.split('/').map(c => c.trim());
                                                                        const hex1 = getColorHex(colors[0]);
                                                                        const hex2 = colors.length > 1 ? getColorHex(colors[1]) : null;
                                                                        return (
                                                                            <>
                                                                                <div
                                                                                    className="w-3 h-3 rounded-full border border-gray-300"
                                                                                    style={{ background: hex2 ? `linear-gradient(135deg, ${hex1} 50%, ${hex2} 50%)` : hex1 }}
                                                                                />
                                                                                {prod.cor}
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </span>
                                                            )}
                                                            {prod.material && (
                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium flex items-center">
                                                                    <Layers className="w-3 h-3 mr-0.5" /> {prod.material}
                                                                </span>
                                                            )}
                                                            {(prod.largura || prod.altura) && (
                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium flex items-center">
                                                                    <Ruler className="w-3 h-3 mr-0.5" />
                                                                    {prod.largura || '?'}x{prod.altura || '?'}{prod.profundidade ? `x${prod.profundidade}` : ''} cm
                                                                </span>
                                                            )}
                                                            {prod.fornecedor_nome && (
                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                                                                    {prod.fornecedor_nome}
                                                                </span>
                                                            )}
                                                            {prod.categoria && (
                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                                                    {prod.categoria}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : searchTerm.length >= 2 && !searching ? (
                                        <div className="p-6 text-center text-gray-500">
                                            <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                                            <p className="text-sm">Nenhum produto encontrado para "{searchTerm}"</p>
                                        </div>
                                    ) : (
                                        <div className="p-6 text-center text-gray-400">
                                            <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                            <p className="text-sm">Digite para buscar produtos cadastrados</p>
                                        </div>
                                    )}
                                </ScrollArea>

                                {/* Actions */}
                                <div className="flex gap-2 mt-4 pt-4 border-t">
                                    <Button variant="outline" onClick={resetWizard}>Cancelar</Button>
                                    <Button
                                        className="ml-auto"
                                        onClick={() => setShowProdutoModal(true)}
                                    >
                                        <Plus className="w-4 h-4 mr-2" />
                                        Cadastrar Novo Produto
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* UPDATE STEP: API name differs from internal */}
                    {step === 'update' && matchedProduct && apiData && (
                        <Card className="flex-1 flex flex-col">
                            <CardContent className="p-6 flex flex-col gap-4">
                                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                    <RefreshCw className="w-5 h-5 text-amber-500" />
                                    Atualizar cadastro do produto?
                                </h3>
                                <p className="text-sm text-gray-500">
                                    O cadastro universal possui informações diferentes do cadastro interno. Deseja atualizar?
                                </p>

                                <div className="grid grid-cols-2 gap-4">
                                    {/* Current */}
                                    <div className="p-4 border rounded-lg bg-gray-50">
                                        <p className="text-xs font-medium text-gray-400 uppercase mb-2">Cadastro Atual</p>
                                        <p className="font-semibold text-gray-800">{matchedProduct.nome}</p>
                                        {matchedProduct.cor && <Badge variant="outline" className="mt-1 text-xs">{matchedProduct.cor}</Badge>}
                                    </div>
                                    {/* API */}
                                    <div className="p-4 border-2 border-primary/30 rounded-lg bg-green-50">
                                        <p className="text-xs font-medium text-primary uppercase mb-2">Cadastro Universal</p>
                                        <p className="font-semibold text-gray-800">{apiData.nome}</p>
                                        {apiData.marca && <p className="text-xs text-gray-500 mt-1">Marca: {apiData.marca}</p>}
                                    </div>
                                </div>

                                <div className="flex gap-2 justify-end pt-2">
                                    <Button variant="outline" onClick={handleSkipUpdate}>
                                        Manter atual
                                    </Button>
                                    <Button onClick={handleUpdateFromApi}>
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        Atualizar cadastro
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* QUANTITY STEP */}
                    {step === 'quantity' && matchedProduct && (
                        <Card className="flex-1 flex items-center justify-center">
                            <CardContent className="p-8 text-center w-full max-w-md">
                                {/* Product info */}
                                <div className="flex items-center gap-3 mb-6 text-left bg-gray-50 p-3 rounded-lg">
                                    <div className="w-12 h-12 shrink-0 border rounded overflow-hidden bg-white flex items-center justify-center">
                                        {matchedProduct.fotos?.[0] ? (
                                            <img src={matchedProduct.fotos[0]} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <ImageIcon className="w-6 h-6 text-gray-300" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-gray-800 truncate">{matchedProduct.nome}</p>
                                        <div className="flex gap-2 mt-0.5">
                                            {matchedProduct.cor && <Badge variant="secondary" className="text-xs">{matchedProduct.cor}</Badge>}
                                            {matchedProduct.modelo_referencia && <span className="text-xs text-gray-500">{matchedProduct.modelo_referencia}</span>}
                                        </div>
                                    </div>
                                </div>

                                <p className="text-sm text-gray-500 mb-4">Informe a quantidade a adicionar ao estoque:</p>

                                {/* Quantity controls */}
                                <div className="flex items-center justify-center gap-4 mb-6">
                                    <Button
                                        size="lg"
                                        variant="outline"
                                        className="h-14 w-14 text-xl"
                                        onClick={() => setQuantity(q => Math.max(1, q - 1))}
                                        disabled={quantity <= 1}
                                    >
                                        <Minus className="w-5 h-5" />
                                    </Button>
                                    <Input
                                        ref={quantityInputRef}
                                        type="number"
                                        min="1"
                                        value={quantity}
                                        onChange={e => {
                                            const val = parseInt(e.target.value);
                                            if (!isNaN(val) && val >= 1) setQuantity(val);
                                        }}
                                        className="w-24 h-14 text-center text-3xl font-bold border-2 border-primary/40"
                                    />
                                    <Button
                                        size="lg"
                                        variant="outline"
                                        className="h-14 w-14 text-xl"
                                        onClick={() => setQuantity(q => q + 1)}
                                    >
                                        <Plus className="w-5 h-5" />
                                    </Button>
                                </div>

                                <div className="flex gap-2 justify-center">
                                    <Button variant="outline" onClick={resetWizard}>Cancelar</Button>
                                    <Button
                                        size="lg"
                                        onClick={handleConfirmQuantity}
                                        className="px-8"
                                    >
                                        <CheckCircle className="w-5 h-5 mr-2" />
                                        Confirmar +{quantity}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* DONE / SUCCESS/ERROR CARD */}
                    {(step === 'done' || (step === 'idle' && currentCard)) && currentCard && (
                        <Card className={`flex-1 flex items-center justify-center border-4 shadow-xl ${currentCard.status === 'success' ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
                            <CardContent className="p-8 text-center">
                                {currentCard.status === 'success'
                                    ? <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-4" />
                                    : <AlertTriangle className="w-20 h-20 text-red-500 mx-auto mb-4" />
                                }
                                <h2 className="text-3xl font-bold mb-2">{currentCard.message}</h2>
                                {currentCard.product && (
                                    <div className="mt-4">
                                        <p className="text-xl font-medium">{currentCard.product.nome}</p>
                                        {currentCard.product.cor && <Badge variant="outline" className="mt-2 text-lg">{currentCard.product.cor}</Badge>}
                                    </div>
                                )}
                                <Button variant="outline" className="mt-6" onClick={resetWizard}>
                                    <RotateCcw className="w-4 h-4 mr-2" />
                                    Nova Bipagem
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* ─── History Panel (1 col) ──────────────────── */}
                <Card className="flex flex-col min-h-0">
                    <CardContent className="p-4 flex-1 flex flex-col min-h-0">
                        <h3 className="font-semibold mb-3 text-gray-700">Histórico Recente</h3>
                        <ScrollArea className="flex-1 min-h-0">
                            <div className="space-y-2">
                                {scannedItems.length === 0 && (
                                    <p className="text-center text-sm text-gray-400 py-8">Nenhum item bipado ainda</p>
                                )}
                                {scannedItems.map((item, i) => (
                                    <div key={i} className="flex justify-between items-center p-3 bg-white border rounded shadow-sm">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium text-sm truncate">{item.nome}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs text-gray-500">{item.codigo_barras || item.gtin}</span>
                                                <Badge variant="secondary" className="text-xs">+{item.quantidade_adicionada || 1}</Badge>
                                            </div>
                                        </div>
                                        <span className="text-xs text-gray-400 ml-2 shrink-0">{item.time}</span>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>

            {/* ─── Cadastro completo para novos produtos ── */}
            <ProdutoCadastroCompleto
                isOpen={showProdutoModal}
                onClose={() => setShowProdutoModal(false)}
                onSave={handleCreateProduct}
                isLoading={savingProduct}
                produto={apiData ? {
                    nome: apiData.nome || '',
                    codigo_barras: pendingGtin || '',
                    ncm: apiData.ncm || '',
                    fotos: apiData.foto_url ? [apiData.foto_url] : [],
                } : {
                    codigo_barras: pendingGtin || '',
                }}
            />
        </div>
    );
}
