import express from 'express';
import { TonClient, WalletContractV4, internal, toNano, fromNano, Address, Cell, Builder, beginCell, contractAddress } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';

// Full BondingCurve_* set - curve+JM compiled together so initOf EggJettonWallet code hashes match
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
        // Nonce in content forces unique address
        const content = beginCell().storeUint(0,8).storeStringTail(JSON.stringify({
            name: token.name, symbol: token.ticker, description: token.description || '',
            image: token.image_url || '', decimals: '9', _v: nonce
        })).endCell();

        // BondingCurve_EggJettonMaster init: storeUint(0,1) + curve + content(ref) + owner
        // We use eggWallet as placeholder curve (doesn't matter for address uniqueness via content nonce)
        const jmI    = { code: JM_CODE, data: beginCell().storeUint(0,1).storeAddress(eggWallet).storeRef(content).storeAddress(eggWallet).endCell() };
        const jmAddr = contractAddress(0, jmI);

        const b1 = new Builder();
        b1.storeStringRefTail(token.name); b1.storeStringRefTail(token.ticker);
        const b2 = new Builder();
        b2.storeStringRefTail(token.description || ''); b2.storeStringRefTail(token.image_url || '');
        b2.storeAddress(creatorAddr); b2.storeStringRefTail(token.creator_username || '');
        b2.storeInt(BigInt(token.creator_tg_id || 0), 257);
        b1.storeRef(b2.endCell()); b1.storeAddress(jmAddr);
        const cI   = { code: CURVE_CODE, data: beginCell().storeUint(0,1).storeAddress(eggWallet).storeAddress(eggWallet).storeRef(b1.endCell()).endCell() };
        const cAddr = contractAddress(0, cI);

        const existing = await client.getContractState(cAddr);
        if (existing.state === 'active') return res.status(400).json({ error: 'Already active, try nonce+1' });

        let seqno = await d.getSeqno();
        await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
            internal({ to: jmAddr, value: toNano('0.15'), init: jmI, body: '', bounce: false }),
            internal({ to: cAddr,  value: toNano('0.25'), init: cI,  body: '', bounce: false }),
        ]});
        await new Promise(r => setTimeout(r, 22000));

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

