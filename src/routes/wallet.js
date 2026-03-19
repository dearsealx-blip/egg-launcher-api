import express from 'express';
import { getOrCreateWallet, getWalletBalance, buyOnBehalf, sellOnBehalf, getMnemonic, getJettonBalance } from '../wallet_service.js';
import { syncToken } from '../sync.js';
import { db } from '../db.js';

export const walletRouter = express.Router();

// GET /api/wallet/:tg_id — get or create wallet
walletRouter.get('/:tg_id', async (req, res) => {
    try {
        const { tg_id } = req.params;
        const tg_username = req.query.username || '';
        const wallet = await getOrCreateWallet(parseInt(tg_id), tg_username);
        const balance = await getWalletBalance(wallet.address);
        res.json({ ok: true, address: wallet.address, balance });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/wallet/:tg_id/jetton?master=ADDRESS
walletRouter.get('/:tg_id/jetton', async (req, res) => {
    try {
        const { data: w } = await (await import('@supabase/supabase-js'))
            .createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
            .from('egg_wallets').select('address').eq('tg_id', req.params.tg_id).single();
        if (!w) return res.json({ balance: '0' });
        const balance = await getJettonBalance(w.address, req.query.master);
        res.json({ balance });
    } catch (e) { res.json({ balance: '0' }); }
});

// GET /api/wallet/:tg_id/seed — return decrypted mnemonic (user exports keys)
walletRouter.get('/:tg_id/seed', async (req, res) => {
    try {
        const mnemonic = await getMnemonic(parseInt(req.params.tg_id));
        res.json({ ok: true, mnemonic });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/wallet/buy
walletRouter.post('/buy', async (req, res) => {
    try {
        const { tg_id, curve_address, ton_amount } = req.body;
        if (!tg_id || !curve_address || !ton_amount) return res.status(400).json({ error: 'Missing params' });
        const seqno = await buyOnBehalf(parseInt(tg_id), curve_address, ton_amount);
        res.json({ ok: true, seqno });
        // Sync stats after trade (fire-and-forget)
        setTimeout(() => syncToken(curve_address).catch(() => {}), 8000);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/wallet/sell
walletRouter.post('/sell', async (req, res) => {
    try {
        const { tg_id, curve_address, jetton_address, token_amount } = req.body;
        if (!tg_id || !curve_address || !jetton_address || !token_amount) return res.status(400).json({ error: 'Missing params' });
        const seqno = await sellOnBehalf(parseInt(tg_id), curve_address, jetton_address, token_amount);
        res.json({ ok: true, seqno });
        setTimeout(() => syncToken(curve_address).catch(() => {}), 8000);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
