/**
 * On-chain token deployer — called by payment monitor when LAUNCH_TICKER detected
 * Mirrors deploy_token_v2.mjs logic but runs inside Node.js backend
 */
import { TonClient, WalletContractV4, internal, toNano, fromNano, Address, Cell, Builder, contractAddress } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir  = dirname(fileURLToPath(import.meta.url));
const CODES_PATH = join(__dir, './contracts_codes.js');

const EGG_WALLET_ADDR = 'UQCPMM8-ORuo7XVypJdcKQe5Cg_rLTjD09SyxKvyYSKoeRuc';
const TOTAL_SUPPLY    = 1_000_000_000n * 1_000_000_000n;
const CURVE_SHARE     = TOTAL_SUPPLY * 95n / 100n;
const EGG_SHARE       = TOTAL_SUPPLY - CURVE_SHARE;

let CODES = null;
function getCodes() {
    if (CODES) return CODES;
    const raw   = readFileSync(CODES_PATH, 'utf8');
    const match = raw.match(/CONTRACT_CODES\s*=\s*(\{[\s\S]*?\});/);
    CODES = JSON.parse(match[1]);
    return CODES;
}

function buildTokenMeta({ name, ticker, description, image_url, creator, tg_username, dex_choice }) {
    const b1 = new Builder();
    b1.storeStringRefTail(description);
    b1.storeStringRefTail(image_url);
    b1.storeAddress(creator);
    b1.storeStringRefTail(tg_username || '');
    b1.storeInt(BigInt(dex_choice), 257);
    const b0 = new Builder();
    b0.storeStringRefTail(name);
    b0.storeStringRefTail(ticker);
    b0.storeRef(b1.endCell());
    return b0.endCell();
}

function buildCurveData(eggWallet, metaCell, jmAddr) {
    const b3 = new Builder(); b3.storeInt(0n, 257);
    const b2 = new Builder();
    b2.storeCoins(0n); b2.storeCoins(CURVE_SHARE); b2.storeCoins(TOTAL_SUPPLY);
    b2.storeInt(20n, 257); b2.storeInt(20n, 257);
    b2.storeCoins(toNano('500')); b2.storeBit(false); b2.storeRef(b3.endCell());
    const b1 = new Builder();
    b1.storeRef(metaCell); b1.storeAddress(jmAddr); b1.storeAddress(eggWallet);
    b1.storeCoins(toNano('10')); b1.storeCoins(TOTAL_SUPPLY); b1.storeCoins(0n);
    b1.storeRef(b2.endCell());
    const b0 = new Builder();
    b0.storeAddress(eggWallet); b0.storeRef(b1.endCell());
    return b0.endCell();
}

function buildMintMsg(to, amount) {
    return new Builder().storeUint(16, 32).storeUint(0, 64).storeAddress(to).storeCoins(amount).endCell();
}

function buildChangeOwnerMsg(newOwner) {
    return new Builder().storeUint(0x7a0cfd1e, 32).storeUint(0, 64).storeUint(0, 64).storeAddress(newOwner).endCell();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function deployToken(params) {
    const { name, ticker, description, image_url, creator_address, creator_tg_id, creator_username, dex_choice } = params;

    console.log(`[deployer] 🥚 Deploying $${ticker}...`);

    const codes  = getCodes();
    const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    const keys      = await mnemonicToPrivateKey(process.env.EGG_MNEMONIC.split(' '));
    const wallet    = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
    const deployer  = client.open(wallet);
    const eggWallet = Address.parse(EGG_WALLET_ADDR);

    const bal = await deployer.getBalance();
    if (bal < toNano('0.8')) throw new Error('Deployer balance too low');

    const CURVE_CODE = Cell.fromBase64(codes['BondingCurve_BondingCurve']);
    const JM_CODE    = Cell.fromBase64(codes['EggJetton_EggJettonMaster']);

    const content = new Builder().storeUint(0, 8)
        .storeStringTail(JSON.stringify({ name, symbol: ticker, description, image: image_url, decimals: '9' }))
        .endCell();

    const creatorAddr = Address.parse(creator_address);
    const metaCell = buildTokenMeta({
        name, ticker, description, image_url,
        creator: creatorAddr, tg_username: creator_username || '',
        dex_choice: dex_choice === 'stonfi' ? 1 : 0,
    });

    // JettonMaster init (temp owner = eggWallet)
    const jmData = new Builder().storeCoins(0n).storeBit(true).storeAddress(eggWallet).storeRef(content).endCell();
    const jmInit = { code: JM_CODE, data: jmData };
    const jmAddr = contractAddress(0, jmInit);

    const curveData = buildCurveData(eggWallet, metaCell, jmAddr);
    const curveInit = { code: CURVE_CODE, data: curveData };
    const curveAddr = contractAddress(0, curveInit);

    console.log(`[deployer] JettonMaster: ${jmAddr.toString({ urlSafe: true, bounceable: false })}`);
    console.log(`[deployer] BondingCurve: ${curveAddr.toString({ urlSafe: true, bounceable: false })}`);

    let seqno = await deployer.getSeqno();
    await deployer.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
        internal({ to: jmAddr,    value: toNano('0.15'), init: jmInit,    body: '', bounce: false }),
        internal({ to: curveAddr, value: toNano('0.25'), init: curveInit, body: '', bounce: false }),
    ]});
    await sleep(18000);

    seqno = await deployer.getSeqno();
    await deployer.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
        internal({ to: jmAddr, value: toNano('0.08'), bounce: false, body: buildMintMsg(curveAddr, CURVE_SHARE) }),
        internal({ to: jmAddr, value: toNano('0.06'), bounce: false, body: buildMintMsg(eggWallet, EGG_SHARE)  }),
    ]});
    await sleep(12000);

    seqno = await deployer.getSeqno();
    await deployer.sendTransfer({ seqno, secretKey: keys.secretKey, messages: [
        internal({ to: jmAddr, value: toNano('0.04'), bounce: false, body: buildChangeOwnerMsg(curveAddr) }),
    ]});
    await sleep(8000);

    const curveStr = curveAddr.toString({ urlSafe: true, bounceable: false });
    const jmStr    = jmAddr.toString({ urlSafe: true, bounceable: false });

    await supabase.from('egg_tokens').insert({
        name, ticker, description, image_url,
        creator_address, creator_tg_id, creator_username,
        curve_address: curveStr, jetton_address: jmStr,
        dex_choice: dex_choice || 'dedust',
        real_ton: 0, graduated: false, progress: 0, price: 0,
    });

    console.log(`[deployer] ✅ $${ticker} live!`);
    return { curve_address: curveStr, jetton_address: jmStr };
}
