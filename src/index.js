import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { launchRouter } from './routes/launch.js';
import { tokenRouter } from './routes/tokens.js';
import { tradeRouter } from './routes/trade.js';
import { dashboardRouter } from './routes/dashboard.js';
import { graduationWatcher } from './watcher.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/launch', launchRouter);
app.use('/api/tokens', tokenRouter);
app.use('/api/trade', tradeRouter);
app.use('/api/dashboard', dashboardRouter);

app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/debug', async (_, res) => {
    const { createClient } = await import('@supabase/supabase-js');
    const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const r = await s.from('egg_tokens').select('id').limit(1);
    res.json({ url: process.env.SUPABASE_URL?.slice(0, 30), error: r.error?.message, count: r.data?.length });
});

const PORT = process.env.PORT || 3000;

async function start() {
    await db.init();
    graduationWatcher.start();  // watches chain for graduation events
    app.listen(PORT, () => console.log(`egg-launcher backend on :${PORT}`));
}

start().catch(console.error);
