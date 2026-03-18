import { Router } from 'express';
import { db } from '../db.js';
import { TonClient, Address, fromNano } from '@ton/ton';

export const dashboardRouter = Router();

const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey:   process.env.TONCENTER_API_KEY,
});

const EGG_WALLET = 'UQCPMM8-ORuo7XVypJdcKQe5Cg_rLTjD09SyxKvyYSKoeRuc';

dashboardRouter.get('/', async (req, res) => {
    try {
        const [stats, trending, graduated] = await Promise.all([
            db.getStats(),
            db.getTrending(),
            db.getGraduated(),
        ]);

        // Get egg treasury balance
        let treasury_ton = 0;
        try {
            const bal = await client.getBalance(Address.parse(EGG_WALLET));
            treasury_ton = parseFloat(fromNano(bal));
        } catch {}

        res.json({
            total:            stats.total || 0,
            graduated:        stats.graduated || 0,
            treasury_ton,
            trending:         trending.slice(0, 5),
            graduated_tokens: graduated.slice(0, 4),
            top_token:        stats.topToken,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Portfolio for a user
dashboardRouter.get('/portfolio/:tg_id', async (req, res) => {
    try {
        const tg_id = parseInt(req.params.tg_id);
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

        const [{ data: launched }, { data: follows }, { data: earnings }] = await Promise.all([
            supabase.from('egg_tokens').select('*').eq('creator_tg_id', tg_id),
            supabase.from('egg_follows').select('ticker').eq('tg_id', tg_id),
            supabase.from('egg_earnings').select('*').eq('tg_id', tg_id).single(),
        ]);

        // Get followed token details
        const tickers = (follows || []).map(f => f.ticker);
        let following = [];
        if (tickers.length > 0) {
            const { data } = await supabase.from('egg_tokens').select('ticker,progress,real_ton').in('ticker', tickers);
            following = data || [];
        }

        res.json({
            launched:             launched || [],
            following,
            total_earnings_ton:   earnings?.trade_fees_ton || 0,
            referral_earnings_ton: earnings?.referral_ton || 0,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
