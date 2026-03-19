/**
 * Admin routes - internal use only
 */
import express from 'express';
import { TonClient, WalletContractV4, internal, toNano, fromNano, Address, Cell, Builder, beginCell, contractAddress } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';

const CURVE_CODE = Cell.fromBoc(Buffer.from('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', 'base64'))[0];
const JM_CODE    = Cell.fromBoc(Buffer.from('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', 'base64'))[0];

export const adminRouter = express.Router();
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'egg-admin-2026';
function auth(req, res) {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) { res.status(401).json({ error: 'Unauthorized' }); return false; }
    return true;
}

adminRouter.get('/egg-wallet', async (req, res) => {
    if (!auth(req, res)) return;
    try {
        const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });
        const keys   = await mnemonicToPrivateKey(process.env.EGG_MNEMONIC.split(' '));
        const wallet = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
        const bal    = await client.open(wallet).getBalance();
        res.json({ address: wallet.address.toString({ urlSafe: true, bounceable: false }), balance: fromNano(bal) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

adminRouter.post('/redeploy-token', async (req, res) => {
    if (!auth(req, res)) return;
    const { ticker, nonce = 1 } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const TOTAL = 1_000_000_000n * 1_000_000_000n;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { data: token } = await supabase.from('egg_tokens').select('*').eq('ticker', ticker).single();
    if (!token) return res.status(404).json({ error: 'Token not found' });
    try {
        const client  = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });
        const keys    = await mnemonicToPrivateKey(process.env.EGG_MNEMONIC.split(' '));
        const wallet  = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
        const d       = client.open(wallet);
        const eggWallet = wallet.address;
        const bal = await d.getBalance();
        if (bal < toNano('0.7')) return res.status(400).json({ error: 'Low balance: ' + fromNano(bal) + ' TON' });
        const creatorAddr = Address.parse(token.creator_address);

        // Nonce in content JSON forces unique JM address without breaking storage layout
        const content = beginCell().storeUint(0, 8).storeStringTail(JSON.stringify({
            name: token.name, symbol: token.ticker, description: token.description || '',
            image: token.image_url || '', decimals: '9', _v: nonce
        })).endCell();

        // Curve meta builder (same as deployer)
        const b1 = new Builder();
        b1.storeStringRefTail(token.name); b1.storeStringRefTail(token.ticker);
        const b2 = new Builder();
        b2.storeStringRefTail(token.description || ''); b2.storeStringRefTail(token.image_url || '');
        b2.storeAddress(creatorAddr); b2.storeStringRefTail(token.creator_username || '');
        b2.storeInt(BigInt(token.creator_tg_id || 0), 257);
        b1.storeRef(b2.endCell());

        // We need JM addr to build curve meta, but JM addr depends on curve addr (circular).
        // Use dummy pass: compute JM with placeholder, get curve addr, then real JM.
        const placeholderJmData = beginCell().storeUint(0,1).storeAddress(eggWallet).storeRef(content).storeAddress(eggWallet).endCell();
        const placeholderJmAddr = contractAddress(0, { code: JM_CODE, data: placeholderJmData });

        b1.storeAddress(placeholderJmAddr);
        const cI = { code: CURVE_CODE, data: beginCell().storeUint(0,1).storeAddress(eggWallet).storeAddress(eggWallet).storeRef(b1.endCell()).endCell() };
        const cAddr = contractAddress(0, cI);

        // Correct JM init: storeUint(0,1) + curve_addr + content_ref + owner_addr
        const jmData = beginCell().storeUint(0,1).storeAddress(cAddr).storeRef(content).storeAddress(eggWallet).endCell();
        const jmI = { code: JM_CODE, data: jmData };
        const jmAddr = contractAddress(0, jmI);

        const existing = await client.getContractState(cAddr);
        if (existing.state === 'active') return res.status(400).json({ error: 'Already active, try nonce+1', cAddr: cAddr.toString({urlSafe:true,bounceable:false}) });

        // TX1: Deploy JM + Curve
        let seqno = await d.getSeqno();
        await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
            internal({ to: jmAddr, value: toNano('0.15'), init: jmI, body: '', bounce: false }),
            internal({ to: cAddr,  value: toNano('0.25'), init: cI,  body: '', bounce: false }),
        ]});
        await new Promise(r => setTimeout(r, 20000));

        // TX2: Mint 1B tokens to curve
        seqno = await d.getSeqno();
        const mintMsg = beginCell().storeUint(16,32).storeAddress(cAddr).storeCoins(TOTAL).endCell();
        await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
            internal({ to: jmAddr, value: toNano('0.2'), body: mintMsg, bounce: false }),
        ]});
        await new Promise(r => setTimeout(r, 15000));

        await supabase.from('egg_tokens').update({
            curve_address:  cAddr.toString({urlSafe:true,bounceable:false}),
            jetton_address: jmAddr.toString({urlSafe:true,bounceable:false}),
            real_ton: 0, trade_count: 0, progress: 0, tokens_sold: 0,
        }).eq('ticker', ticker);

        res.json({ ok: true, ticker, jmAddr: jmAddr.toString({urlSafe:true,bounceable:false}), cAddr: cAddr.toString({urlSafe:true,bounceable:false}) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
