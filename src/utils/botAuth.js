import { supabase } from '@/lib/supabase';

export async function getBotAuthHeaders(extra = {}) {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.access_token) throw new Error('Faça login para acessar o WhatsApp');
    return { ...extra, Authorization: `Bearer ${session.access_token}` };
}
