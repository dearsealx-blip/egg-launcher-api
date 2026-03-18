import express from 'express';
import { getOrCreateWallet, getWalletBalance, buyOnBehalf } from '../wallet_service.js';
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

// POST /api/wallet/buy — buy on behalf of user
walletRouter.post('/buy', async (req, res) => {
    try {
        const { tg_id, curve_address, ton_amount } = req.body;
        if (!tg_id || !curve_address || !ton_amount) return res.status(400).json({ error: 'Missing params' });
        const seqno = await buyOnBehalf(parseInt(tg_id), curve_address, ton_amount);
        res.json({ ok: true, seqno });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
