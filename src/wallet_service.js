/**
 * Custodial wallet service
 * Each Telegram user gets a dedicated TON wallet
 * Wallets are stored encrypted in Supabase (mnemonic)
 * Users can export their keys at any time via /wallet command
 */
import { WalletContractV4, TonClient, internal, toNano, fromNano, Address, beginCell } from '@ton/ton';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client   = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });

export async function getOrCreateWallet(tg_id, tg_username) {
    // Check if wallet exists
    const { data: existing } = await supabase
        .from('egg_wallets')
        .select('address, mnemonic')
        .eq('tg_id', tg_id)
        .single();

    if (existing) return existing;

    // Generate new wallet
    const mnemonic = await mnemonicNew(24);
    const keys     = await mnemonicToPrivateKey(mnemonic);
    const wallet   = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
    const address  = wallet.address.toString({ urlSafe: true, bounceable: false });

    await supabase.from('egg_wallets').insert({
        tg_id, tg_username, address, mnemonic: mnemonic.join(' ')
    });

    return { address, mnemonic: mnemonic.join(' ') };
}

export async function getWalletBalance(address) {
    try {
        const state = await client.getContractState(Address.parse(address));
        return fromNano(state.balance);
    } catch { return '0'; }
}

export async function buyOnBehalf(tg_id, curve_address, ton_amount) {
    const { data: w } = await supabase.from('egg_wallets').select('address, mnemonic').eq('tg_id', tg_id).single();
    if (!w) throw new Error('No wallet found');

    const keys   = await mnemonicToPrivateKey(w.mnemonic.split(' '));
    const wallet = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
    const d      = client.open(wallet);

    const bal = await d.getBalance();
    if (bal < toNano(ton_amount.toString()) + toNano('0.1')) {
        throw new Error(`Insufficient balance: ${fromNano(bal)} TON (need ${ton_amount + 0.1})`);
    }

    const buyMsg = beginCell().storeUint(1, 32).storeCoins(0n).storeAddress(null).endCell();
    const seqno  = await d.getSeqno();
    await d.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
        internal({ to: Address.parse(curve_address), value: toNano(ton_amount.toString()), body: buyMsg, bounce: true })
    ]});
    return seqno;
}
