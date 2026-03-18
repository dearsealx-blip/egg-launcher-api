import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { db } from '../db.js';

export const launchRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/launch/upload — upload image to IPFS
launchRouter.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'no file' });

        const form = new FormData();
        form.append('file', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });

        const r = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', form, {
            headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.PINATA_JWT}` },
            maxBodyLength: Infinity,
        });

        const image_url = `https://gateway.pinata.cloud/ipfs/${r.data.IpfsHash}`;
        res.json({ image_url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/launch/reserve — reserve ticker + save pending launch
launchRouter.post('/reserve', async (req, res) => {
    try {
        const { name, ticker, description, image_url, dex_choice, tg_id, tg_username } = req.body;

        if (!name || !ticker || !image_url) {
            return res.status(400).json({ error: 'missing fields' });
        }

        const clean = ticker.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

        // Username claim check
        if (tg_username) {
            await db.claimUsername(tg_username, clean);
        }

        // Save pending launch
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        const { error } = await supabase.from('egg_pending_launches').upsert({
            ticker: clean, name, description, image_url,
            creator_tg_id: tg_id, tg_username, dex_choice: dex_choice || 'dedust', paid: false,
        });
        if (error) throw error;

        res.json({ ok: true, ticker: clean, payment_address: 'UQCPMM8-ORuo7XVypJdcKQe5Cg_rLTjD09SyxKvyYSKoeRuc', comment: `LAUNCH_${clean}` });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});
