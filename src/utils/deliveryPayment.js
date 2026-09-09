import { validatePaymentSplit } from "@/services/paymentOrchestrator";
import { registerDeliveryPayment } from "@/services/financialOperations";

export const MONEY_EPSILON = 0.01;

export function toMoneyNumber(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === "string") {
        const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value) {
    return toMoneyNumber(value).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export function needsDeliveryPaymentConfirmation(entrega) {
    return Boolean(entrega?.pagamento_na_entrega || toMoneyNumber(entrega?.valor_a_receber) > MONEY_EPSILON);
}

export async function applyDeliveryPayment({
    entrega,
    pagamentoStatus,
    valorRecebido,
    formaPagamento,
    pagamentos,
    motivoPendente,
    comprovanteUrl = null,
    paymentDateIso = new Date().toISOString(),
}) {
    if (!entrega?.id) {
        throw new Error("Entrega inválida para registrar pagamento.");
    }

    const pagamentoInformado = pagamentoStatus === "pago";
    const pagamentosInformados = Array.isArray(pagamentos) ? pagamentos : [];
    const rawPayments = pagamentosInformados.length > 0
        ? pagamentosInformados
        : pagamentoInformado
            ? [{ forma_pagamento: formaPagamento, valor: valorRecebido, parcelas: 1 }]
            : [];

    if (pagamentoInformado) {
        const totalAlvo = Math.max(
            toMoneyNumber(entrega?.valor_a_receber),
            rawPayments.reduce((sum, payment) => sum + toMoneyNumber(payment?.valor), 0)
        );
        const initialValidation = validatePaymentSplit({
            total: totalAlvo,
            payments: rawPayments.map((payment) => ({
                ...payment,
                valor: toMoneyNumber(payment?.valor),
                parcelas: Number(payment?.parcelas || 1),
            })),
        });

        if (!initialValidation.ok) {
            throw new Error(initialValidation.errors[0] || "Não foi possível validar os pagamentos informados.");
        }
    }

    const paymentsForServer = pagamentoInformado
        ? rawPayments.map((payment) => ({
            ...payment,
            valor: toMoneyNumber(payment?.valor),
            parcelas: Number(payment?.parcelas || 1),
        }))
        : [];

    return registerDeliveryPayment({
        deliveryId: entrega.id,
        paymentStatus: pagamentoStatus,
        payments: paymentsForServer,
        pendingReason: motivoPendente,
        receiptUrl: comprovanteUrl,
        paymentDateIso,
    });
}
