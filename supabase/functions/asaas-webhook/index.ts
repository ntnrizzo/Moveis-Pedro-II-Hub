import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const events = new Set(['PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_DELETED','SUBSCRIPTION_DELETED']);
serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('ASAAS_WEBHOOK_SECRET');
  if (!secret || req.headers.get('asaas-access-token') !== secret) return new Response('Unauthorized', { status: 401 });
  try {
    const body = await req.json();
    if (!body.id || !events.has(body.event)) return new Response('Unsupported event', { status: 422 });
    const subscriptionId = body.event === 'SUBSCRIPTION_DELETED' ? body.subscription?.id : body.payment?.subscription || body.payment?.id;
    if (!subscriptionId) return new Response('Invalid subscription', { status: 400 });
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await client.rpc('processar_asaas_evento', {
      p_event_id: body.id, p_type: body.event, p_subscription_id: subscriptionId,
      p_due_date: body.payment?.dueDate || null,
    });
    if (error) return new Response('Processing failed', { status: 500 });
    return new Response('ok');
  } catch {
    return new Response('Processing failed', { status: 500 });
  }
});
