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

const PORT = process.env.PORT || 3000;

async function start() {
    await db.init();
    graduationWatcher.start();  // watches chain for graduation events
    app.listen(PORT, () => console.log(`egg-launcher backend on :${PORT}`));
}

start().catch(console.error);
