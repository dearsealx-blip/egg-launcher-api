import { Router } from 'express';
import { db } from '../db.js';

export const tradeRouter = Router();

// GET /api/trade/:ticker/history
tradeRouter.get('/:ticker/history', async (req, res) => {
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        const { data } = await supabase
            .from('egg_trades')
            .select('*')
            .eq('ticker', req.params.ticker.toUpperCase())
            .order('created_at', { ascending: false })
            .limit(50);
        res.json(data || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/trade/log — called by watcher when trade detected on-chain
tradeRouter.post('/log', async (req, res) => {
    try {
        await db.logTrade(req.body);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
