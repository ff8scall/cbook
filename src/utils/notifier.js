import axios from 'axios';

/**
 * 텔레그램 알림 발송 유틸리티
 * @param {string} message 발송할 메시지
 */
export async function sendTelegramAlert(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('[NOTIFIER] Telegram Bot Token or Chat ID is missing. Logging to console instead.');
    console.error(`[ALERT] ${message}`);
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: `🚨 [Cbook Alert] 🚨\n\n${message}`,
      parse_mode: 'HTML'
    });
    console.log('[NOTIFIER] Telegram alert sent successfully.');
  } catch (error) {
    console.error('[NOTIFIER] Failed to send Telegram alert:', error.message);
  }
}
