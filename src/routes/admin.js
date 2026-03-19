/**
 * Admin routes — internal use only
 */
import express from 'express';
import { TonClient, WalletContractV4, internal, toNano, fromNano, Address, Cell, Builder, beginCell, contractAddress } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
export const adminRouter = express.Router();
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'egg-admin-2026';

function auth(req, res) {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) { res.status(401).json({ error: 'Unauthorized' }); return false; }
    return true;
}

// GET /api/admin/egg-wallet — check EGG_WALLET address + balance
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

// POST /api/admin/redeploy-token — fresh deploy with BondingCurve_* code pair
adminRouter.post('/redeploy-token', async (req, res) => {
    if (!auth(req, res)) return;
    const { ticker, nonce = 1 } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });

    const TOTAL = 1_000_000_000n * 1_000_000_000n;
    const CURVE_CODE = Cell.fromBoc(readFileSync(join(__dir, '../../../contracts/build/BondingCurve_BondingCurve.code.boc')))[0];
    const JM_CODE    = Cell.fromBoc(readFileSync(join(__dir, '../../../contracts/build/BondingCurve_EggJettonMaster.code.boc')))[0];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { data: token } = await supabase.from('egg_tokens').select('*').eq('ticker', ticker).single();
    if (!token) return res.status(404).json({ error: 'Token not found' });

    try {
        const client  = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });
        const keys    = await mnemonicToPrivateKey(process.env.EGG_MNEMONIC.split(' '));
        const wallet  = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
        const d       = client.open(wallet);
        const eggWallet = wallet.address;
        const eggWalletAddr = eggWallet.toString({ urlSafe: true, bounceable: false });

        const bal = await d.getBalance();
        if (bal < toNano('0.7')) return res.status(400).json({ error: `Low balance: ${fromNano(bal)} TON`, address: eggWalletAddr });

        const creatorAddr = Address.parse(token.creator_address);
        const content = beginCell().storeUint(0,8).storeStringTail(JSON.stringify({
            name: token.name, symbol: token.ticker, description: token.description || '',
            image: token.image_url || '', decimals: '9'
        })).endCell();

        // nonce in JM data forces unique address
        const jmData = beginCell().storeUint(nonce, 8).storeAddress(eggWallet).storeRef(content).storeAddress(eggWallet).endCell();
        const jmI = { code: JM_CODE, data: jmData };
        const jmAddr = contractAddress(0, jmI);

        const b1 = new Builder();
        b1.storeStringRefTail(token.name);
        b1.storeStringRefTail(token.ticker);
        const b2 = new Builder();
        b2.storeStringRefTail(token.description || '');
        b2.storeStringRefTail(token.image_url || '');
        b2.storeAddress(creatorAddr);
        b2.storeStringRefTail(token.creator_username || '');
        b2.storeInt(BigInt(token.creator_tg_id || 0), 257);
        b1.storeRef(b2.endCell());
        b1.storeAddress(jmAddr);

        const cI = { code: CURVE_CODE, data: beginCell().storeUint(0,1).storeAddress(eggWallet).storeAddress(eggWallet).storeRef(b1.endCell()).endCell() };
        const cAddr = contractAddress(0, cI);

        const existing = await client.getContractState(cAddr);
        if (existing.state === 'active') return res.status(400).json({ error: 'Already deployed at this nonce, try nonce+1', jmAddr: jmAddr.toString({urlSafe:true,bounceable:false}), cAddr: cAddr.toString({urlSafe:true,bounceable:false}) });

        // TX1: Deploy
        let seqno = await d.getSeqno();
        await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
            internal({ to: jmAddr, value: toNano('0.15'), init: jmI, body: '', bounce: false }),
            internal({ to: cAddr,  value: toNano('0.25'), init: cI,  body: '', bounce: false }),
        ]});
        await new Promise(r => setTimeout(r, 20000));

        // TX2: Mint (EGG_WALLET IS the owner, so this works)
        seqno = await d.getSeqno();
        const mintMsg = beginCell().storeUint(16,32).storeAddress(cAddr).storeCoins(TOTAL).endCell();
        await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
            internal({ to: jmAddr, value: toNano('0.2'), body: mintMsg, bounce: false }),
        ]});
        await new Promise(r => setTimeout(r, 15000));

        // Update DB
        await supabase.from('egg_tokens').update({
            curve_address:  cAddr.toString({urlSafe:true,bounceable:false}),
            jetton_address: jmAddr.toString({urlSafe:true,bounceable:false}),
            real_ton: 0, trade_count: 0, progress: 0, tokens_sold: 0,
        }).eq('ticker', ticker);

        res.json({ ok: true, ticker, jmAddr: jmAddr.toString({urlSafe:true,bounceable:false}), cAddr: cAddr.toString({urlSafe:true,bounceable:false}), eggWallet: eggWalletAddr });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
