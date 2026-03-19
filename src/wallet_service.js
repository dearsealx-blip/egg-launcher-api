import { WalletContractV4, TonClient, internal, toNano, fromNano, Address, beginCell } from '@ton/ton';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client   = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });

// AES-256-GCM encryption — key must be 32 bytes hex in env
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

    // Plain TON transfer — contract's receive() handler accepts it as Buy
    const seqno = await d.getSeqno();
    await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
        internal({ to: Address.parse(curve_address), value: toNano(ton_amount.toString()), bounce: true })
    ]});
    return seqno;
}
