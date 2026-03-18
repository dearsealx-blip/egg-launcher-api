import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

export const db = {
    async init() {
        console.log('[db] connected to Supabase');
    },

    // ── Tokens ────────────────────────────────────────────────────────────────

    async createToken(data) {
        const { data: token, error } = await supabase
            .from('tokens')
            .insert({
                name:              data.name,
                ticker:            data.ticker,
                description:       data.description,
                image_url:         data.image_url,
                creator_address:   data.creator_address,
                creator_tg_id:     data.creator_tg_id,
                creator_username:  data.creator_username,
                curve_address:     data.curve_address,
                jetton_address:    data.jetton_address,
                dex_choice:        data.dex_choice,   // 'dedust' | 'stonfi'
                real_ton:          0,
                virtual_ton:       10,
                virtual_tokens:    1000000000,
                tokens_sold:       0,
                trade_count:       0,
                graduated:         false,
                lp_address:        null,
            })
            .select()
            .single();
        if (error) throw error;
        return token;
    },

    async getToken(ticker) {
        const { data, error } = await supabase
            .from('tokens')
            .select('*')
            .ilike('ticker', ticker)
            .single();
        if (error) throw error;
        return data;
    },

    async getTokenByAddress(curve_address) {
        const { data, error } = await supabase
            .from('tokens')
            .select('*')
            .eq('curve_address', curve_address)
            .single();
        if (error) throw error;
        return data;
    },

    async updateTokenState(curve_address, state) {
        const { error } = await supabase
            .from('tokens')
            .update({
                real_ton:       state.real_ton_collected / 1e9,
                virtual_ton:    state.virtual_ton / 1e9,
                virtual_tokens: state.virtual_tokens,
                tokens_sold:    state.tokens_sold,
                trade_count:    state.trade_count,
                price:          state.price,
                progress:       state.progress,
                graduated:      state.graduated,
            })
            .eq('curve_address', curve_address);
        if (error) throw error;
    },

    async graduateToken(curve_address, lp_address) {
        const { error } = await supabase
            .from('tokens')
            .update({ graduated: true, lp_address })
            .eq('curve_address', curve_address);
        if (error) throw error;
    },

    async listTokens({ sort = 'created_at', limit = 20, offset = 0 } = {}) {
        const { data, error } = await supabase
            .from('tokens')
            .select('*')
            .eq('graduated', false)
            .order(sort, { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) throw error;
        return data;
    },

    async getTrending() {
        const { data, error } = await supabase
            .from('tokens')
            .select('*')
            .eq('graduated', false)
            .order('trade_count', { ascending: false })
            .limit(10);
        if (error) throw error;
        return data;
    },

    async getGraduated() {
        const { data, error } = await supabase
            .from('tokens')
            .select('*')
            .eq('graduated', true)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    // ── Dashboard stats ───────────────────────────────────────────────────────

    async getStats() {
        const { count: total } = await supabase
            .from('tokens')
            .select('*', { count: 'exact', head: true });

        const { count: graduated } = await supabase
            .from('tokens')
            .select('*', { count: 'exact', head: true })
            .eq('graduated', true);

        const { data: topToken } = await supabase
            .from('tokens')
            .select('name, ticker, real_ton')
            .order('real_ton', { ascending: false })
            .limit(1)
            .single();

        return { total, graduated, topToken };
    },

    // ── Username claim (1 per username) ──────────────────────────────────────

    async claimUsername(tg_username, ticker) {
        const { data: existing } = await supabase
            .from('username_claims')
            .select('ticker')
            .eq('tg_username', tg_username.toLowerCase())
            .single();

        if (existing) throw new Error(`@${tg_username} already launched $${existing.ticker}`);

        await supabase.from('username_claims').insert({
            tg_username: tg_username.toLowerCase(),
            ticker:      ticker.toUpperCase(),
        });
    },

    // ── Followers ─────────────────────────────────────────────────────────────

    async followToken(tg_id, ticker) {
        await supabase.from('follows').upsert({
            tg_id,
            ticker: ticker.toUpperCase(),
        });
    },

    async getFollowers(ticker) {
        const { data } = await supabase
            .from('follows')
            .select('tg_id')
            .eq('ticker', ticker.toUpperCase());
        return data?.map(r => r.tg_id) || [];
    },

    // ── Trades log ────────────────────────────────────────────────────────────

    async logTrade(trade) {
        await supabase.from('trades').insert({
            ticker:     trade.ticker,
            type:       trade.type,  // 'buy' | 'sell'
            ton_amount: trade.ton_amount,
            tokens:     trade.tokens,
            wallet:     trade.wallet,
            tx_hash:    trade.tx_hash,
        });
    },
};
