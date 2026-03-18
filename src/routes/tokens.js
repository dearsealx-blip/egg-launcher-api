import { Router } from 'express';
import { db } from '../db.js';

export const tokenRouter = Router();

// GET /api/tokens — list all active tokens
tokenRouter.get('/', async (req, res) => {
    try {
        const sort   = req.query.sort || 'created_at';
        const limit  = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const tokens = await db.listTokens({ sort, limit, offset });
        res.json(tokens);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/tokens/trending
tokenRouter.get('/trending', async (req, res) => {
    try {
        res.json(await db.getTrending());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/tokens/graduated
tokenRouter.get('/graduated', async (req, res) => {
    try {
        res.json(await db.getGraduated());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/tokens/:ticker
tokenRouter.get('/:ticker', async (req, res) => {
    try {
        const token = await db.getToken(req.params.ticker.toUpperCase());
        res.json(token);
    } catch (e) {
        res.status(404).json({ error: 'not found' });
    }
});

// POST /api/tokens/:ticker/follow
tokenRouter.post('/:ticker/follow', async (req, res) => {
    try {
        const { tg_id } = req.body;
        if (!tg_id) return res.status(400).json({ error: 'tg_id required' });
        await db.followToken(tg_id, req.params.ticker);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
