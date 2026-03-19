import { Telegraf, Markup } from 'telegraf';

// Unicode escapes to avoid encoding issues on Windows/Railway
const EGG   = '\u{1F95A}';  // 🥚
const ROCKET= '\u{1F680}';  // 🚀
const FIRE  = '\u{1F525}';  // 🔥
const GEM   = '\u{1F48E}';  // 💎
const WALLET= '\u{1F4B3}';  // 💳
const KEY   = '\u{1F511}';  // 🔑
const BAG   = '\u{1F4BC}';  // 💼
const CHART = '\u{1F4CA}';  // 📊
const COIN  = '\u{1FA99}';  // 🪙
const GRAD  = '\u{1F393}';  // 🎓
const WARN  = '\u26A0\uFE0F'; // ⚠️

export function startBot() {
    const BOT_TOKEN = process.env.TELEGRAM_TOKEN || '8661089019:AAE3V1LUEtVZDVMCov58dSP9lj4UxdcxG70';
    const APP = process.env.MINI_APP_URL || 'https://egg-launcher-miniapp.vercel.app';
    const API_URL = process.env.API_URL || 'https://egg-api-production.up.railway.app';

    const bot = new Telegraf(BOT_TOKEN);
    const openBtn = Markup.inlineKeyboard([[Markup.button.webApp(`${EGG} Open Egg Launcher`, APP)]]);

    bot.start(async (ctx) => {
        const user = ctx.from;
        try { await fetch(`${API_URL}/api/wallet/${user.id}?username=${user.username || ''}`); } catch {}
        await ctx.reply(
            `${EGG} *Egg Launcher*\n\nThe living launchpad on TON.\n\n` +
            `\u2022 Launch a token in 60 seconds\n` +
            `\u2022 Bonding curve \u2014 no rug possible\n` +
            `\u2022 0.2% creator fees on every trade\n` +
            `\u2022 Graduates to DeDust at 500 TON\n\n` +
            `_1 TON to launch. Earn forever._`,
            { parse_mode: 'Markdown', ...openBtn }
        );
    });

    bot.command('wallet', async (ctx) => {
        try {
            const r = await fetch(`${API_URL}/api/wallet/${ctx.from.id}?username=${ctx.from.username || ''}`);
            const d = await r.json();
            await ctx.reply(
                `${WALLET} *Your Egg Wallet*\n\n` +
                `Address:\n\`${d.address}\`\n\n` +
                `Balance: *${parseFloat(d.balance || 0).toFixed(4)} TON*\n\n` +
                `_Fund this address to buy tokens._\n_Type /seed to export your private keys._`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) { ctx.reply('Error: ' + e.message); }
    });

    bot.command('seed', async (ctx) => {
        try {
            const { createClient } = await import('@supabase/supabase-js');
            const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
            const { data } = await sb.from('egg_wallets').select('mnemonic').eq('tg_id', ctx.from.id).single();
            if (!data) return ctx.reply('No wallet found. Send /start first.');
            await ctx.reply(
                `${KEY} *Your Seed Phrase*\n\n\`${data.mnemonic}\`\n\n` +
                `${WARN} Keep this secret! Import into Tonkeeper or MyTonWallet.`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) { ctx.reply('Error: ' + e.message); }
    });

    bot.command('portfolio', async (ctx) => {
        try {
            const [wr, tr] = await Promise.all([
                fetch(`${API_URL}/api/wallet/${ctx.from.id}?username=${ctx.from.username || ''}`),
                fetch(`${API_URL}/api/tokens`),
            ]);
            const wallet = await wr.json();
            const tokens = await tr.json();
            const mine = (tokens || []).filter(t => t.creator_tg_id === ctx.from.id);
            let msg = `${BAG} *Your Portfolio*\n\nWallet: \`${wallet.address}\`\nBalance: *${parseFloat(wallet.balance || 0).toFixed(4)} TON*\n\n`;
            if (mine.length) {
                msg += `*Your Tokens:*\n`;
                mine.forEach(t => { msg += `\u2022 $${t.ticker} \u2014 ${(t.real_ton || 0).toFixed(2)} TON (${(t.progress || 0).toFixed(1)}%)\n`; });
            } else { msg += `_No tokens launched yet._`; }
            await ctx.reply(msg, { parse_mode: 'Markdown', ...openBtn });
        } catch { ctx.reply('Error loading portfolio.', openBtn); }
    });

    bot.command('dashboard', async (ctx) => {
        try {
            const r = await fetch(`${API_URL}/api/dashboard`);
            const d = await r.json();
            await ctx.reply(
                `${CHART} *Egg Launcher Stats*\n\n${COIN} Tokens: *${d.total}*\n${GRAD} Graduated: *${d.graduated}*\n${GEM} Treasury: *${d.treasury_ton?.toFixed(2)} TON*`,
                { parse_mode: 'Markdown', ...openBtn }
            );
        } catch { ctx.reply('Stats unavailable.', openBtn); }
    });

    bot.command('trending', ctx => ctx.reply(`See what's trending ${FIRE}`, openBtn));
    bot.command('launch',   ctx => ctx.reply(`Ready to launch? ${ROCKET}`, openBtn));

    bot.on('new_chat_members', async (ctx) => {
        const m = ctx.message.new_chat_members[0];
        if (m.id === ctx.botInfo.id) return;
        await ctx.reply(`${EGG} Welcome @${m.username || m.first_name}!\n\nLaunch your token on *Egg Launcher*`, { parse_mode: 'Markdown', ...openBtn }).catch(() => {});
    });

    bot.launch().catch(e => console.error('[bot] launch error:', e.message));
    console.log('[bot] Egg Launcher bot started');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
