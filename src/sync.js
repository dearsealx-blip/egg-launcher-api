import { TonClient, Address } from '@ton/ton';
import { createClient } from '@supabase/supabase-js';

const client  = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function syncToken(curve_address) {
    const r = await client.runMethod(Address.parse(curve_address), 'curve_state');
    const s = r.stack;
    s.readBigNumber(); // virtual_ton
    s.readBigNumber(); // virtual_tokens
    const real_ton_collected = s.readBigNumber();
    s.readBigNumber(); // tokens_sold
    s.readBoolean();   // graduated
    const trade_count = s.readBigNumber();

    const real_ton = Number(real_ton_collected) / 1e9;
    const progress = Math.min(100, real_ton * 100 / 500);

    const { error: updateErr } = await supabase.from('egg_tokens').update({ real_ton, trade_count: Number(trade_count), progress })
        .eq('curve_address', curve_address);
    if (updateErr) console.error('[sync] update error:', updateErr.message);
    else console.log(`[sync] ${curve_address.slice(0,10)} real_ton=${real_ton} trades=${trade_count}`);

    return { real_ton, trade_count: Number(trade_count), progress };
}

export async function syncAllTokens() {
    const { data: tokens } = await supabase.from('egg_tokens').select('ticker, curve_address').eq('graduated', false);
    for (const t of tokens || []) {
        try { await syncToken(t.curve_address); } catch {}
    }
}
