/**
 * Payment Monitor — polls egg wallet for LAUNCH_TICKER payments
 * When detected: deploys token on-chain, marks pending launch as paid
 */
import { TonClient, Address, fromNano } from '@ton/ton';
import { createClient } from '@supabase/supabase-js';
import { deployToken } from './deployer.js';

const EGG_WALLET = 'UQCPMM8-ORuo7XVypJdcKQe5Cg_rLTjD09SyxKvyYSKoeRuc';
const LAUNCH_FEE  = 0.9; // accept >= 0.9 TON (allow slight dust)

const client   = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let lastLt = null; // last processed logical time

export async function startPaymentMonitor() {
    console.log('[monitor] Payment monitor started');
    setInterval(tick, 30_000);
    setTimeout(tick, 3000); // first tick soon after start
}

async function tick() {
    try {
        const txs = await client.getTransactions(Address.parse(EGG_WALLET), { limit: 20 });
        for (const tx of txs) {
            const lt = tx.lt;
            if (lastLt && BigInt(lt) <= BigInt(lastLt)) continue;

            // Check inbound message
            const inMsg = tx.inMessage;
            if (!inMsg || inMsg.info.type !== 'internal') continue;

            const value   = inMsg.info.value.coins;
            const tonAmt  = Number(fromNano(value));
            const comment = getComment(inMsg);

            if (!comment?.startsWith('LAUNCH_')) continue;
            if (tonAmt < LAUNCH_FEE) {
                console.log(`[monitor] Underpaid: ${tonAmt} TON for ${comment}`);
                continue;
            }

            const ticker = comment.replace('LAUNCH_', '').toUpperCase();
            console.log(`[monitor] 💰 Detected LAUNCH_${ticker} — ${tonAmt} TON`);

            await handleLaunch(ticker, inMsg.info.src?.toString({ urlSafe: true, bounceable: false }));
        }

        if (txs.length > 0) {
            lastLt = txs[0].lt;
        }
    } catch (e) {
        console.error('[monitor] tick error:', e.message);
    }
}

async function handleLaunch(ticker, senderAddress) {
    try {
        // Get pending launch from DB
        const { data: pending } = await supabase
            .from('egg_pending_launches')
            .select('*')
            .eq('ticker', ticker)
            .eq('paid', false)
            .single();

        if (!pending) {
            console.log(`[monitor] No pending launch for $${ticker}`);
            return;
        }

        // Mark as paid immediately to prevent double-deploy
        await supabase.from('egg_pending_launches').update({ paid: true }).eq('ticker', ticker);

        // Deploy on-chain
        const result = await deployToken({
            name:             pending.name,
            ticker:           pending.ticker,
            description:      pending.description || '',
            image_url:        pending.image_url,
            creator_address:  senderAddress,
            creator_tg_id:    pending.creator_tg_id,
            creator_username: pending.tg_username,
            dex_choice:       pending.dex_choice || 'dedust',
        });

        // Notify creator via Telegram if we have their tg_id
        if (pending.creator_tg_id && process.env.TELEGRAM_TOKEN) {
            const msg = `🐣 *$${ticker} is hatching!*\n\nYour token is live on Egg Launcher!\n\n` +
                `Jetton: \`${result.jetton_address}\`\n` +
                `Curve: \`${result.curve_address}\`\n\n` +
                `_Earn 0.2% on every trade forever._`;

            await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: pending.creator_tg_id, text: msg, parse_mode: 'Markdown' }),
            }).catch(() => {});
        }

        console.log(`[monitor] ✅ $${ticker} launched successfully`);
    } catch (e) {
        console.error(`[monitor] launch error for $${ticker}:`, e.message);
        // Unmark as paid so it can be retried
        await supabase.from('egg_pending_launches').update({ paid: false }).eq('ticker', ticker).catch(() => {});
    }
}

function getComment(msg) {
    try {
        if (msg.body?.bits?.length > 0) {
            const slice = msg.body.beginParse();
            const prefix = slice.loadUint(32);
            if (prefix === 0) return slice.loadStringTail().trim();
        }
    } catch {}
    return null;
}
