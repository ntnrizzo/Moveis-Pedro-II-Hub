import { getAuthContext, requireAdmin, requireOrganization, deny } from "../_shared/authContext.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const asaasKey = Deno.env.get('ASAAS_API_KEY') || '';
  const defaultUrl = (asaasKey.trim().startsWith('$aae') || asaasKey.trim().startsWith('$aact_prod')) 
    ? 'https://api.asaas.com/v3' 
    : 'https://api-sandbox.asaas.com/v3';
  const asaasUrl = Deno.env.get('ASAAS_API_URL') || defaultUrl;

  if (!asaasKey) {
    return new Response(
      JSON.stringify({ error: 'Asaas API Key not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const asaasHeaders = {
    'Content-Type': 'application/json',
    'access_token': asaasKey
  };

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Authenticate the user calling this function
    const userSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) {
      console.error('User auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize service client to modify DB tables
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch user's organization_id from public_users
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('public_users')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Profile fetch error:', profileError);
      return new Response(
        JSON.stringify({ error: 'User profile organization not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const ctx = await getAuthContext(req);
    const orgId = ctx.organizationId;

    // Parse request body
    const { planoId, paymentMethod, cardDetails, billingInfo, action = 'create' } = await req.json().catch(() => ({}));

    requireAdmin(ctx); // Creating/updating can also cancel the previous subscription.

    // Action: Cancel Subscription
    if (action === 'cancel') {
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('asaas_subscription_id')
        .eq('id', orgId)
        .single();

      if (orgError || !org || !org.asaas_subscription_id) {
        return new Response(
          JSON.stringify({ error: 'No active subscription found to cancel' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Call Asaas DELETE subscription or payment
      let asaasResponse;
      if (org.asaas_subscription_id.startsWith('sub_')) {
        asaasResponse = await fetch(`${asaasUrl}/subscriptions/${org.asaas_subscription_id}`, {
          method: 'DELETE',
          headers: asaasHeaders
        });
      } else {
        asaasResponse = await fetch(`${asaasUrl}/payments/${org.asaas_subscription_id}`, {
          method: 'DELETE',
          headers: asaasHeaders
        });
      }

      if (!asaasResponse.ok) {
        const errText = await asaasResponse.text();
        return new Response(
          JSON.stringify({ error: `Asaas error: ${errText}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Mark database as cancelada (will clear module access fully upon webhook execution)
      await supabaseAdmin
        .from('organizations')
        .update({ status_assinatura: 'cancelada' })
        .eq('id', orgId);

      return new Response(
        JSON.stringify({ success: true, message: 'Subscription canceled successfully' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Action: Cancel pending subscription and allow restart
    if (action === 'cancel-and-restart') {
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('asaas_subscription_id')
        .eq('id', orgId)
        .single();

      if (orgError || !org || !org.asaas_subscription_id) {
        return new Response(
          JSON.stringify({ error: 'No active subscription found to cancel' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Call Asaas DELETE subscription or payment to clean up the pending boleto
      if (org.asaas_subscription_id.startsWith('sub_')) {
        await fetch(`${asaasUrl}/subscriptions/${org.asaas_subscription_id}`, {
          method: 'DELETE',
          headers: asaasHeaders
        });
      } else {
        await fetch(`${asaasUrl}/payments/${org.asaas_subscription_id}`, {
          method: 'DELETE',
          headers: asaasHeaders
        });
      }

      // Mark database as inativa and clear the subscription ID so they can start fresh
      await supabaseAdmin
        .from('organizations')
        .update({ 
          status_assinatura: 'inativa',
          asaas_subscription_id: null 
        })
        .eq('id', orgId);

      return new Response(
        JSON.stringify({ success: true, message: 'Subscription canceled, ready to restart' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Action: Get pending payment details
    if (action === 'get-pending-payment') {
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('asaas_subscription_id')
        .eq('id', orgId)
        .single();

      if (orgError || !org || !org.asaas_subscription_id) {
        return new Response(
          JSON.stringify({ error: 'Subscription not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      let paymentsData = { data: [] };

      if (org.asaas_subscription_id.startsWith('sub_')) {
        const paymentsResponse = await fetch(`${asaasUrl}/subscriptions/${org.asaas_subscription_id}/payments`, {
          method: 'GET',
          headers: asaasHeaders
        });

        if (paymentsResponse.ok) {
          paymentsData = await paymentsResponse.json();
        } else {
          const errText = await paymentsResponse.text();
          return new Response(
            JSON.stringify({ error: `Asaas error: ${errText}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      } else if (org.asaas_subscription_id.startsWith('pay_')) {
        const singlePaymentRes = await fetch(`${asaasUrl}/payments/${org.asaas_subscription_id}`, {
          method: 'GET',
          headers: asaasHeaders
        });
        if (singlePaymentRes.ok) {
          const singlePayment = await singlePaymentRes.json();
          paymentsData.data = [singlePayment];
        } else {
          const errText = await singlePaymentRes.text();
          return new Response(
            JSON.stringify({ error: `Asaas error: ${errText}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      if (!paymentsData.data || paymentsData.data.length === 0) {
        return new Response(
          JSON.stringify({ message: 'No payments found' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const payment = paymentsData.data[0];

      if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(payment.status)) {
        await supabaseAdmin
          .from('organizations')
          .update({ status_assinatura: 'ativa' })
          .eq('id', orgId);
      }

      let pixQrCode = null;
      let pixCopiaCola = null;

      try {
        const pixResponse = await fetch(`${asaasUrl}/payments/${payment.id}/pixQrCode`, {
          method: 'GET',
          headers: asaasHeaders
        });
        if (pixResponse.ok) {
          const pixData = await pixResponse.json();
          pixQrCode = pixData.encodedImage;
          pixCopiaCola = pixData.payload;
        }
      } catch (err) {
        console.error("Error fetching pix QrCode:", err);
      }

      return new Response(
        JSON.stringify({
          subscriptionId: org.asaas_subscription_id,
          paymentId: payment.id,
          billingType: payment.billingType,
          invoiceUrl: payment.invoiceUrl,
          bankSlipUrl: payment.bankSlipUrl,
          pixQrCode,
          pixCopiaCola,
          dueDate: payment.dueDate,
          value: payment.value,
          status: payment.status
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Action: Create or Update Subscription (Subscribe / Upgrade / Downgrade)
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: 'Organization not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update billing info if provided
    if (billingInfo) {
      const updateData: any = {};
      if (billingInfo.cnpj) updateData.cnpj = billingInfo.cnpj.replace(/\D/g, '');
      if (billingInfo.email) updateData.email_suporte = billingInfo.email.trim();
      if (billingInfo.phone) updateData.whatsapp_suporte = billingInfo.phone.replace(/\D/g, '');

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabaseAdmin
          .from('organizations')
          .update(updateData)
          .eq('id', orgId);

        if (updateError) {
          console.error('Error updating organization billing info:', updateError);
        } else {
          if (updateData.cnpj) org.cnpj = updateData.cnpj;
          if (updateData.email_suporte) org.email_suporte = updateData.email_suporte;
          if (updateData.whatsapp_suporte) org.whatsapp_suporte = updateData.whatsapp_suporte;
        }
      }
    }

    if (!planoId || !paymentMethod) {
      return new Response(
        JSON.stringify({ error: 'Missing planoId or paymentMethod' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: plano, error: planoError } = await supabaseAdmin
      .from('planos')
      .select('*')
      .eq('id', planoId)
      .single();

    if (planoError || !plano) {
      return new Response(
        JSON.stringify({ error: 'Plan not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Create Customer in Asaas if they don't have one
    let customerId = org.asaas_customer_id;
    if (!customerId) {
      const customerPayload = {
        name: org.razao_social || org.name,
        cpfCnpj: org.cnpj ? org.cnpj.replace(/\D/g, '') : undefined,
        email: org.email_suporte || undefined,
        mobilePhone: org.whatsapp_suporte ? org.whatsapp_suporte.replace(/\D/g, '') : undefined,
      };

      const createCustomerRes = await fetch(`${asaasUrl}/customers`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify(customerPayload)
      });

      if (!createCustomerRes.ok) {
        const errText = await createCustomerRes.text();
        return new Response(
          JSON.stringify({ error: `Asaas customer creation failed: ${errText}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const customerData = await createCustomerRes.json();
      customerId = customerData.id;

      await supabaseAdmin
        .from('organizations')
        .update({ asaas_customer_id: customerId })
        .eq('id', orgId);
    }

    // Calculate today's date in Sao Paulo timezone (UTC-3)
    const date = new Date();
    const brtDate = new Date(date.getTime() - 3 * 60 * 60 * 1000);
    const nextDueDate = brtDate.toISOString().split('T')[0];

    let subscriptionId = org.asaas_subscription_id;
    const isNewSub = !subscriptionId;

    if (isNewSub) {
      if (paymentMethod === 'PIX') {
        // Create a single payment instead of a subscription for PIX
        const paymentPayload: any = {
          customer: customerId,
          billingType: 'PIX',
          value: plano.preco_mensal,
          dueDate: nextDueDate,
          description: `Pagamento Mensal - ${plano.nome}`,
          remoteIp: req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1',
        };

        const createPayRes = await fetch(`${asaasUrl}/payments`, {
          method: 'POST',
          headers: asaasHeaders,
          body: JSON.stringify(paymentPayload)
        });

        if (!createPayRes.ok) {
          const errText = await createPayRes.text();
          return new Response(
            JSON.stringify({ error: `Asaas PIX creation failed: ${errText}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const payData = await createPayRes.json();
        subscriptionId = payData.id;

        await supabaseAdmin
          .from('organizations')
          .update({
            plano_id: plano.id,
            asaas_subscription_id: subscriptionId, // We store the payment ID here
            status_assinatura: 'processando',
            proxima_cobranca: nextDueDate
          })
          .eq('id', orgId);

      } else {
        // 2. Create Subscription in Asaas
        const subscriptionPayload: any = {
          customer: customerId,
          billingType: paymentMethod, // CREDIT_CARD or BOLETO
          value: plano.preco_mensal,
          nextDueDate: nextDueDate,
          cycle: 'MONTHLY',
          description: `Assinatura de Plano - ${plano.nome}`,
          remoteIp: req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1',
        };

        if (paymentMethod === 'CREDIT_CARD') {
          if (!cardDetails) {
            return new Response(
              JSON.stringify({ error: 'Missing credit card details' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          subscriptionPayload.creditCard = {
            holderName: cardDetails.holderName,
            number: cardDetails.number.replace(/\D/g, ''),
            expiryMonth: cardDetails.expiryMonth,
            expiryYear: cardDetails.expiryYear,
            ccv: cardDetails.ccv
          };
          subscriptionPayload.creditCardHolderInfo = {
            name: cardDetails.holderName,
            email: org.email_suporte || cardDetails.email,
            cpfCnpj: org.cnpj ? org.cnpj.replace(/\D/g, '') : cardDetails.cpfCnpj.replace(/\D/g, ''),
            postalCode: cardDetails.postalCode?.replace(/\D/g, ''),
            addressNumber: cardDetails.addressNumber || '1',
            phone: org.whatsapp_suporte ? org.whatsapp_suporte.replace(/\D/g, '') : cardDetails.phone?.replace(/\D/g, ''),
          };
        }

        const createSubRes = await fetch(`${asaasUrl}/subscriptions`, {
          method: 'POST',
          headers: asaasHeaders,
          body: JSON.stringify(subscriptionPayload)
        });

        if (!createSubRes.ok) {
          const errText = await createSubRes.text();
          return new Response(
            JSON.stringify({ error: `Asaas subscription creation failed: ${errText}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const subData = await createSubRes.json();
        subscriptionId = subData.id;

        await supabaseAdmin
          .from('organizations')
          .update({
            plano_id: plano.id,
            asaas_subscription_id: subscriptionId,
            status_assinatura: 'processando',
            proxima_cobranca: nextDueDate
          })
          .eq('id', orgId);
      }

      // 3. Update Existing Subscription or Payment
      if (paymentMethod === 'PIX') {
        // If they are changing to PIX, cancel the old subscription or old payment
        if (subscriptionId.startsWith('sub_')) {
          await fetch(`${asaasUrl}/subscriptions/${subscriptionId}`, { method: 'DELETE', headers: asaasHeaders });
        } else if (subscriptionId.startsWith('pay_')) {
          await fetch(`${asaasUrl}/payments/${subscriptionId}`, { method: 'DELETE', headers: asaasHeaders });
        }

        // Create a new single payment for PIX
        const paymentPayload: any = {
          customer: customerId,
          billingType: 'PIX',
          value: plano.preco_mensal,
          dueDate: nextDueDate,
          description: `Pagamento Mensal - ${plano.nome}`,
        };
        const createPayRes = await fetch(`${asaasUrl}/payments`, {
          method: 'POST',
          headers: asaasHeaders,
          body: JSON.stringify(paymentPayload)
        });

        if (createPayRes.ok) {
          const payData = await createPayRes.json();
          subscriptionId = payData.id;
          await supabaseAdmin.from('organizations').update({
            plano_id: plano.id,
            asaas_subscription_id: subscriptionId,
            status_assinatura: 'processando',
            proxima_cobranca: nextDueDate
          }).eq('id', orgId);
        }
      } else {
        // Update Asaas Subscription
        if (subscriptionId.startsWith('pay_')) {
           // If old was a single payment (PIX) and they are moving to CREDIT/BOLETO, cancel old payment and create subscription
           await fetch(`${asaasUrl}/payments/${subscriptionId}`, { method: 'DELETE', headers: asaasHeaders });
           
           const subscriptionPayload: any = {
             customer: customerId,
             billingType: paymentMethod,
             value: plano.preco_mensal,
             nextDueDate: nextDueDate,
             cycle: 'MONTHLY',
             description: `Assinatura de Plano - ${plano.nome}`,
           };
           //... credit card logic omitted for brevity, let's keep it simple or recreate it
           // Actually, since they use the "Cancelar Fatura" button to restart, they rarely hit this path for changing methods.
           // Let's just create the subscription.
           if (paymentMethod === 'CREDIT_CARD' && cardDetails) {
              subscriptionPayload.creditCard = {
                holderName: cardDetails.holderName,
                number: cardDetails.number.replace(/\D/g, ''),
                expiryMonth: cardDetails.expiryMonth,
                expiryYear: cardDetails.expiryYear,
                ccv: cardDetails.ccv
              };
              subscriptionPayload.creditCardHolderInfo = {
                name: cardDetails.holderName,
                email: org.email_suporte || cardDetails.email,
                cpfCnpj: org.cnpj ? org.cnpj.replace(/\D/g, '') : cardDetails.cpfCnpj.replace(/\D/g, ''),
                postalCode: cardDetails.postalCode?.replace(/\D/g, ''),
                addressNumber: cardDetails.addressNumber || '1',
                phone: org.whatsapp_suporte ? org.whatsapp_suporte.replace(/\D/g, '') : cardDetails.phone?.replace(/\D/g, ''),
              };
           }
           const createSubRes = await fetch(`${asaasUrl}/subscriptions`, {
             method: 'POST',
             headers: asaasHeaders,
             body: JSON.stringify(subscriptionPayload)
           });
           if (createSubRes.ok) {
             const subData = await createSubRes.json();
             subscriptionId = subData.id;
             await supabaseAdmin.from('organizations').update({
               plano_id: plano.id,
               asaas_subscription_id: subscriptionId,
               status_assinatura: 'processando',
               proxima_cobranca: nextDueDate
             }).eq('id', orgId);
           }
        } else {
           // Normal subscription update
           const updatePayload: any = {
             value: plano.preco_mensal,
             billingType: paymentMethod,
             description: `Alteração Plano - ${plano.nome}`,
             updatePendingPayments: true
           };

           if (paymentMethod === 'CREDIT_CARD') {
             if (!cardDetails) {
               return new Response(
                 JSON.stringify({ error: 'Missing credit card details' }),
                 { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
               )
             }
             updatePayload.creditCard = {
               holderName: cardDetails.holderName,
               number: cardDetails.number.replace(/\D/g, ''),
               expiryMonth: cardDetails.expiryMonth,
               expiryYear: cardDetails.expiryYear,
               ccv: cardDetails.ccv
             };
             updatePayload.creditCardHolderInfo = {
               name: cardDetails.holderName,
               email: org.email_suporte || cardDetails.email,
               cpfCnpj: org.cnpj ? org.cnpj.replace(/\D/g, '') : cardDetails.cpfCnpj.replace(/\D/g, ''),
               postalCode: cardDetails.postalCode?.replace(/\D/g, ''),
               addressNumber: cardDetails.addressNumber || '1',
               phone: org.whatsapp_suporte ? org.whatsapp_suporte.replace(/\D/g, '') : cardDetails.phone?.replace(/\D/g, ''),
             };
           }

           const updateSubRes = await fetch(`${asaasUrl}/subscriptions/${subscriptionId}`, {
             method: 'POST',
             headers: asaasHeaders,
             body: JSON.stringify(updatePayload)
           });

           if (!updateSubRes.ok) {
             const errText = await updateSubRes.text();
             return new Response(
               JSON.stringify({ error: `Asaas subscription update failed: ${errText}` }),
               { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
             )
           }

           await supabaseAdmin
             .from('organizations')
             .update({
               plano_id: plano.id,
               status_assinatura: 'processando'
             })
             .eq('id', orgId);
        }
      }
    }

    // 4. Retrieve details of the current pending invoice
    let paymentsData = { data: [] };
    if (subscriptionId.startsWith('sub_')) {
      const paymentsResponse = await fetch(`${asaasUrl}/subscriptions/${subscriptionId}/payments?status=PENDING`, {
        method: 'GET',
        headers: asaasHeaders
      });
      if (paymentsResponse.ok) paymentsData = await paymentsResponse.json();
    } else if (subscriptionId.startsWith('pay_')) {
      const singlePayRes = await fetch(`${asaasUrl}/payments/${subscriptionId}`, {
        method: 'GET',
        headers: asaasHeaders
      });
      if (singlePayRes.ok) {
        const singlePayData = await singlePayRes.json();
        if (singlePayData.status === 'PENDING' || singlePayData.status === 'OVERDUE') {
          paymentsData.data = [singlePayData];
        }
      }
    }

    if (!paymentsData.data || paymentsData.data.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          subscriptionId,
          message: 'Assinatura criada/atualizada com sucesso.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let payment = paymentsData.data[0];

    if (paymentMethod === 'PIX' || paymentMethod === 'BOLETO') {
      const targetBillingType = paymentMethod;
      if (payment.billingType !== targetBillingType) {
        console.log(`Updating pending payment ${payment.id} billingType from ${payment.billingType} to ${targetBillingType}`);
        const updatePaymentRes = await fetch(`${asaasUrl}/payments/${payment.id}`, {
          method: 'POST',
          headers: asaasHeaders,
          body: JSON.stringify({ billingType: targetBillingType })
        });
        if (updatePaymentRes.ok) {
          payment = await updatePaymentRes.json();
        } else {
          console.error(`Failed to update pending payment billingType:`, await updatePaymentRes.text());
        }
      }
    }

    let pixQrCode = null;
    let pixCopiaCola = null;

    try {
      const pixResponse = await fetch(`${asaasUrl}/payments/${payment.id}/pixQrCode`, {
        method: 'GET',
        headers: asaasHeaders
      });
      if (pixResponse.ok) {
        const pixData = await pixResponse.json();
        pixQrCode = pixData.encodedImage;
        pixCopiaCola = pixData.payload;
      }
    } catch (err) {
      console.error("Error fetching pix QrCode:", err);
    }

    return new Response(
      JSON.stringify({
        success: true,
        subscriptionId,
        paymentId: payment.id,
        billingType: payment.billingType,
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl,
        pixQrCode,
        pixCopiaCola,
        dueDate: payment.dueDate,
        value: payment.value
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
        if (error instanceof Response) return error;
    console.error('Error in Edge Function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
