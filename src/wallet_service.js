import { WalletContractV4, TonClient, internal, toNano, fromNano, Address, beginCell } from '@ton/ton';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client   = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });

// AES-256-GCM encryption â€” key must be 32 bytes hex in env
const ENC_KEY = Buffer.from(
    process.env.WALLET_ENCRYPTION_KEY || 'e99a18c428cb38d5f260853678922e0363b1b4a8c3dfc2ea2ede99a6001b6b37',
    'hex'
);

function encrypt(text) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(data) {
    // Support unencrypted legacy mnemonics (plain words, no colons)
    if (!data.includes(':') || data.split(' ').length > 5) return data;
    const [ivHex, tagHex, encHex] = data.split(':');
    const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8');
}

export async function getOrCreateWallet(tg_id, tg_username) {
    const { data: existing } = await supabase
        .from('egg_wallets').select('address, mnemonic').eq('tg_id', tg_id).single();
    if (existing) return { address: existing.address, mnemonic: existing.mnemonic };

    const mnemonic = await mnemonicNew(24);
    const keys     = await mnemonicToPrivateKey(mnemonic);
    const wallet   = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
    const address  = wallet.address.toString({ urlSafe: true, bounceable: false });
    const encrypted = encrypt(mnemonic.join(' '));

    await supabase.from('egg_wallets').insert({ tg_id, tg_username, address, mnemonic: encrypted });
    return { address, mnemonic: encrypted };
}

export async function getWalletBalance(address) {
    try {
        const state = await client.getContractState(Address.parse(address));
        return fromNano(state.balance);
    } catch { return '0'; }
}

export async function getMnemonic(tg_id) {
    const { data } = await supabase.from('egg_wallets').select('mnemonic').eq('tg_id', tg_id).single();
    if (!data) throw new Error('No wallet found');
    return decrypt(data.mnemonic);
}

export async function getJettonBalance(wallet_address, jetton_master) {
    try {
        const { Address, Cell, beginCell } = await import('@ton/ton');
        // Get jetton wallet address for this user
        const r = await client.runMethod(Address.parse(jetton_master), 'wallet_address', [
            { type: 'slice', cell: beginCell().storeAddress(Address.parse(wallet_address)).endCell() }
        ]);
        const jwAddr = r.stack.readAddress();
        const state = await client.getContractState(jwAddr);
        if (state.state !== 'active') return '0';
        const r2 = await client.runMethod(jwAddr, 'get_wallet_data');
        const balance = r2.stack.readBigNumber();
        return (Number(balance) / 1e9).toFixed(0);
    } catch { return '0'; }
}

export async function sellOnBehalf(tg_id, curve_address, jetton_master, token_amount) {
    const { data: w } = await supabase.from('egg_wallets').select('address, mnemonic').eq('tg_id', tg_id).single();
    if (!w) throw new Error('No wallet found');

    const plainMnemonic = decrypt(w.mnemonic);
    const keys   = await mnemonicToPrivateKey(plainMnemonic.split(' '));
    const wallet = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
    const d      = client.open(wallet);

    const bal = await d.getBalance();
    if (bal < toNano('0.12')) throw new Error(`Need at least 0.12 TON for gas. Balance: ${fromNano(bal)} TON`);

    // TEP-74 sell: send JettonTransfer from user's JW → curve's JW → JettonNotification → curve pays TON
    const tokenAmountBig = BigInt(Math.floor(token_amount));

    // Check user's jetton balance first
    const userJettonBal = await getJettonBalance(w.address, jetton_master);
    if (BigInt(userJettonBal) < tokenAmountBig) throw new Error(`Insufficient tokens: have ${userJettonBal}, need ${token_amount}`);

    // Get user's jetton wallet address
    const r = await client.runMethod(Address.parse(jetton_master), 'wallet_address', [
        { type: 'slice', cell: beginCell().storeAddress(Address.parse(w.address)).endCell() }
    ]);
    const userJW = r.stack.readAddress();

    // JettonTransfer: send tokens to curve_address (which triggers JettonNotification on curve)
    const transferMsg = beginCell()
        .storeUint(0xf8a7ea5, 32)   // JettonTransfer op
        .storeUint(0, 64)            // query_id
        .storeCoins(tokenAmountBig)  // amount
        .storeAddress(Address.parse(curve_address))  // destination = curve
        .storeAddress(Address.parse(w.address))      // response_destination = user (for excesses)
        .storeBit(0)                 // no custom payload
        .storeCoins(toNano('0.05')) // forward_ton_amount (for JettonNotification processing)
        .storeBit(0)                 // no forward_payload
        .endCell();

    const seqno = await d.getSeqno();
    await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
        internal({ to: userJW, value: toNano('0.1'), body: transferMsg, bounce: true })
    ]});
    return seqno;
}

export async function buyOnBehalf(tg_id, curve_address, ton_amount) {
    const { data: w } = await supabase.from('egg_wallets').select('address, mnemonic').eq('tg_id', tg_id).single();
    if (!w) throw new Error('No wallet found');

    const plainMnemonic = decrypt(w.mnemonic);
    const keys   = await mnemonicToPrivateKey(plainMnemonic.split(' '));
    const wallet = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
    const d      = client.open(wallet);

    const bal = await d.getBalance();
    if (bal < toNano(ton_amount.toString()) + toNano('0.07')) {
        throw new Error(`Insufficient balance: ${fromNano(bal)} TON (need ${(parseFloat(ton_amount) + 0.07).toFixed(2)})`);
    }

    // Plain TON transfer â€” contract's receive() handler accepts it as Buy
    const seqno = await d.getSeqno();
    await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
        internal({ to: Address.parse(curve_address), value: toNano(ton_amount.toString()), bounce: true })
    ]});
    return seqno;
}

