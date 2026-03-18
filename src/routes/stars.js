/**
 * Telegram Stars payment handler
 * Flow: user pays Stars → bot holds Stars → bot buys TON on-chain on user's behalf
 * Stars → TON rate: configurable (default 200 Stars = 1 TON)
 */
import express from 'express';
import { TonClient, WalletContractV4, internal, toNano, Address, beginCell } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';

export const starsRouter = express.Router();

const STARS_PER_TON = parseInt(process.env.STARS_PER_TON || '200');
const BOT_TOKEN     = process.env.TELEGRAM_TOKEN;
const EGG_API       = 'https://api.telegram.org/bot' + BOT_TOKEN;

// Buy message payload (op=1, min_out=0, no referrer)
const BUY_PAYLOAD = 'te6cckEBAQEABwAACQAAAAECbvKFSw==';

// POST /api/stars/invoice — create a Stars invoice for buying tokens
starsRouter.post('/invoice', async (req, res) => {
    try {
        const { chat_id, ticker, curve_address, ton_amount } = req.body;
        if (!chat_id || !curve_address || !ton_amount) {
            return res.status(400).json({ error: 'chat_id, curve_address, ton_amount required' });
        }

        const stars = Math.ceil(ton_amount * STARS_PER_TON);
        const title = `Buy $${ticker}`;
        const description = `Buy ${ton_amount} TON worth of $${ticker} on Egg Launcher`;

        // Create Telegram invoice
        const r = await fetch(`${EGG_API}/createInvoiceLink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                description,
                payload: JSON.stringify({ ticker, curve_address, ton_amount, chat_id }),
                currency: 'XTR', // Telegram Stars
                prices: [{ label: `${ton_amount} TON of $${ticker}`, amount: stars }],
            }),
        });
        const data = await r.json();
        if (!data.ok) throw new Error(data.description);

        res.json({ ok: true, invoice_link: data.result, stars, ton_amount });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/stars/webhook — Telegram sends pre_checkout_query + successful_payment here
starsRouter.post('/webhook', async (req, res) => {
    const update = req.body;

    // Answer pre-checkout immediately (required within 10s)
    if (update.pre_checkout_query) {
        await fetch(`${EGG_API}/answerPreCheckoutQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pre_checkout_query_id: update.pre_checkout_query.id, ok: true }),
        });
        return res.json({ ok: true });
    }

    // Payment confirmed — execute on-chain buy
    if (update.message?.successful_payment) {
        const payment = update.message.successful_payment;
        const payload = JSON.parse(payment.invoice_payload);
        const { ticker, curve_address, ton_amount, chat_id } = payload;

        // Execute buy async (don't block webhook response)
        executeBuyOnChain(ticker, curve_address, ton_amount, chat_id).catch(console.error);
        return res.json({ ok: true });
    }

    res.json({ ok: true });
});

async function executeBuyOnChain(ticker, curve_address, ton_amount, chat_id) {
    try {
        console.log(`[stars] Buying ${ton_amount} TON of $${ticker} for chat ${chat_id}`);

        const client = new TonClient({
            endpoint: 'https://toncenter.com/api/v2/jsonRPC',
            apiKey: process.env.TONCENTER_API_KEY,
        });
        const keys    = await mnemonicToPrivateKey(process.env.EGG_MNEMONIC.split(' '));
        const wallet  = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
        const bot_wallet = client.open(wallet);

        const seqno = await bot_wallet.getSeqno();
        await bot_wallet.sendTransfer({
            seqno,
            secretKey: keys.secretKey,
            messages: [internal({
                to: Address.parse(curve_address),
                value: toNano(ton_amount.toString()),
                bounce: true,
                body: Buffer.from(BUY_PAYLOAD, 'base64'),
            })],
        });

        // Notify user
        await fetch(`${EGG_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id,
                text: `✅ Bought ${ton_amount} TON of $${ticker}!\n\nTokens will arrive in your wallet shortly.\n\n_Paid with Telegram Stars_`,
                parse_mode: 'Markdown',
            }),
        });

        console.log(`[stars] Buy executed for $${ticker}`);
    } catch (e) {
        console.error('[stars] on-chain buy failed:', e.message);
        await fetch(`${EGG_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id,
                text: `Sorry, your buy failed. Please try again or contact support. Error: ${e.message}`,
            }),
        }).catch(() => {});
    }
}

export { STARS_PER_TON };
