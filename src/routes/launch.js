import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import FormData from 'form-data';
import fetch from 'node-fetch';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const EGG_WALLET = 'UQCPMM8-ORuo7XVypJdcKQe5Cg_rLTjD09SyxKvyYSKoeRuc';

function supabase() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

// POST /api/launch/pending — reserve a launch slot, returns payment instructions
router.post('/pending', async (req, res) => {
    try {
        const { name, ticker, description, image_url, dex_choice, tg_id, tg_username } = req.body;

        if (!name || !ticker || !image_url) {
            return res.status(400).json({ error: 'name, ticker, image_url required' });
        }

        const clean_ticker = ticker.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

        const sb = supabase();

        // Check ticker not already taken
        const { data: existing } = await sb.from('egg_tokens').select('ticker').eq('ticker', clean_ticker).single();
        if (existing) return res.status(409).json({ error: `$${clean_ticker} is already launched` });

        const { data: pending } = await sb.from('egg_pending_launches').select('ticker').eq('ticker', clean_ticker).eq('paid', false).single();
        if (pending) return res.status(409).json({ error: `$${clean_ticker} is already reserved` });

        // Upsert pending launch
        const { error } = await sb.from('egg_pending_launches').upsert({
            ticker: clean_ticker, name, description: description || '',
            image_url, dex_choice: dex_choice || 'dedust',
            creator_tg_id: tg_id || null,
            tg_username: tg_username || '',
            paid: false,
        }, { onConflict: 'ticker' });

        if (error) throw new Error(error.message);

        res.json({
            ok: true,
            ticker: clean_ticker,
            payment_address: EGG_WALLET,
            comment: `LAUNCH_${clean_ticker}`,
            amount: '1',
        });
    } catch (e) {
        console.error('[launch/pending]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/launch/upload-image — upload to Pinata, return IPFS URL
router.post('/upload-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image' });

        const PINATA_JWT = process.env.PINATA_JWT;
        if (!PINATA_JWT) return res.status(500).json({ error: 'PINATA_JWT not configured' });

        const fd = new FormData();
        fd.append('file', req.file.buffer, {
            filename: req.file.originalname || 'token.png',
            contentType: req.file.mimetype,
        });
        fd.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

        const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
            method: 'POST',
            headers: { Authorization: `Bearer ${PINATA_JWT}`, ...fd.getHeaders() },
            body: fd,
        });

        const json = await r.json();
        if (!json.IpfsHash) throw new Error(JSON.stringify(json));

        res.json({ url: `https://gateway.pinata.cloud/ipfs/${json.IpfsHash}` });
    } catch (e) {
        console.error('[launch/upload-image]', e.message);
        res.status(500).json({ error: e.message });
    }
});

export { router as launchRouter };
