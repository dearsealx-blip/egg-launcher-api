/**
 * Admin routes — internal use only
 * Fund curve jetton wallets from EGG_WALLET holdings
 */
import express from 'express';
import { TonClient, WalletContractV4, internal, toNano, Address, beginCell } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';

export const adminRouter = express.Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'egg-admin-2026';

adminRouter.post('/fund-curve', async (req, res) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const { ticker } = req.body;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { data: token } = await supabase.from('egg_tokens').select('*').eq('ticker', ticker).single();
    if (!token) return res.status(404).json({ error: 'Token not found' });

    try {
        const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });
        const keys   = await mnemonicToPrivateKey(process.env.EGG_MNEMONIC.split(' '));
        const wallet = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
        const d      = client.open(wallet);
        const EGG_WALLET = wallet.address;

        // Get EGG_WALLET's jetton wallet for this token
        const JM = Address.parse(token.jetton_address);
        const CURVE = Address.parse(token.curve_address);

        const r1 = await client.runMethod(JM, 'wallet_address', [
            { type: 'slice', cell: beginCell().storeAddress(EGG_WALLET).endCell() }
        ]);
        const eggJW = r1.stack.readAddress();

        const r2 = await client.runMethod(JM, 'wallet_address', [
            { type: 'slice', cell: beginCell().storeAddress(CURVE).endCell() }
        ]);
        const curveJW = r2.stack.readAddress();

        // Check EGG_WALLET's token balance
        const jwState = await client.runMethod(eggJW, 'get_wallet_data');
        const balance = jwState.stack.readBigNumber();
        console.log(`[admin] ${ticker}: EGG_WALLET has ${(Number(balance)/1e9).toFixed(0)} tokens, sending to curve JW`);

        // Transfer all tokens from EGG_WALLET JW to curve JW
        const transferMsg = beginCell()
            .storeUint(0xf8a7ea5, 32)  // JettonTransfer op
            .storeUint(0, 64)           // query_id
            .storeCoins(balance)        // amount
            .storeAddress(CURVE)        // destination
            .storeAddress(EGG_WALLET)   // response_destination
            .storeBit(0)                // no custom payload
            .storeCoins(1n)             // forward_ton_amount (minimal)
            .storeBit(0)                // no forward_payload
            .endCell();

        const seqno = await d.getSeqno();
        await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
            internal({ to: eggJW, value: toNano('0.1'), body: transferMsg, bounce: true })
        ]});

        res.json({ ok: true, msg: `Sent ${(Number(balance)/1e9).toFixed(0)} ${ticker} tokens to curve`, curveJW: curveJW.toString({ urlSafe: true, bounceable: false }) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
