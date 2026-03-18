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

app.get('/', (_, res) => res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>🥚 Egg Launcher API</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#f5c542;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:2rem;border:1px solid #f5c542;border-radius:12px}h1{font-size:2rem;margin:0 0 .5rem}p{color:#aaa;margin:.25rem 0}a{color:#f5c542}</style></head>
<body><div class="box"><h1>🥚 egg launcher</h1><p>API is live</p><br>
<p><a href="/health">/health</a></p>
<p><a href="/api/tokens">/api/tokens</a></p>
<p><a href="/api/dashboard">/api/dashboard</a></p>
</div></body></html>`));

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
