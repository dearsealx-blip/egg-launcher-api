// Sends Telegram DMs to followers when events happen
export async function notifyFollowers(tg_ids, event) {
    const BOT = process.env.TELEGRAM_TOKEN;
    if (!BOT || !tg_ids?.length) return;

    const msgs = {
        graduation: t => `🎓 $${t.ticker} GRADUATED!\n\n500 TON raised. Now live on ${t.dex_choice === 'stonfi' ? 'STON.fi' : 'DeDust'}.\n\negg held the LP. forever.`,
        big_buy:    t => `🚀 $${t.ticker} big buy!\n\n${t.amount} TON just hit the curve. ${t.progress.toFixed(0)}% to graduation.`,
        close:      t => `⚡ $${t.ticker} is ${t.remaining.toFixed(0)} TON from graduating!`,
    };

    const text = msgs[event.type]?.(event.token) || `update on $${event.token?.ticker}`;

    for (const tg_id of tg_ids) {
        try {
            await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: tg_id, text, parse_mode: 'Markdown' }),
            });
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
}
