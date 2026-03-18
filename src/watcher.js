import { TonClient, Address } from '@ton/ton';
import { db } from './db.js';

const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey:   process.env.TONCENTER_API_KEY,
});

const GRAD_THRESHOLD = 500_000_000_000n; // 500 TON in nanotons

export const graduationWatcher = {
    interval: null,

    start() {
        this.interval = setInterval(() => this.tick(), 20_000);
        setTimeout(() => this.tick(), 5000);
        console.log('[watcher] started');
    },

    async tick() {
        try {
            const tokens = await db.listTokens({ limit: 100 });
            for (const token of tokens) {
                if (!token.curve_address || token.graduated) continue;
                await this.checkToken(token);
                await new Promise(r => setTimeout(r, 500));
            }
        } catch (e) {
            console.error('[watcher] tick error:', e.message);
        }
    },

    async checkToken(token) {
        try {
            const result = await client.runMethod(
                Address.parse(token.curve_address),
                'curve_state'
            );
            const s = result.stack;
            const virtual_ton        = s.readBigNumber();
            const virtual_tokens     = s.readBigNumber();
            const real_ton_collected = s.readBigNumber();
            const tokens_sold        = s.readBigNumber();
            const graduated          = s.readBoolean();
            const trade_count        = s.readBigNumber();
            const price_num          = s.readBigNumber();

            const real_ton = Number(real_ton_collected) / 1e9;
            const progress = Math.min(100, Math.round(Number(real_ton_collected) * 100 / Number(GRAD_THRESHOLD)));
            const price    = virtual_tokens > 0n ? Number(virtual_ton) / Number(virtual_tokens) : 0;

            await db.updateTokenState(token.curve_address, {
                real_ton,
                virtual_ton:    Number(virtual_ton) / 1e9,
                virtual_tokens: Number(virtual_tokens) / 1e9,
                tokens_sold:    Number(tokens_sold) / 1e9,
                trade_count:    Number(trade_count),
                progress,
                price,
                graduated,
            });

            if (graduated && !token.graduated) {
                console.log(`[watcher] 🎓 GRADUATION: $${token.ticker}`);
                await db.graduateToken(token.curve_address, null);
                if (process.env.TELEGRAM_TOKEN && token.creator_tg_id) {
                    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: token.creator_tg_id,
                            text: `🎓 $${token.ticker} graduated! 500 TON reached. LP pool being created.`,
                        }),
                    }).catch(() => {});
                }
            }
        } catch (e) {
            // Contract not readable — skip
        }
    },
};
