// Watches TON chain for graduation events + syncs curve state
import { TonClient } from '@ton/ton';
import { db } from './db.js';
import { createDexPool } from './dex.js';
import { notifyFollowers } from './notify.js';

const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey:   process.env.TONCENTER_API_KEY,
});

export const graduationWatcher = {
    interval: null,

    start() {
        this.interval = setInterval(() => this.tick(), 15_000); // every 15s
        console.log('[watcher] graduation watcher started');
    },

    async tick() {
        try {
            const tokens = await db.listTokens({ limit: 100 });
            for (const token of tokens) {
                if (!token.curve_address) continue;
                await this.checkToken(token);
                await new Promise(r => setTimeout(r, 300)); // rate limit
            }
        } catch (e) {
            console.error('[watcher] tick error:', e.message);
        }
    },

    async checkToken(token) {
        try {
            // Read curve state from chain
            const result = await client.runMethod(
                Address.parse(token.curve_address),
                'curve_state'
            );

            const state = {
                virtual_ton:        result.stack.readNumber(),
                virtual_tokens:     result.stack.readNumber(),
                real_ton_collected: result.stack.readNumber(),
                tokens_sold:        result.stack.readNumber(),
                token_reserve:      result.stack.readNumber(),
                graduated:          result.stack.readBoolean(),
                trade_count:        result.stack.readNumber(),
                price:              result.stack.readNumber(),
                progress:           result.stack.readNumber(),
            };

            await db.updateTokenState(token.curve_address, state);

            // Graduation detected
            if (state.graduated && !token.graduated) {
                console.log(`[watcher] 🎓 GRADUATION: $${token.ticker}`);
                await this.handleGraduation(token);
            }

            // Notify followers on big buys (>5 TON)
            // (checked separately via TX history)

        } catch (e) {
            // Contract may not be deployed yet — skip silently
        }
    },

    async handleGraduation(token) {
        try {
            // Create DEX pool
            const lpAddress = await createDexPool(token);

            // Update DB
            await db.graduateToken(token.curve_address, lpAddress);

            // Notify all followers
            const followers = await db.getFollowers(token.ticker);
            await notifyFollowers(followers, {
                type: 'graduation',
                token,
                lpAddress,
            });

            console.log(`[watcher] ✅ $${token.ticker} graduated, LP: ${lpAddress}`);
        } catch (e) {
            console.error(`[watcher] graduation handler error for $${token.ticker}:`, e.message);
        }
    }
};
