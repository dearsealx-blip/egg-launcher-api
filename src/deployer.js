/**
 * On-chain token deployer v4 — correct Tact init_args layouts
 * 
 * JettonMaster_init_args: storeUint(0,1) + curve(addr) + content(ref) + owner(addr)
 * BondingCurve_init_args: storeUint(0,1) + owner(addr) + egg_wallet(addr) + b1_ref(storeTokenMeta + jetton_master)
 * EggJettonWallet_init_args: owner(addr) + master(addr)  [no prefix]
 * 
 * storeTokenMeta: name(stringRef) + ticker(stringRef) + b1_ref(desc+img+creator+tg+dex)
 * 
 * Deployment flow:
 *   1. Compute JM addr (curve=eggWallet placeholder, owner=eggWallet)
 *   2. Compute Curve addr using real JM addr
 *   3. Deploy both in TX1
 *   4. Mint 1B tokens to Curve in TX2
 */
import { TonClient, WalletContractV4, internal, toNano, fromNano, Address, Cell, Builder, beginCell, contractAddress } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

const EGG_WALLET_ADDR = 'UQCPMM8-ORuo7XVypJdcKQe5Cg_rLTjD09SyxKvyYSKoeRuc';
const TOTAL_SUPPLY    = 1_000_000_000n * 1_000_000_000n;

let CODES = null;
function getCodes() {
    if (CODES) return CODES;
    const p = join(__dir, './contracts_codes.js');
    const raw = readFileSync(p, 'utf8');
    CODES = {};
    // Parse named exports: export const KEY = 'VALUE';
    for (const m of raw.matchAll(/export const (\w+) = '([^']+)'/g)) {
        CODES[m[1]] = m[2];
    }
    if (!CODES['BONDING_CURVE_CODE']) throw new Error('Could not load contract codes');
    return CODES;
}

// storeTokenMeta — exact Tact layout
function storeTokenMeta(b, { name, ticker, description, image_url, creator, tg_username, dex_choice }) {
    b.storeStringRefTail(name);
    b.storeStringRefTail(ticker);
    const b1 = new Builder();
    b1.storeStringRefTail(description);
    b1.storeStringRefTail(image_url);
    b1.storeAddress(creator);
    b1.storeStringRefTail(tg_username || '');
    b1.storeInt(BigInt(dex_choice), 257);
    b.storeRef(b1.endCell());
}

// JM init_args: storeUint(0,1) + curve + content(ref) + owner
function buildJMInit(curveOrOwner, content, owner, JM_CODE) {
    return {
        code: JM_CODE,
        data: beginCell()
            .storeUint(0, 1)
            .storeAddress(curveOrOwner)
            .storeRef(content)
            .storeAddress(owner)
            .endCell(),
    };
}

// Curve init_args: storeUint(0,1) + owner + egg_wallet + b1_ref(storeTokenMeta + jetton_master)
function buildCurveInit(eggWallet, meta, jmAddr, CURVE_CODE) {
    const b1 = new Builder();
    storeTokenMeta(b1, meta);
    b1.storeAddress(jmAddr);
    return {
        code: CURVE_CODE,
        data: beginCell()
            .storeUint(0, 1)
            .storeAddress(eggWallet)
            .storeAddress(eggWallet)
            .storeRef(b1.endCell())
            .endCell(),
    };
}

// MintTokens: op=16 + to(addr) + amount(coins)
function buildMintMsg(to, amount) {
    return beginCell().storeUint(16, 32).storeAddress(to).storeCoins(amount).endCell();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function deployToken(params) {
    const { name, ticker, description, image_url, creator_address, creator_tg_id, creator_username, dex_choice } = params;
    console.log(`[deployer] 🥚 Deploying $${ticker}...`);

    const codes     = getCodes();
    const CURVE_CODE = Cell.fromBase64(codes['BONDING_CURVE_CODE']);
    const JM_CODE    = Cell.fromBase64(codes['JETTON_MASTER_CODE']);

    const client   = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: process.env.TONCENTER_API_KEY });
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const keys     = await mnemonicToPrivateKey(process.env.EGG_MNEMONIC.split(' '));
    const wallet   = WalletContractV4.create({ publicKey: keys.publicKey, workchain: 0 });
    const deployer = client.open(wallet);
    const eggWallet = Address.parse(EGG_WALLET_ADDR);
    const creatorAddr = Address.parse(creator_address);

    const bal = await deployer.getBalance();
    if (bal < toNano('0.8')) throw new Error(`Deployer balance too low: ${fromNano(bal)} TON`);

    const content = beginCell()
        .storeUint(0, 8)
        .storeStringTail(JSON.stringify({ name, symbol: ticker, description, image: image_url, decimals: '9' }))
        .endCell();

    const meta = {
        name, ticker, description, image_url,
        creator:     creatorAddr,
        tg_username: creator_username || '',
        dex_choice:  dex_choice === 'stonfi' ? 1 : 0,
    };

    // Compute addresses
    const jmI    = buildJMInit(eggWallet, content, eggWallet, JM_CODE);
    const jmAddr = contractAddress(0, jmI);
    const cI     = buildCurveInit(eggWallet, meta, jmAddr, CURVE_CODE);
    const cAddr  = contractAddress(0, cI);

    console.log(`[deployer] JettonMaster: ${jmAddr.toString({ urlSafe: true, bounceable: false })}`);
    console.log(`[deployer] BondingCurve: ${cAddr.toString({ urlSafe: true, bounceable: false })}`);

    // TX1: Deploy both
    let seqno = await deployer.getSeqno();
    console.log(`[deployer] TX1: Deploy (seqno ${seqno})`);
    await deployer.sendTransfer({
        seqno, secretKey: keys.secretKey,
        messages: [
            internal({ to: jmAddr, value: toNano('0.15'), init: jmI,  body: '', bounce: false }),
            internal({ to: cAddr,  value: toNano('0.25'), init: cI,   body: '', bounce: false }),
        ],
    });
    await sleep(18000);

    const jmState = await client.getContractState(jmAddr);
    const cState  = await client.getContractState(cAddr);
    if (jmState.state !== 'active' || cState.state !== 'active') {
        throw new Error(`Deploy failed: JM=${jmState.state} Curve=${cState.state}`);
    }

    // TX2: Mint 1B tokens to Curve
    seqno = await deployer.getSeqno();
    console.log(`[deployer] TX2: Mint (seqno ${seqno})`);
    await deployer.sendTransfer({
        seqno, secretKey: keys.secretKey,
        messages: [internal({ to: jmAddr, value: toNano('0.2'), body: buildMintMsg(cAddr, TOTAL_SUPPLY), bounce: false })],
    });
    await sleep(15000);

    const curveStr = cAddr.toString({ urlSafe: true, bounceable: false });
    const jmStr    = jmAddr.toString({ urlSafe: true, bounceable: false });

    const { error } = await supabase.from('egg_tokens').insert({
        name, ticker, description, image_url,
        creator_address, creator_tg_id, creator_username,
        curve_address: curveStr, jetton_address: jmStr,
        dex_choice: dex_choice || 'dedust',
        real_ton: 0, graduated: false, progress: 0, price: 0,
    });
    if (error) throw new Error(`DB insert failed: ${error.message}`);

    console.log(`[deployer] ✅ $${ticker} live! curve=${curveStr}`);
    return { curve_address: curveStr, jetton_address: jmStr };
}
