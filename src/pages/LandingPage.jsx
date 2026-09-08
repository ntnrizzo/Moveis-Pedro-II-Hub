import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Building2, ShieldCheck, TrendingUp, Truck, Wrench, Boxes, Users,
    BarChart3, ArrowRight, CheckCircle2, Lock, ChevronDown,
    Zap, Headphones, Smartphone, Check, Globe, DollarSign, Store, Crown,
    MessageCircle, Menu, X, LogIn, HelpCircle, FileText, Award,
    CreditCard, ArrowDown, Sparkles, MapPin, ShoppingBag, ChevronRight
} from "lucide-react";
import gestappMockup from "@/assets/gestapp-mockup.png.png";

// ============================================================================
// COMPONENTE DE ANIMAÇÃO AO ROLAR (SCROLL REVEAL VIA INTERSECTION OBSERVER)
// ============================================================================
function Reveal({ children, className = "", delay = 0, direction = "up" }) {
    const [isVisible, setIsVisible] = useState(false);
    const elementRef = useRef(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                // Atualiza de acordo com o estado de visibilidade na tela
                setIsVisible(entry.isIntersecting);
            },
            {
                threshold: 0.12,
                rootMargin: "0px 0px -40px 0px"
            }
        );

        const currentElement = elementRef.current;
        if (currentElement) {
            observer.observe(currentElement);
        }

        return () => {
            if (currentElement) observer.unobserve(currentElement);
        };
    }, []);

    const directionClass = {
        up: "translate-y-8",
        down: "-translate-y-8",
        left: "translate-x-8",
        right: "-translate-x-8",
        scale: "scale-95"
    }[direction] || "translate-y-8";

    return (
        <div
            ref={elementRef}
            style={{ transitionDelay: isVisible ? `${delay}ms` : "0ms" }}
            className={`transition-all duration-700 ease-out will-change-transform ${isVisible
                ? "opacity-100 translate-x-0 translate-y-0 scale-100"
                : `opacity-0 ${directionClass}`
                } ${className}`}
        >
            {children}
        </div>
    );
}

// ============================================================================
// LOGO GESTAPP
// ============================================================================
function GestAppLogo({ className = "", light = false }) {
    return (
        <div className={`flex items-center gap-2.5 select-none ${className}`}>
            <span className="text-2xl font-bold text-[#1e4a38]">GestApp</span>
        </div>
    );
}

// ============================================================================
// ILUSTRAÇÃO VETORIAL DO MONITOR COM DADOS, COFRINHO E PLANTA DE MOEDAS
// ============================================================================
function HeroMonitorIllustration() {
    return (
        <div className="relative w-full max-w-[540px] mx-auto select-none">
            <svg
                viewBox="0 0 540 430"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-auto drop-shadow-2xl"
            >
                <defs>
                    <linearGradient id="monitorBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#72cc85" />
                        <stop offset="100%" stopColor="#48bb78" />
                    </linearGradient>
                    <linearGradient id="monitorStandGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#317855" />
                        <stop offset="100%" stopColor="#255c41" />
                    </linearGradient>
                    <linearGradient id="monitorBaseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#38a169" />
                        <stop offset="50%" stopColor="#48bb78" />
                        <stop offset="100%" stopColor="#2f855a" />
                    </linearGradient>
                    <linearGradient id="piggyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#58c485" />
                        <stop offset="100%" stopColor="#38a169" />
                    </linearGradient>
                </defs>

                {/* Sombra suave no chão */}
                <ellipse cx="270" cy="415" rx="200" ry="14" fill="#1e4a38" opacity="0.12" />

                {/* Base do Monitor */}
                <rect x="200" y="380" width="140" height="20" rx="4" fill="url(#monitorBaseGrad)" />
                <rect x="210" y="394" width="120" height="6" rx="2" fill="#22543d" opacity="0.4" />

                {/* Haste / Suporte */}
                <path d="M246 320L236 380H304L294 320H246Z" fill="url(#monitorStandGrad)" />
                <path d="M270 320L266 380H304L294 320H270Z" fill="#1b4332" opacity="0.3" />

                {/* Chassis do Monitor */}
                <rect
                    x="30"
                    y="20"
                    width="480"
                    height="305"
                    rx="22"
                    fill="url(#monitorBodyGrad)"
                    stroke="#38a169"
                    strokeWidth="4"
                />

                {/* Barra inferior */}
                <rect x="34" y="290" width="472" height="32" rx="0" fill="#3ea66a" />
                <line x1="80" y1="305" x2="160" y2="305" stroke="#2b6b47" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="110" y1="312" x2="180" y2="312" stroke="#2b6b47" strokeWidth="2" strokeLinecap="round" />
                <circle cx="270" cy="305" r="7" fill="#276749" />
                <circle cx="270" cy="305" r="4" fill="#1b4332" />

                {/* TELA BRANCA INTERNA */}
                <rect x="52" y="42" width="436" height="248" rx="8" fill="#ffffff" />

                {/* Ícone de Banco */}
                <g transform="translate(70, 60)">
                    <path d="M4 14L22 4L40 14H4Z" fill="#38a169" />
                    <rect x="2" y="14" width="40" height="3" rx="1" fill="#38a169" />
                    <rect x="6" y="18" width="5" height="15" rx="1" fill="#38a169" />
                    <rect x="15" y="18" width="5" height="15" rx="1" fill="#38a169" />
                    <rect x="24" y="18" width="5" height="15" rx="1" fill="#38a169" />
                    <rect x="33" y="18" width="5" height="15" rx="1" fill="#38a169" />
                    <rect x="2" y="34" width="40" height="4" rx="1" fill="#38a169" />
                </g>

                {/* Indicadores do cabeçalho */}
                <rect x="125" y="76" width="18" height="8" rx="3" fill="#88d89e" />
                <rect x="150" y="76" width="18" height="8" rx="3" fill="#88d89e" />
                <rect x="175" y="76" width="18" height="8" rx="3" fill="#88d89e" />
                <rect x="380" y="75" width="22" height="10" rx="3" fill="#88d89e" />
                <rect x="410" y="75" width="22" height="10" rx="3" fill="#88d89e" />
                <line x1="70" y1="108" x2="470" y2="108" stroke="#e8f5e9" strokeWidth="1.5" />

                {/* PAINEL ESQUERDO */}
                <g transform="translate(70, 120)">
                    <rect x="0" y="0" width="180" height="15" rx="4" fill="#a3e2b3" />
                    <rect x="0" y="28" width="150" height="8" rx="3" fill="#88d89e" />
                    <rect x="0" y="44" width="175" height="4" rx="2" fill="#c3ebd0" />
                    <rect x="0" y="54" width="130" height="4" rx="2" fill="#c3ebd0" />
                    <rect x="0" y="64" width="160" height="4" rx="2" fill="#c3ebd0" />
                    <rect x="0" y="86" width="180" height="8" rx="3" fill="#e8f5e9" />
                    <rect x="0" y="86" width="110" height="8" rx="3" fill="#48bb78" />
                    <rect x="0" y="106" width="90" height="12" rx="3" fill="#a3e2b3" />
                </g>

                {/* PAINEL DIREITO: COFRINHO + PLANTA */}
                <g transform="translate(290, 110)">
                    {/* Cofrinho */}
                    <g transform="translate(0, 38)">
                        <ellipse cx="45" cy="40" rx="42" ry="32" fill="url(#piggyGrad)" />
                        <ellipse cx="1" cy="40" rx="7" ry="12" fill="#38a169" />
                        <circle cx="1" cy="37" r="1.8" fill="#276749" />
                        <circle cx="1" cy="43" r="1.8" fill="#276749" />
                        <path d="M22 18L32 6L36 22Z" fill="#38a169" />
                        <path d="M25 18L32 10L35 21Z" fill="#58c485" />
                        <circle cx="20" cy="30" r="3.5" fill="#1b4332" />
                        <circle cx="21" cy="29" r="1.2" fill="#ffffff" />
                        <rect x="18" y="66" width="10" height="14" rx="4" fill="#2f855a" />
                        <rect x="56" y="66" width="10" height="14" rx="4" fill="#2f855a" />
                        <path d="M86 35C90 32 94 36 91 40C88 43 92 46 95 44" stroke="#38a169" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                        <rect x="36" y="10" width="18" height="4" rx="2" fill="#1e4a38" />
                        <path d="M30 68C45 74 65 72 75 64" stroke="#22543d" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
                    </g>

                    {/* Planta com moeda */}
                    <g transform="translate(100, 10)">
                        <path d="M10 110L14 140H48L52 110H10Z" fill="#a3e2b3" stroke="#48bb78" strokeWidth="2" />
                        <rect x="8" y="105" width="46" height="8" rx="3" fill="#88d89e" />
                        <path d="M31 106V40" stroke="#2f855a" strokeWidth="4" strokeLinecap="round" />
                        <path d="M31 82C15 80 10 65 24 58C30 68 31 76 31 82Z" fill="#48bb78" />
                        <path d="M31 66C47 64 52 49 38 42C32 52 31 60 31 66Z" fill="#58c485" />
                        <g transform="translate(31, 30)">
                            <circle cx="0" cy="0" r="19" fill="#38a169" stroke="#276749" strokeWidth="2.5" />
                            <circle cx="0" cy="0" r="14.5" fill="#48bb78" />
                            <text x="0" y="6" textAnchor="middle" fontSize="16" fontWeight="bold" fill="#ffffff" fontFamily="sans-serif">
                                $
                            </text>
                        </g>
                    </g>
                </g>
            </svg>
        </div>
    );
}

// ============================================================================
// SEÇÃO PROVA SOCIAL COM ANIMAÇÃO DE EXPANSÃO / ESTICAMENTO AO ROLAR
// ============================================================================
function ExpandingSocialProofSection() {
    const sectionRef = useRef(null);
    const [scrollProgress, setScrollProgress] = useState(0);

    useEffect(() => {
        let animationFrameId;

        const handleScroll = () => {
            if (!sectionRef.current) return;
            const rect = sectionRef.current.getBoundingClientRect();
            const windowHeight = window.innerHeight;

            // Inicia quando o topo da seção entra no campo de visão (95%)
            // Completa quando atinge ~20% do topo da janela
            const start = windowHeight * 0.95;
            const end = windowHeight * 0.2;

            const progress = (start - rect.top) / (start - end);
            const clamped = Math.max(0, Math.min(1, progress));

            setScrollProgress(clamped);
        };

        const onScroll = () => {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = requestAnimationFrame(handleScroll);
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        handleScroll();

        return () => {
            window.removeEventListener("scroll", onScroll);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    // Interpolação da largura e escala conforme a rolagem do mouse
    const cardWidth = 78 + scrollProgress * 20; // 78% até 98%
    const cardRadius = 52 - scrollProgress * 28; // 52px até 24px
    const cardScale = 0.92 + scrollProgress * 0.08; // 0.92 até 1.0

    return (
        <section ref={sectionRef} className="py-16 md:py-24 bg-white overflow-hidden flex justify-center items-center">
            <div
                style={{
                    width: `${cardWidth}%`,
                    maxWidth: "1420px",
                    borderRadius: `${cardRadius}px`,
                    transform: `scale(${cardScale})`,
                    transition: "width 0.12s ease-out, transform 0.12s ease-out, border-radius 0.12s ease-out"
                }}
                className="bg-[#1e4a38] text-white p-8 sm:p-14 md:p-16 space-y-10 shadow-[0_25px_60px_-15px_rgba(30,74,56,0.3)] overflow-hidden will-change-transform will-change-[width]"
            >
                {/* Cabeçalho Superior: Título + Botão/Ação */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="max-w-2xl space-y-3">
                        <h2 className="text-3xl sm:text-5xl font-normal tracking-tight leading-[1.15] text-white">
                            Desenvolvido e validado junto com a Móveis Pedro II.
                        </h2>
                        <p className="text-emerald-100/70 text-sm sm:text-base font-normal max-w-xl leading-relaxed">
                            O <b className="text-white">GestApp</b> foi construído no chão de loja de uma das maiores referências do setor, na região serrana do Rio de Janeiro. Unimos tecnologia a mais de 25 anos de pioneirismo e experiência real em vendas, estoque e logística.
                        </p>
                    </div>
                </div>

                {/* Card Interno Grande (Mídia / Imagem de Destaque) */}
                <div className="relative w-full rounded-3xl bg-[#FFFFFF] border border-white/10 overflow-hidden flex items-center justify-center min-h-[320px] sm:min-h-[420px] p-8">
                    {/* Imagem da Logo com fundo verde escuro nativo */}
                    <img
                        src="https://webra.com.br/wp-content/uploads/2022/09/Webra_Site_MoveisPedroII_01.jpg"
                        alt="Móveis Pedro II"
                        className="max-h-48 sm:max-h-64 w-auto object-contain opacity-90 transition-opacity hover:opacity-100 duration-300"
                    />
                </div>

                {/* Rodapé de Métricas Minimalistas */}
                <div className="pt-6 border-t border-white/10 grid grid-cols-2 md:grid-cols-4 gap-6 text-left">
                    <div>
                        <p className="text-xs text-emerald-200/60 font-medium">Validação de Mercado</p>
                        <p className="text-2xl sm:text-3xl font-light text-white mt-1">100% Prático</p>
                    </div>
                    <div>
                        <p className="text-xs text-emerald-200/60 font-medium">Expertise Comercial</p>
                        <p className="text-2xl sm:text-3xl font-light text-white mt-1">+25 Anos</p>
                    </div>
                    <div>
                        <p className="text-xs text-emerald-200/60 font-medium">Arquitetura de Dados</p>
                        <p className="text-2xl sm:text-3xl font-light text-white mt-1">Multi-Filial</p>
                    </div>
                    <div>
                        <p className="text-xs text-emerald-200/60 font-medium">Disponibilidade</p>
                        <p className="text-2xl sm:text-3xl font-light text-white mt-1">Nuvem 24/7</p>
                    </div>
                </div>
            </div>
        </section>
    );
}

// ============================================================================
// PÁGINA PRINCIPAL (LANDING PAGE - ESTILO APPLE COM HEADER TRANSLÚCIDO E BOTÕES FLAT)
// ============================================================================
const HERO_SUBTITLES = [
    "Do orçamento até a entrega. Tudo integrado.",
    "Acompanhe tudo pelo portal do cliente e ofereça uma experiência premium.",
    "Menos tempo com planilhas, mais agilidade para expandir e lucrar."
];

export default function LandingPage() {
    const navigate = useNavigate();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [openFaq, setOpenFaq] = useState(null);
    const [isScrolled, setIsScrolled] = useState(false);
    const [subtitleIndex, setSubtitleIndex] = useState(0);
    const [fadeSubtitle, setFadeSubtitle] = useState("in");

    // Alternância suave das frases da Hero
    useEffect(() => {
        const interval = setInterval(() => {
            setFadeSubtitle("out");
            setTimeout(() => {
                setSubtitleIndex((prev) => (prev + 1) % HERO_SUBTITLES.length);
                setFadeSubtitle("in");
            }, 350);
        }, 3800);

        return () => clearInterval(interval);
    }, []);

    // Detecta o scroll da página
    useEffect(() => {
        const handleScroll = () => {
            if (window.scrollY > 100) {
                setIsScrolled(true);
            } else {
                setIsScrolled(false);
            }
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    // Carregamento dinâmico dos planos do Supabase
    const [planos, setPlanos] = useState([]);
    const [loadingPlanos, setLoadingPlanos] = useState(true);

    useEffect(() => {
        async function loadPlanos() {
            try {
                setLoadingPlanos(true);
                const { data, error } = await supabase
                    .from("planos")
                    .select("*")
                    .eq("ativo", true)
                    .order("preco_mensal", { ascending: true });

                if (error) throw error;
                setPlanos(data || []);
            } catch (err) {
                console.error("Erro ao carregar planos:", err);
                setPlanos([]);
            } finally {
                setLoadingPlanos(false);
            }
        }
        loadPlanos();
    }, []);

    const scrollToSection = (id) => {
        setMobileMenuOpen(false);
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: "smooth" });
        }
    };

    const formatCurrency = (val) =>
        new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

    return (
        <div className="min-h-screen bg-white text-slate-800 font-sans selection:bg-emerald-200 selection:text-[#1e4a38]">
            {/* ================================================================ */}
            {/* CABEÇALHO / HEADER (TRANSPARÊNCIA TRANSLÚCIDA ESTILO APPLE) */}
            {/* ================================================================ */}
            {/* CABEÇALHO / HEADER FLUTUANTE ADAPTÁVEL */}
            <header
                className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${isScrolled
                    ? "bg-transparent py-3 pointer-events-none"
                    : "bg-[#e7f6ec]/85 backdrop-blur-md border-b border-[#d0edd8]/60 py-0"
                    }`}
            >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="relative flex items-center justify-between h-16 sm:h-20">

                        {/* Logo GestApp */}
                        <Link
                            to="/"
                            className={`flex items-center transition-all duration-300 pointer-events-auto ${isScrolled ? "opacity-0 -translate-x-4 pointer-events-none" : "opacity-100 translate-x-0"
                                }`}
                        >
                            <GestAppLogo />
                        </Link>

                        {/* Menu Desktop: Espaçado no topo e pílula compacta liquid glass ao rolar */}
                        <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-auto">
                            <nav
                                className={`flex items-center transition-all duration-300 text-[#1e4a38] ${isScrolled
                                    ? "gap-1.5 p-1.5 rounded-full border border-white/60 bg-white/40 backdrop-blur-2xl backdrop-saturate-200 shadow-[0_12px_32px_-4px_rgba(30,74,56,0.12),inset_0_1px_1px_0_rgba(255,255,255,0.9)]"
                                    : "gap-8 lg:gap-10 p-0 bg-transparent border-transparent shadow-none"
                                    }`}
                            >
                                <button
                                    onClick={() => scrollToSection("pilares")}
                                    className={`transition-all duration-300 cursor-pointer ${isScrolled
                                        ? "px-4 py-2 rounded-full text-xs font-semibold hover:bg-white/60"
                                        : "px-1 py-1 text-sm font-medium hover:text-[#38a169]"
                                        }`}
                                >
                                    Funcionalidades
                                </button>
                                <button
                                    onClick={() => scrollToSection("portal-cliente")}
                                    className={`transition-all duration-300 cursor-pointer ${isScrolled
                                        ? "px-4 py-2 rounded-full text-xs font-semibold hover:bg-white/60"
                                        : "px-1 py-1 text-sm font-medium hover:text-[#38a169]"
                                        }`}
                                >
                                    Portal do Cliente
                                </button>
                                <button
                                    onClick={() => scrollToSection("planos")}
                                    className={`transition-all duration-300 cursor-pointer ${isScrolled
                                        ? "px-4 py-2 rounded-full text-xs font-semibold hover:bg-white/60"
                                        : "px-1 py-1 text-sm font-medium hover:text-[#38a169]"
                                        }`}
                                >
                                    Planos
                                </button>
                                <button
                                    onClick={() => scrollToSection("faq")}
                                    className={`transition-all duration-300 cursor-pointer ${isScrolled
                                        ? "px-4 py-2 rounded-full text-xs font-semibold hover:bg-white/60"
                                        : "px-1 py-1 text-sm font-medium hover:text-[#38a169]"
                                        }`}
                                >
                                    Dúvidas
                                </button>
                            </nav>
                        </div>

                        {/* Botões de Ação */}
                        <div
                            className={`hidden md:flex items-center gap-4 transition-all duration-300 pointer-events-auto ${isScrolled ? "opacity-0 translate-x-4 pointer-events-none" : "opacity-100 translate-x-0"
                                }`}
                        >
                            <Link to="/login">
                                <button className="text-[#1e4a38] hover:text-[#38a169] font-medium text-xs transition-colors cursor-pointer flex items-center gap-1.5">
                                    <LogIn className="w-3.5 h-3.5" />
                                    Entrar
                                </button>
                            </Link>

                            <Link to="/cadastro">
                                <button className="px-5 py-2 bg-[#48bb78] hover:bg-[#38a169] text-white font-medium text-xs rounded-full transition-colors cursor-pointer shadow-sm">
                                    Comece Agora
                                </button>
                            </Link>
                        </div>

                        {/* Menu Mobile Button */}
                        <div className={`md:hidden flex items-center gap-2 pointer-events-auto ${isScrolled ? "bg-white/40 backdrop-blur-2xl backdrop-saturate-200 p-1.5 rounded-full border border-white/60 shadow-[0_8px_24px_-4px_rgba(30,74,56,0.12),inset_0_1px_1px_0_rgba(255,255,255,0.9)]" : ""}`}>
                            <Link to="/login">
                                <button className="px-3 py-1.5 text-xs font-medium text-[#1e4a38]">
                                    Entrar
                                </button>
                            </Link>
                            <button
                                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                                className="p-2 text-[#1e4a38] focus:outline-none"
                                aria-label="Abrir Menu"
                            >
                                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>
                </div>
            </header>            {/* ================================================================ */}
            {/* SEÇÃO HERO COM FUNDO PASTEL MINT LIMPO (SEM DEGRADÊ, SEM 3D) */}
            {/* ================================================================ */}
            {/* SEÇÃO HERO COM FUNDO PASTEL MINT LIMPO */}

            <section className="relative bg-[#e7f6ec] pt-28 pb-20 sm:pt-32 sm:pb-32 overflow-hidden">                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
                    {/* Lado Esquerdo: Tipografia & Botão Comece Agora */}
                    <div className="lg:col-span-6 space-y-7 text-left">
                        <Reveal delay={100} direction="up">
                            <h1
                                className="text-3xl sm:text-4xl lg:text-[2.75rem] font-medium tracking-tight text-[#1e4a38] leading-[1.18] max-w-xl"
                                style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
                            >
                                Controle sua empresa inteira em uma única plataforma.
                            </h1>
                        </Reveal>

                        <Reveal delay={250} direction="up">
                            <div className="min-h-[56px] sm:min-h-[64px] flex items-center">
                                <p
                                    className={`text-base sm:text-lg text-[#2d5c48] font-normal leading-relaxed max-w-lg transition-all duration-350 ease-out transform ${fadeSubtitle === "in"
                                        ? "opacity-100 translate-y-0"
                                        : "opacity-0 -translate-y-2"
                                        }`}
                                >
                                    {HERO_SUBTITLES[subtitleIndex]}
                                </p>
                            </div>
                        </Reveal>

                        <Reveal delay={400} direction="up">
                            <div className="pt-2">
                                <Link to="/cadastro">
                                    <button className="px-8 py-3.5 bg-[#48bb78] hover:bg-[#38a169] text-white text-base font-medium rounded-full transition-colors cursor-pointer">
                                        Comece Agora
                                    </button>
                                </Link>
                            </div>
                        </Reveal>

                        <Reveal delay={550} direction="up">
                            <div className="pt-4 flex flex-wrap gap-5 text-xs text-[#2d5c48] font-medium">
                                <span className="flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4 text-[#38a169]" />
                                    100% em nuvem e seguro
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4 text-[#38a169]" />
                                    Multi-filiais e frotas
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <ShieldCheck className="w-4 h-4 text-[#38a169]" />
                                    Backup diário garantido
                                </span>
                            </div>
                        </Reveal>
                    </div>

                    {/* Lado Direito: Imagem do Mockup do GestApp */}
                    <div className="lg:col-span-6 flex justify-center lg:justify-end">
                        <Reveal delay={200} direction="scale">
                            <img src={gestappMockup} alt="Mockup do GestApp" className="w-full max-w-[600px] h-auto drop-shadow-2xl object-contain" />
                        </Reveal>
                    </div>
                </div>
            </div>

                {/* DIVISOR DE ONDA / CURVA SUAVE PARA O FUNDO BRANCO */}
                <div className="absolute bottom-0 left-0 right-0 w-full overflow-hidden leading-none pointer-events-none">
                    <svg
                        viewBox="0 0 1440 100"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-full h-16 sm:h-20 text-white preserve-3d"
                        preserveAspectRatio="none"
                    >
                        <path
                            d="M0,0 C360,75 1080,75 1440,0 L1440,100 L0,100 Z"
                            fill="#ffffff"
                        />
                    </svg>
                </div>
            </section>

            {/* BOTÃO CIRCULAR LIMPO COM SETA ↓ */}
            <div className="relative -mt-106 sm:-mt-108 flex justify-center z-20">
                <button
                    onClick={() => scrollToSection("pilares")}
                    className="w-11 h-11 rounded-full border border-[#48bb78] bg-white text-[#38a169] flex items-center justify-center hover:bg-[#e7f6ec] transition-colors cursor-pointer"
                    aria-label="Rolar para funcionalidades"
                    title="Conheça os recursos"
                >
                    <ArrowDown className="w-4 h-4" />
                </button>
            </div>

            {/* ================================================================ */}
            {/* SEÇÃO DOS 4 PILARES DA OPERAÇÃO (DESIGN NOVO COM MINI-MOCKUPS) */}
            {/* ================================================================ */}
            <section id="pilares" className="py-20 md:py-28 bg-[#fbfdfb] relative overflow-hidden">
                {/* Linhas Curvas Decorativas no Fundo */}
                <div className="absolute top-10 left-1/2 -translate-x-1/2 w-full max-w-5xl h-32 pointer-events-none opacity-20 hidden md:block">
                    <svg viewBox="0 0 1000 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                        <path d="M 100 100 Q 500 -40 900 100" stroke="#16a34a" strokeWidth="2" strokeDasharray="6 6" />
                    </svg>
                </div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <Reveal delay={100} direction="up">
                        <div className="max-w-3xl mx-auto text-center mb-16 space-y-3">
                            <h2 className="text-3xl sm:text-5xl font-normal text-[#1e4a38] tracking-tight leading-[1.15]">
                                Os 4 pilares do GestApp <br className="hidden sm:inline" />
                                <span className="text-[#38a169] block sm:inline mt-1 sm:mt-0">na sua empresa</span>
                            </h2>
                            <p className="text-slate-500 text-sm sm:text-base font-normal max-w-xl mx-auto pt-1">
                                Tudo o que sua equipe precisa para operar com clareza, velocidade e lucratividade.
                            </p>
                        </div>
                    </Reveal>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
                        {/* ================= CARD 01: VENDAS & PDV ================= */}
                        <Reveal delay={150} direction="up" className="h-full">
                            <div className="bg-white rounded-[24px] border border-slate-200/80 p-6 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between h-full group">
                                <div>
                                    {/* Topo do Card */}
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="w-11 h-11 rounded-full bg-[#e7f6ec] text-[#189851] flex items-center justify-center">
                                            <ShoppingBag className="w-5 h-5 stroke-[2.2]" />
                                        </div>
                                        <span className="w-8 h-8 rounded-full border border-emerald-200/80 bg-emerald-50/50 text-[#189851] font-semibold text-xs flex items-center justify-center">
                                            01
                                        </span>
                                    </div>

                                    {/* Título & Descrição */}
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">Vendas & PDV</h3>
                                    <p className="text-slate-500 text-xs leading-relaxed mb-5">
                                        Emissão rápida de orçamentos, frente de caixa simplificada, consulta imediata de saldo e múltiplas formas de pagamento.
                                    </p>

                                    {/* Checklist */}
                                    <ul className="space-y-2.5 mb-6 text-xs font-medium text-slate-700">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Orçamentos em segundos</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>PDV completo e simplificado</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Múltiplas formas de pagamento</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Integração com boleto e PIX</span>
                                        </li>
                                    </ul>
                                </div>

                                {/* Widget Mockup Inferior */}
                                <div className="bg-[#f8faf8] rounded-2xl p-4 border border-slate-100 text-[11px] space-y-2.5 mt-auto">
                                    <div className="font-bold text-slate-800 text-[11px]">Novo pedido</div>

                                    <div className="bg-white rounded-lg p-2 border border-slate-200/60 shadow-2xs">
                                        <div className="text-[9px] text-slate-400 font-medium">Cliente</div>
                                        <div className="flex justify-between items-center text-slate-700 font-medium text-[10px]">
                                            <span>João da Silva</span>
                                            <ChevronDown className="w-3 h-3 text-slate-400" />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5 pt-1">
                                        <div className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">Produtos</div>
                                        <div className="flex justify-between text-[10px] text-slate-700 bg-white p-1.5 rounded border border-slate-100">
                                            <span className="truncate pr-1">Sofá Retrátil 3 Lugares</span>
                                            <span className="text-slate-400 shrink-0 mr-1">qnt 1</span>
                                            <span className="font-semibold shrink-0">R$ 2.699,00</span>
                                        </div>
                                        <div className="flex justify-between text-[10px] text-slate-700 bg-white p-1.5 rounded border border-slate-100">
                                            <span className="truncate pr-1">Mesa de Centro</span>
                                            <span className="text-slate-400 shrink-0 mr-1">qnt 1</span>
                                            <span className="font-semibold shrink-0">R$ 299,00</span>
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-slate-200/60 space-y-1 text-[10px]">
                                        <div className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">Resumo do pedido</div>
                                        <div className="flex justify-between text-slate-500">
                                            <span>Subtotal</span>
                                            <span>R$ 2.998,00</span>
                                        </div>
                                        <div className="flex justify-between text-slate-500">
                                            <span>Desconto</span>
                                            <span>R$ 100,00</span>
                                        </div>
                                        <div className="flex justify-between font-bold text-slate-800 pt-1 text-[11px]">
                                            <span>Total</span>
                                            <span className="text-[#189851]">R$ 2.898,00</span>
                                        </div>
                                    </div>

                                    {/* Botões de pagamento */}
                                    <div className="grid grid-cols-4 gap-1 pt-1">
                                        <div className="bg-white border border-slate-200 rounded py-1 text-center text-[9px] text-slate-600 font-medium">Dinheiro</div>
                                        <div className="bg-white border border-slate-200 rounded py-1 text-center text-[9px] text-slate-600 font-medium">Cartão</div>
                                        <div className="bg-[#189851] text-white rounded py-1 text-center text-[9px] font-bold shadow-2xs">PIX</div>
                                        <div className="bg-white border border-slate-200 rounded py-1 text-center text-[9px] text-slate-600 font-medium">Boleto</div>
                                    </div>
                                </div>
                            </div>
                        </Reveal>

                        {/* ================= CARD 02: ESTOQUE MULTI-FILIAL ================= */}
                        <Reveal delay={250} direction="up" className="h-full">
                            <div className="bg-white rounded-[24px] border border-slate-200/80 p-6 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between h-full group">
                                <div>
                                    {/* Topo do Card */}
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="w-11 h-11 rounded-full bg-[#e7f6ec] text-[#189851] flex items-center justify-center">
                                            <Boxes className="w-5 h-5 stroke-[2.2]" />
                                        </div>
                                        <span className="w-8 h-8 rounded-full border border-emerald-200/80 bg-emerald-50/50 text-[#189851] font-semibold text-xs flex items-center justify-center">
                                            02
                                        </span>
                                    </div>

                                    {/* Título & Descrição */}
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">Estoque Multi-Filial</h3>
                                    <p className="text-slate-500 text-xs leading-relaxed mb-5">
                                        Saldo unificado entre lojas e depósitos centrais, transferências com conferência de recebimento e travas anti-furto.
                                    </p>

                                    {/* Checklist */}
                                    <ul className="space-y-2.5 mb-6 text-xs font-medium text-slate-700">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Controle de estoque em tempo real</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Transferências entre filiais</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Conferência de recebimento</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Relatórios de giro e ruptura</span>
                                        </li>
                                    </ul>
                                </div>

                                {/* Widget Mockup Inferior */}
                                <div className="bg-[#f8faf8] rounded-2xl p-4 border border-slate-100 text-[11px] space-y-3 mt-auto">
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold text-slate-800 text-[11px]">Resumo do estoque</span>
                                        <span className="text-[9px] text-slate-400 border border-slate-200 bg-white px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                            Todas as filiais <ChevronDown className="w-2.5 h-2.5" />
                                        </span>
                                    </div>

                                    {/* Grid de Métricas */}
                                    <div className="grid grid-cols-3 gap-1.5">
                                        <div className="bg-white rounded-lg p-2 border border-slate-100 text-center shadow-2xs">
                                            <div className="text-emerald-600 font-extrabold text-sm">1.248</div>
                                            <div className="text-[8px] text-slate-400 leading-tight mt-0.5">Produtos em estoque</div>
                                        </div>
                                        <div className="bg-white rounded-lg p-2 border border-slate-100 text-center shadow-2xs">
                                            <div className="text-amber-500 font-extrabold text-sm">210</div>
                                            <div className="text-[8px] text-slate-400 leading-tight mt-0.5">Estoque baixo</div>
                                        </div>
                                        <div className="bg-white rounded-lg p-2 border border-slate-100 text-center shadow-2xs">
                                            <div className="text-rose-500 font-extrabold text-sm">68</div>
                                            <div className="text-[8px] text-slate-400 leading-tight mt-0.5">Estoque crítico</div>
                                        </div>
                                    </div>

                                    {/* Transferências Recentes */}
                                    <div className="pt-2 border-t border-slate-200/60 space-y-2">
                                        <div className="flex justify-between items-center text-[10px]">
                                            <span className="font-bold text-slate-700">Transferências recentes</span>
                                            <span className="text-[9px] text-[#189851] font-semibold">Ver todas</span>
                                        </div>

                                        <div className="space-y-1.5 text-[9px]">
                                            <div className="bg-white p-2 rounded border border-slate-100 flex items-center justify-between">
                                                <div>
                                                    <div className="font-medium text-slate-700">Filial Centro → Depósito Central</div>
                                                    <div className="text-[8px] text-slate-400">15/05/2025</div>
                                                </div>
                                                <span className="bg-emerald-50 text-emerald-600 border border-emerald-200/60 px-1.5 py-0.5 rounded font-semibold text-[8px]">Concluída</span>
                                            </div>

                                            <div className="bg-white p-2 rounded border border-slate-100 flex items-center justify-between">
                                                <div>
                                                    <div className="font-medium text-slate-700">Depósito Central → Filial Norte</div>
                                                    <div className="text-[8px] text-slate-400">14/05/2025</div>
                                                </div>
                                                <span className="bg-emerald-50 text-emerald-600 border border-emerald-200/60 px-1.5 py-0.5 rounded font-semibold text-[8px]">Concluída</span>
                                            </div>

                                            <div className="bg-white p-2 rounded border border-slate-100 flex items-center justify-between">
                                                <div>
                                                    <div className="font-medium text-slate-700">Filial Sul → Filial Centro</div>
                                                    <div className="text-[8px] text-slate-400">13/05/2025</div>
                                                </div>
                                                <span className="bg-amber-50 text-amber-600 border border-amber-200/60 px-1.5 py-0.5 rounded font-semibold text-[8px]">Em trânsito</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Reveal>

                        {/* ================= CARD 03: LOGÍSTICA & ROTAS ================= */}
                        <Reveal delay={350} direction="up" className="h-full">
                            <div className="bg-white rounded-[24px] border border-slate-200/80 p-6 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between h-full group">
                                <div>
                                    {/* Topo do Card */}
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="w-11 h-11 rounded-full bg-[#e7f6ec] text-[#189851] flex items-center justify-center">
                                            <Truck className="w-5 h-5 stroke-[2.2]" />
                                        </div>
                                        <span className="w-8 h-8 rounded-full border border-emerald-200/80 bg-emerald-50/50 text-[#189851] font-semibold text-xs flex items-center justify-center">
                                            03
                                        </span>
                                    </div>

                                    {/* Título & Descrição */}
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">Logística & Rotas</h3>
                                    <p className="text-slate-500 text-xs leading-relaxed mb-5">
                                        Roteirização inteligente de caminhões, link de rastreamento com mapa em tempo real para o cliente e ordens para montadores.
                                    </p>

                                    {/* Checklist */}
                                    <ul className="space-y-2.5 mb-6 text-xs font-medium text-slate-700">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Otimização de rotas</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Rastreamento em tempo real</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Ordens de entrega e montagem</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Comunicação com motoristas</span>
                                        </li>
                                    </ul>
                                </div>

                                {/* Widget Mockup Inferior */}
                                <div className="bg-[#f8faf8] rounded-2xl p-4 border border-slate-100 text-[11px] space-y-3 mt-auto">
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold text-slate-800 text-[11px]">Entregas de hoje</span>
                                        <span className="text-[9px] text-[#189851] font-semibold cursor-pointer">Ver mapa</span>
                                    </div>

                                    {/* Item 1 de entrega com Mini Mapa */}
                                    <div className="bg-white p-2.5 rounded-xl border border-slate-100 space-y-2 shadow-2xs">
                                        <div className="flex justify-between items-center text-[9px]">
                                            <span className="text-slate-400 font-medium">08:00 - 12:00</span>
                                            <span className="bg-emerald-50 text-emerald-600 border border-emerald-200/60 px-1.5 py-0.5 rounded font-semibold text-[8px]">Em andamento</span>
                                        </div>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="space-y-0.5 text-[9px]">
                                                <div className="font-bold text-slate-800">João da Silva</div>
                                                <div className="text-slate-500 text-[8px]">Rua das Flores, 123 - Centro</div>
                                                <div className="text-slate-400 text-[8px]">Pedido: #5281</div>
                                            </div>
                                            {/* Representação visual do mapa */}
                                            <div className="w-14 h-12 rounded bg-emerald-50 border border-emerald-100 relative overflow-hidden shrink-0 flex items-center justify-center">
                                                <div className="absolute inset-0 opacity-40 bg-[radial-gradient(#189851_1px,transparent_1px)] [background-size:6px_6px]" />
                                                <div className="w-full h-0.5 bg-emerald-400 rotate-12 relative z-10" />
                                                <div className="w-4 h-4 rounded-full bg-[#189851] text-white flex items-center justify-center relative z-20 shadow-xs">
                                                    <Truck className="w-2.5 h-2.5" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Item 2 de entrega */}
                                    <div className="bg-white p-2.5 rounded-xl border border-slate-100 space-y-2 shadow-2xs">
                                        <div className="flex justify-between items-center text-[9px]">
                                            <span className="text-slate-400 font-medium">14:00 - 18:00</span>
                                            <span className="bg-amber-50 text-amber-600 border border-amber-200/60 px-1.5 py-0.5 rounded font-semibold text-[8px]">Pendente</span>
                                        </div>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="space-y-0.5 text-[9px]">
                                                <div className="font-bold text-slate-800">Maria Aparecida</div>
                                                <div className="text-slate-500 text-[8px]">Av. Brasil, 456 - B. São Geraldo</div>
                                                <div className="text-slate-400 text-[8px]">Pedido: #5278</div>
                                            </div>
                                            {/* Map visual */}
                                            <div className="w-14 h-12 rounded bg-slate-50 border border-slate-200 relative overflow-hidden shrink-0 flex items-center justify-center">
                                                <div className="w-full h-0.5 bg-amber-300 -rotate-12 relative z-10" />
                                                <div className="w-2 h-2 rounded-full bg-amber-500 relative z-20" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Reveal>

                        {/* ================= CARD 04: PÓS-VENDA & SUPORTE ================= */}
                        <Reveal delay={450} direction="up" className="h-full">
                            <div className="bg-white rounded-[24px] border border-slate-200/80 p-6 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between h-full group">
                                <div>
                                    {/* Topo do Card */}
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="w-11 h-11 rounded-full bg-[#e7f6ec] text-[#189851] flex items-center justify-center">
                                            <Headphones className="w-5 h-5 stroke-[2.2]" />
                                        </div>
                                        <span className="w-8 h-8 rounded-full border border-emerald-200/80 bg-emerald-50/50 text-[#189851] font-semibold text-xs flex items-center justify-center">
                                            04
                                        </span>
                                    </div>

                                    {/* Título & Descrição */}
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">Pós-Venda & Suporte para seu cliente</h3>
                                    <p className="text-slate-500 text-xs leading-relaxed mb-5">
                                        Autoatendimento para solicitações de garantia via QR Code impresso diretamente na nota do pedido, reduzindo chamados repetitivos.
                                    </p>

                                    {/* Checklist */}
                                    <ul className="space-y-2.5 mb-6 text-xs font-medium text-slate-700">
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Portal do cliente 24h</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Abertura de garantia via QR Code</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Acompanhamento do pedido</span>
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-[#189851] shrink-0" />
                                            <span>Menos chamados, mais satisfação</span>
                                        </li>
                                    </ul>
                                </div>

                                {/* Widget Mockup Inferior */}
                                <div className="bg-[#f8faf8] rounded-2xl p-4 border border-slate-100 text-[11px] space-y-2.5 mt-auto">
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold text-slate-800 text-[11px]">Portal do Cliente</span>
                                        <span className="text-[9px] text-[#189851] font-semibold cursor-pointer">Ver portal</span>
                                    </div>

                                    {/* Opções do Portal */}
                                    <div className="space-y-1.5 text-[9px]">
                                        <div className="bg-white p-2 rounded-lg border border-slate-100 flex items-center justify-between hover:border-emerald-200 transition-colors cursor-pointer">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded bg-emerald-50 text-[#189851] flex items-center justify-center shrink-0">
                                                    <Truck className="w-3 h-3" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-700">Acompanhar pedido</div>
                                                    <div className="text-[8px] text-slate-400">Veja o status do seu pedido em tempo real</div>
                                                </div>
                                            </div>
                                            <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                                        </div>

                                        <div className="bg-white p-2 rounded-lg border border-slate-100 flex items-center justify-between hover:border-emerald-200 transition-colors cursor-pointer">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded bg-emerald-50 text-[#189851] flex items-center justify-center shrink-0">
                                                    <ShieldCheck className="w-3 h-3" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-700">Garantias e solicitações</div>
                                                    <div className="text-[8px] text-slate-400">Abra ou acompanhe uma garantia</div>
                                                </div>
                                            </div>
                                            <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                                        </div>

                                        <div className="bg-white p-2 rounded-lg border border-slate-100 flex items-center justify-between hover:border-emerald-200 transition-colors cursor-pointer">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded bg-emerald-50 text-[#189851] flex items-center justify-center shrink-0">
                                                    <FileText className="w-3 h-3" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-700">Notas e documentos</div>
                                                    <div className="text-[8px] text-slate-400">Acesse notas fiscais e documentos</div>
                                                </div>
                                            </div>
                                            <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                                        </div>

                                        <div className="bg-white p-2 rounded-lg border border-slate-100 flex items-center justify-between hover:border-emerald-200 transition-colors cursor-pointer">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded bg-emerald-50 text-[#189851] flex items-center justify-center shrink-0">
                                                    <MessageCircle className="w-3 h-3" />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-700">Fale com a loja</div>
                                                    <div className="text-[8px] text-slate-400">Inicie uma conversa com nossa equipe</div>
                                                </div>
                                            </div>
                                            <ChevronRight className="w-3 h-3 text-slate-[#189851] shrink-0" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Reveal>
                    </div>
                </div>
            </section>

            {/* ================================================================ */}
            {/* SEÇÃO PORTAL DO CLIENTE EXCLUSIVO */}
            {/* ================================================================ */}
            {/* SEÇÃO PORTAL DO CLIENTE - MINIMALISTA FULL-WIDTH */}
            <section id="portal-cliente" className="py-20 md:py-28 bg-[#fbfdfb] border-y border-slate-100 overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

                    {/* Cabeçalho Limpo & Tipografia Elegante */}
                    <div className="max-w-3xl mx-auto text-center space-y-4 mb-16">

                        <Reveal delay={200} direction="up">
                            <h2 className="text-3xl sm:text-5xl font-normal text-[#1e4a38] tracking-tight leading-[1.15]">
                                Uma experiência de rastreio simples e transparente.
                            </h2>
                        </Reveal>

                        <Reveal delay={300} direction="up">
                            <p className="text-slate-600 text-base sm:text-lg font-light leading-relaxed max-w-2xl mx-auto">
                                Seu cliente acompanha a entrega em tempo real no GPS, consulta o histórico de compras e resgata pontos de fidelidade sem precisar instalar nada.
                            </p>
                        </Reveal>
                    </div>

                    {/* Mockup Centralizado Flutuante (Aproveita a tela e destaca o produto) */}
                    <Reveal delay={400} direction="up">
                        <div className="max-w-4xl mx-auto">
                            <div className="bg-white rounded-[2rem] border border-slate-200/80 shadow-[0_20px_50px_rgba(30,74,56,0.08)] overflow-hidden transition-all hover:shadow-[0_25px_60px_rgba(30,74,56,0.12)]">

                                {/* Barra do Navegador Sutil */}
                                <div className="px-6 py-4 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                                        <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                                        <div className="w-3 h-3 rounded-full bg-emerald-500/80" />                        </div>
                                    <div className="px-4 py-1 rounded-full bg-white border border-slate-200 text-[11px] text-slate-400 font-mono shadow-2xs">
                                        cliente.<b className="text-slate-800">suaempresa</b>.com.br                                    </div>
                                    <div className="w-12" />
                                </div>

                                {/* Interface do Portal Clean */}
                                <div className="p-8 sm:p-12 space-y-8 bg-white">

                                    {/* Topo do App */}
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                                        <div>
                                            <h3 className="text-lg font-medium text-slate-900">Acompanhamento do Pedido</h3>
                                            <p className="text-xs text-slate-500 mt-0.5">Olá, Carlos Silva • Pedido #8491</p>
                                        </div>
                                        Motorista a caminho
                                    </div>

                                    {/* Card do Status do Rastreio */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center p-6 rounded-2xl bg-slate-50/60 border border-slate-100">
                                        <div className="space-y-1">
                                            <p className="text-xs text-slate-400 font-medium">Previsão de Chegada</p>
                                            <p className="text-2xl font-light text-slate-800 font-mono">14:30h</p>
                                        </div>

                                        <div className="space-y-1">
                                            <p className="text-xs text-slate-400 font-medium">Item em Trânsito</p>
                                            <p className="text-sm font-medium text-slate-700">Sofá Retrátil 3 Lugares</p>
                                        </div>

                                        <div className="md:text-right">
                                            <button className="px-5 py-2.5 bg-[#1e4a38] hover:bg-[#2d5c48] text-white text-xs font-medium rounded-full transition-all shadow-xs cursor-pointer">
                                                Ver Mapa ao Vivo
                                            </button>
                                        </div>
                                    </div>

                                    {/* Indicadores Minimalistas em Linha */}
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 pt-4 text-left">
                                        <div className="space-y-1">
                                            <p className="text-xs text-slate-400 font-medium">✓ Histórico de Notas</p>
                                            <p className="text-sm text-slate-600 font-light">Disponível em 1 clique</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs text-slate-400 font-medium">★ Clube de Pontos</p>
                                            <p className="text-sm text-slate-600 font-light">2.450 Coroas acumuladas</p>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        </div>
                    </Reveal>

                    {/* Botão de Chamada Discreto */}
                    <Reveal delay={500} direction="up">
                        <div className="mt-12 text-center">
                            <Link to="/cadastro">
                                <button className="px-8 py-3.5 bg-[#48bb78] hover:bg-[#38a169] text-white text-xs font-semibold rounded-full transition-all cursor-pointer shadow-sm">
                                    Experimente o Portal no Cadastro
                                </button>
                            </Link>
                        </div>
                    </Reveal>

                </div>
            </section>
            {/* SEÇÃO PROVA SOCIAL COM ANIMAÇÃO DE EXPANSÃO / ESTICAMENTO DINÂMICO NO SCROLL */}
            <ExpandingSocialProofSection />
            {/* ================================================================ */}
            {/* SEÇÃO DE PLANOS ATIVOS (DESIGN CLEAN) */}
            {/* ================================================================ */}
            {/* SEÇÃO DE PLANOS ATIVOS - ESTILO MUBIX DESIGN */}
            <section id="planos" className="py-20 md:py-28 bg-[#f9fbf9]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

                    {/* Cabeçalho */}
                    <Reveal delay={100} direction="up">
                        <div className="max-w-2xl mx-auto text-center mb-16 space-y-3">
                            <h2 className="text-3xl sm:text-5xl font-bold text-[#1e4a38] tracking-tight">
                                Planos transparentes
                            </h2>
                            <p className="text-slate-500 text-sm sm:text-base font-normal">
                                Escolha a opção ideal para o tamanho da sua operação e comece sem burocracia.
                            </p>
                        </div>
                    </Reveal>

                    {loadingPlanos ? (
                        <div className="text-center py-16">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#48bb78] mx-auto mb-3" />
                            <p className="text-slate-500 text-sm">Carregando planos disponíveis...</p>
                        </div>
                    ) : (
                        <div className={`grid grid-cols-1 ${planos.length === 2 ? 'md:grid-cols-2 max-w-4xl' : 'md:grid-cols-3 max-w-6xl'} gap-8 mx-auto`}>
                            {([...(planos.length > 0 ? planos : [
                                { id: '1', nome: "Starter", preco_mensal: 199, descricao: "Ideal para pequenos comércios e lojas em fase de crescimento." },
                                { id: '2', nome: "Professional", preco_mensal: 399, descricao: "Para empresas com equipe de vendas, logística e montagem." },
                                { id: '3', nome: "Customizado", preco_mensal: 0, descricao: "Para operações em expansão com módulos e integrações sob medida.", recursos: { customizado: true } }
                            ])].sort((a, b) => {
                                const ordemA = a.recursos?.ordem !== undefined && a.recursos?.ordem !== "" ? Number(a.recursos.ordem) : null;
                                const ordemB = b.recursos?.ordem !== undefined && b.recursos?.ordem !== "" ? Number(b.recursos.ordem) : null;

                                if (ordemA !== null && ordemB !== null) return ordemA - ordemB;
                                if (ordemA !== null) return -1;
                                if (ordemB !== null) return 1;

                                const isCustomA = !a.preco_mensal || Number(a.preco_mensal) === 0 || a.recursos?.customizado || a.recursos?.sob_consulta;
                                const isCustomB = !b.preco_mensal || Number(b.preco_mensal) === 0 || b.recursos?.customizado || b.recursos?.sob_consulta;
                                if (isCustomA && !isCustomB) return 1;
                                if (!isCustomA && isCustomB) return -1;
                                return (Number(a.preco_mensal) || 0) - (Number(b.preco_mensal) || 0);
                            })).map((plano, index) => {
                                const isCustom = !plano.preco_mensal || Number(plano.preco_mensal) === 0 || plano.recursos?.customizado || plano.recursos?.sob_consulta;
                                const isPopular = plano.recursos?.destaque !== undefined ? !!plano.recursos.destaque : (index === 1);
                                const descricao = plano.recursos?.descricao || plano.descricao || (isCustom ? "Solução sob medida para o tamanho e fluxo da sua operação." : "Acesso completo aos módulos e recursos do GestApp.");
                                const botaoTexto = plano.recursos?.botao_texto || (isCustom ? "Contate-nos" : "Comece Agora");

                                const defaultBeneficios = isCustom ? [
                                    "Módulos e recursos sob demanda",
                                    "Suporte prioritário e especializado",
                                    "Backups automáticos diários",
                                    "Implantação e onboarding dedicado"
                                ] : [
                                    "Acesso via web em qualquer dispositivo",
                                    "Suporte especializado via WhatsApp",
                                    "Backups automáticos diários",
                                    "Módulos de PDV, Estoque e Logística"
                                ];

                                const beneficios = Array.isArray(plano.recursos?.beneficios) && plano.recursos.beneficios.length > 0
                                    ? plano.recursos.beneficios
                                    : defaultBeneficios;

                                const defaultContactUrl = `https://wa.me/5524998676926?text=${encodeURIComponent(`Olá! Gostaria de falar com um especialista e solicitar uma proposta personalizada para o Plano ${plano.nome} do GestApp.`)}`;
                                const finalLink = plano.recursos?.botao_link || (isCustom ? defaultContactUrl : `/cadastro?plano=${plano.id}`);
                                const isExternal = finalLink.startsWith("http://") || finalLink.startsWith("https://") || finalLink.startsWith("wa.me");

                                return (
                                    <Reveal key={plano.id || index} delay={150 + index * 150} direction="up">
                                        <div className="bg-white rounded-[2rem] p-4 sm:p-5 border border-slate-100 shadow-[0_15px_45px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_50px_rgba(0,0,0,0.07)] transition-all duration-300 flex flex-col justify-between h-full">

                                            <div className="space-y-6">
                                                {/* BLOCO SUPERIOR DE CABEÇALHO DO CARD */}
                                                <div className={`rounded-2xl p-6 transition-colors ${isPopular
                                                    ? "bg-[#e7f4ed] border border-[#ccebd5]"
                                                    : "bg-slate-100/70 border border-slate-200/50"
                                                    }`}>
                                                    {/* Badge da Categoria */}
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="inline-block px-3.5 py-1 bg-white text-slate-800 text-[11px] font-bold rounded-full tracking-wider uppercase shadow-2xs">
                                                            {plano.recursos?.badge || plano.nome}
                                                        </span>
                                                        {isPopular && (
                                                            <span className="text-[10px] font-bold text-[#2d7a4d] uppercase tracking-wider">
                                                                Mais Escolhido
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Preço */}
                                                    <div className="mt-6 flex items-baseline gap-1">
                                                        {isCustom ? (
                                                            <>
                                                                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                                                                    Sob Consulta
                                                                </span>
                                                                <span className="text-xs font-semibold text-slate-500">/personalizado</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                                                                    {formatCurrency(plano.preco_mensal || 0)}
                                                                </span>
                                                                <span className="text-xs font-semibold text-slate-500">/mês</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Subtítulo / Descrição Curta */}
                                                <p className="text-xs sm:text-sm font-semibold text-slate-800 px-2 min-h-[36px]">
                                                    {descricao}
                                                </p>

                                                {/* Botão de Ação Estilo Mubix (Escuro e Arredondado) */}
                                                <div className="px-1">
                                                    {isExternal ? (
                                                        <a
                                                            href={finalLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="w-full block"
                                                        >
                                                            <button className="w-full py-3.5 bg-[#1b2a23] hover:bg-[#14201a] text-white text-xs font-semibold rounded-full shadow-md hover:shadow-lg transition-all cursor-pointer">
                                                                {botaoTexto}
                                                            </button>
                                                        </a>
                                                    ) : (
                                                        <Link to={finalLink} className="w-full block">
                                                            <button className="w-full py-3.5 bg-[#1b2a23] hover:bg-[#14201a] text-white text-xs font-semibold rounded-full shadow-md hover:shadow-lg transition-all cursor-pointer">
                                                                {botaoTexto}
                                                            </button>
                                                        </Link>
                                                    )}
                                                </div>

                                                {/* Lista de Funcionalidades */}
                                                <div className="pt-2 px-2 space-y-3 text-xs text-slate-600 border-t border-slate-100">
                                                    {beneficios.map((beneficio, bIdx) => (
                                                        <div key={bIdx} className="flex items-center gap-2.5">
                                                            <Check className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                                            <span>{beneficio}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                        </div>
                                    </Reveal>
                                );
                            })}
                        </div>
                    )}

                </div>
            </section>

            {/* ================================================================ */}
            {/* SEÇÃO PERGUNTAS FREQUENTES (FAQ) */}
            {/* ================================================================ */}
            <section id="faq" className="py-16 md:py-24 bg-[#f8fcf9] border-t border-[#d6f0de]">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
                    <Reveal delay={100} direction="up">
                        <div className="text-center space-y-3">
                            Tire suas dúvidas
                            <h2 className="text-3xl sm:text-4xl font-bold text-[#1e4a38]">Perguntas Frequentes</h2>
                            <p className="text-slate-600 text-sm sm:text-base">
                                Respostas rápidas e diretas sobre o funcionamento do GestApp.
                            </p>
                        </div>
                    </Reveal>

                    <div className="space-y-4">
                        {[
                            {
                                q: "Como funciona a contratação do GestApp?",
                                a: "O cadastro é 100% online. Você preenche os dados da sua empresa, seleciona o plano desejado e tem acesso imediato ao painel administrativo."
                            },
                            {
                                q: "O sistema precisa ser instalado no computador?",
                                a: "Não. O GestApp é 100% web em nuvem. Você acessa diretamente pelo navegador em qualquer computador, tablet ou smartphone."
                            },
                            {
                                q: "Como funciona o rastreamento de entregas para os clientes?",
                                a: "Ao despachar uma entrega no módulo de logística, o sistema gera um link onde o cliente acompanha a localização do entregador no mapa em tempo real."
                            },
                            {
                                q: "Como meus dados e informações fiscais são protegidos?",
                                a: "Seus dados contam com isolamento por tenant a nível de banco de dados (Row Level Security), criptografia de ponta a ponta e backups diários automáticos."
                            }
                        ].map((item, idx) => (
                            <Reveal key={idx} delay={150 + idx * 100} direction="up">
                                <div
                                    className="bg-white border border-[#d6f0de] rounded-2xl overflow-hidden cursor-pointer hover:border-[#48bb78] transition-colors"
                                    onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                                >
                                    <div className="p-5 flex justify-between items-center text-base font-bold text-[#1e4a38]">
                                        <span>{item.q}</span>
                                        <ChevronDown
                                            className={`w-5 h-5 text-[#38a169] transition-transform duration-200 ${openFaq === idx ? "rotate-180" : ""
                                                }`}
                                        />
                                    </div>
                                    {openFaq === idx && (
                                        <div className="px-5 pb-5 text-sm text-slate-600 leading-relaxed border-t border-[#e7f6ec] pt-4 bg-[#fbfdfb]">
                                            {item.a}
                                        </div>
                                    )}
                                </div>
                            </Reveal>
                        ))}
                    </div>
                </div>
            </section>

            {/* ================================================================ */}
            {/* CALL TO ACTION FINAL */}
            {/* ================================================================ */}
            <section className="py-20 bg-[#1e4a38] text-white relative overflow-hidden">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6 relative z-10">
                    <Reveal delay={100} direction="up">
                        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
                            Transforme a gestão da sua empresa hoje mesmo
                        </h2>
                    </Reveal>

                    <Reveal delay={200} direction="up">
                        <p className="text-emerald-100 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
                            Unifique vendas, estoque, notas fiscais, logística e relacionamento com clientes em uma experiência sem complicação.
                        </p>
                    </Reveal>

                    <Reveal delay={300} direction="up">
                        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
                            <Link to="/cadastro" className="w-full sm:w-auto">
                                <button className="w-full sm:w-auto px-8 py-3.5 bg-[#48bb78] hover:bg-[#38a169] text-white font-medium rounded-full text-base transition-colors cursor-pointer inline-flex items-center justify-center gap-2">
                                    Comece Agora
                                    <ArrowRight className="w-5 h-5" />
                                </button>
                            </Link>
                            <Link to="/login" className="w-full sm:w-auto">
                                <button className="w-full sm:w-auto px-8 py-3.5 bg-transparent hover:bg-white/10 text-white font-medium rounded-full text-base border border-white/40 hover:border-white transition-colors cursor-pointer inline-flex items-center justify-center gap-2">
                                    <LogIn className="w-5 h-5" />
                                    Acessar Minha Conta
                                </button>
                            </Link>
                        </div>
                    </Reveal>
                </div>
            </section>

            {/* ================================================================ */}
            {/* RODAPÉ / FOOTER */}
            {/* ================================================================ */}
            <footer className="bg-[#153226] text-slate-400 py-14 text-xs border-t border-[#234d3b]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">
                        <div className="space-y-4">
                            <GestAppLogo light={true} />
                            <p className="text-emerald-100/70 text-xs leading-relaxed max-w-xs">
                                Plataforma integrada de Gestão Comercial, Controle Fiscal, Estoque e Logística de Entregas.
                            </p>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-bold text-white text-xs uppercase tracking-wider">Acesso Rápido</h4>
                            <ul className="space-y-2 text-xs">
                                <li>
                                    <Link to="/login" className="hover:text-emerald-300 transition-colors">
                                        Login da Empresa
                                    </Link>
                                </li>
                                <li>
                                    <Link to="/cadastro" className="hover:text-emerald-300 transition-colors">
                                        Cadastrar Empresa
                                    </Link>
                                </li>
                                <li>
                                    <Link to="/cliente-login" className="hover:text-emerald-300 transition-colors">
                                        Portal do Cliente
                                    </Link>
                                </li>
                                <li>
                                    <Link to="/operador/login" className="hover:text-emerald-300 transition-colors">
                                        Operador SaaS
                                    </Link>
                                </li>
                            </ul>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-bold text-white text-xs uppercase tracking-wider">Navegação</h4>
                            <ul className="space-y-2 text-xs">
                                <li>
                                    <button onClick={() => scrollToSection("pilares")} className="hover:text-emerald-300 transition-colors cursor-pointer">
                                        Funcionalidades
                                    </button>
                                </li>
                                <li>
                                    <button onClick={() => scrollToSection("portal-cliente")} className="hover:text-emerald-300 transition-colors cursor-pointer">
                                        Portal do Cliente
                                    </button>
                                </li>
                                <li>
                                    <button onClick={() => scrollToSection("planos")} className="hover:text-emerald-300 transition-colors cursor-pointer">
                                        Planos & Preços
                                    </button>
                                </li>
                                <li>
                                    <button onClick={() => scrollToSection("faq")} className="hover:text-emerald-300 transition-colors cursor-pointer">
                                        Dúvidas Frequentes
                                    </button>
                                </li>
                            </ul>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-bold text-white text-xs uppercase tracking-wider">Segurança & Suporte</h4>
                            <p className="text-emerald-100/70 text-xs leading-relaxed">
                                Atendimento aos clientes GestApp de Segunda a Sábado. Seus dados 100% protegidos e com backups diários.
                            </p>
                        </div>
                    </div>

                    <div className="pt-8 border-t border-[#234d3b] flex flex-col sm:flex-row justify-between items-center gap-4 text-emerald-100/60 text-[11px]">
                        <div>
                            <p>© 2026 GestApp. Todos os direitos reservados.</p>
                            <p className="mt-0.5">Desenvolvido com excelência para empresas em alto crescimento.</p>
                        </div>
                        <span className="font-semibold text-emerald-200">Gestão Comercial & Logística</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
