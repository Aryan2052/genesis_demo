/**
 * Genesis — Interactive Telegram Bot (Button-Driven)
 *
 * Users interact through INLINE KEYBOARD BUTTONS — not text commands.
 * The bot ASKS users what alerts they want:
 *
 *   /start → "Welcome! What alerts do you want?" → [Button Grid]
 *   User picks alert type → "Set your threshold" → [Button Grid]
 *   User picks threshold → ✅ "Subscribed! You'll only get these alerts."
 *
 * Flow:
 *   1. /start → Welcome + "Choose Alerts" button
 *   2. User taps "Choose Alerts" → shows alert type buttons
 *   3. User picks type → shows threshold buttons for that type
 *   4. User picks threshold → subscription confirmed
 *   5. User can add more, view alerts, remove, get reports — all via buttons
 *
 * Only sends alerts to users whose preferences MATCH the event.
 * No unnecessary noise — users control what they see.
 */

const EventEmitter = require("events");

// ─── Supported alert types (matches ThresholdEngine.sol AlertType enum) ───
const ALERT_TYPES = {
  large_transfer: { id: 0, name: "Large Transfer", emoji: "💰", description: "Deposits/withdrawals exceeding your threshold" },
  whale_movement: { id: 1, name: "Whale Movement", emoji: "🐋", description: "Whale wallets moving big amounts" },
  rapid_flow:     { id: 2, name: "Rapid Flow",     emoji: "⚡", description: "Rapid in/out flows (potential exploit)" },
  custom:         { id: 3, name: "Custom",          emoji: "🔧", description: "Any event exceeding your threshold" },
};

// Suggested thresholds for each alert type (in USD)
const THRESHOLD_PRESETS = {
  large_transfer: [10_000, 50_000, 100_000, 500_000],
  whale_movement: [100_000, 250_000, 500_000, 1_000_000],
  rapid_flow:     [10_000, 25_000, 50_000, 100_000],
  custom:         [5_000, 25_000, 50_000, 100_000],
};

// Only chain we support for this hackathon
const SUPPORTED_CHAINS = {
  localhost: { id: 31337, name: "Hardhat Localhost", rpc: "http://127.0.0.1:8545", emoji: "🔨" },
};

class TelegramBot extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.botToken = opts.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.defaultChatId = opts.defaultChatId || process.env.TELEGRAM_CHAT_ID;
    this.db = opts.db || null;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;

    // In-memory user store: Map<chatId, { chatId, username, alertPrefs: Map<prefId, Pref>, registeredAt }>
    this.users = new Map();
    this._prefIdCounter = 1;

    // Conversation state for multi-step flows (custom threshold input)
    // Map<chatId, { step, alertType, ... }>
    this._conversations = new Map();

    // External references (set after construction)
    this.listener = null;
    this.formatter = null;
    this.pipeline = null;
    this.eventLog = null;

    this._pollingTimer = null;
    this._lastUpdateId = 0;

    // Register default chat ID
    if (this.defaultChatId) {
      this._ensureUser(this.defaultChatId, "default_user");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════

  async startPolling(intervalMs = 2000) {
    if (!this.botToken) {
      console.log("  ⚠️  [TelegramBot] No bot token — bot disabled");
      return;
    }
    await this._loadFromDb();
    console.log("  🤖 [TelegramBot] Starting command polling...");
    this._pollingTimer = setInterval(() => this._poll(), intervalMs);
    await this._poll();
  }

  stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ALERT DISPATCH — Only send to matched users
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Dispatch an alert to ALL users whose preferences match.
   * @param {Object} alert  — { type, severity, amount, amountRaw, ... }
   * @param {string} telegramMessage — pre-formatted Telegram text
   * @returns {number} — count of users notified
   */
  async dispatchAlert(alert, telegramMessage) {
    if (!this.botToken) return 0;

    const eventType = this._mapEventType(alert.type);
    const rawAmount = this._extractRawAmount(alert);
    let sentCount = 0;

    for (const [chatId, user] of this.users) {
      const matchingPrefs = this._findMatchingPrefs(user, eventType, rawAmount);
      if (matchingPrefs.length > 0) {
        try {
          const matchInfo = matchingPrefs.map(p => {
            const typeDef = Object.values(ALERT_TYPES).find(t => t.id === p.alertType);
            return `${typeDef?.emoji || "📋"} Matched: ${typeDef?.name || "Custom"} (≥$${(p.threshold / 1e6).toLocaleString()})`;
          }).join("\n");
          const personalized = `${matchInfo}\n━━━━━━━━━━━━━━━━━━\n${telegramMessage}`;
          await this._send(chatId, personalized);
          sentCount++;
        } catch (err) { /* silent */ }
      }
    }

    // No fallback — only users who explicitly chose alerts will receive them.
    // If sentCount === 0, nobody subscribed to this type/threshold. That's correct behavior.

    return sentCount;
  }

  /** Send dashboard metrics report to a specific chat. */
  async sendReport(chatId) {
    const targetChat = chatId || this.defaultChatId;
    if (!targetChat) return;
    const report = this._buildReport();
    await this._send(targetChat, report, "HTML");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  POLLING — handles messages AND callback_query (button clicks)
  // ═══════════════════════════════════════════════════════════════════════

  async _poll() {
    try {
      const url = `${this.baseUrl}/getUpdates?offset=${this._lastUpdateId + 1}&timeout=0&allowed_updates=["message","callback_query"]`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok || !data.result) return;

      for (const update of data.result) {
        this._lastUpdateId = update.update_id;
        try {
          if (update.callback_query) {
            await this._handleCallback(update.callback_query);
          } else if (update.message?.text) {
            await this._handleMessage(update.message);
          }
        } catch (err) { /* never crash on command handling */ }
      }
    } catch (err) { /* network errors expected — no internet, etc. */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  MESSAGE HANDLER (text commands — fallback for power users)
  // ═══════════════════════════════════════════════════════════════════════

  async _handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    const username = msg.from?.username || msg.from?.first_name || `user_${chatId}`;

    const cmd = text.split(/\s+/)[0]?.toLowerCase();

    switch (cmd) {
      case "/start":
        return this._sendWelcome(chatId, username);
      case "/alerts":
      case "/choose":
        return this._sendAlertTypeMenu(chatId);
      case "/myalerts":
        return this._sendMyAlerts(chatId);
      case "/removealert":
        return this._sendRemoveMenu(chatId);
      case "/report":
        return this._sendReport(chatId);
      case "/status":
        return this._sendStatus(chatId);
      case "/help":
        return this._sendHelp(chatId);
      default:
        // Check if user is in a conversation (typing custom threshold)
        if (this._conversations.has(String(chatId))) {
          return this._handleConversationInput(chatId, text);
        }
        if (text.startsWith("/")) {
          await this._send(chatId, `❓ Unknown command. Tap a button below or type /help`);
        }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CALLBACK HANDLER (inline button clicks)
  // ═══════════════════════════════════════════════════════════════════════

  async _handleCallback(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id;
    const data = callbackQuery.data;
    const username = callbackQuery.from?.username || callbackQuery.from?.first_name || `user_${chatId}`;

    if (!chatId || !data) return;
    this._ensureUser(chatId, username);

    // Acknowledge the button press (removes loading spinner)
    await this._answerCallback(callbackQuery.id);

    // Route based on callback data prefix
    if (data === "choose_alerts") {
      return this._sendAlertTypeMenu(chatId);
    }
    if (data.startsWith("type:")) {
      const alertType = data.split(":")[1];
      return this._sendThresholdMenu(chatId, alertType);
    }
    if (data.startsWith("thresh:")) {
      const [, alertType, threshStr] = data.split(":");
      if (threshStr === "custom") {
        return this._askCustomThreshold(chatId, alertType);
      }
      const threshold = parseInt(threshStr);
      return this._createSubscription(chatId, alertType, threshold);
    }
    if (data === "add_more") {
      return this._sendAlertTypeMenu(chatId);
    }
    if (data === "view_alerts") {
      return this._sendMyAlerts(chatId);
    }
    if (data === "done") {
      return this._sendDone(chatId);
    }
    if (data.startsWith("remove:")) {
      const prefId = parseInt(data.split(":")[1]);
      return this._removeSubscription(chatId, prefId);
    }
    if (data === "remove_menu") {
      return this._sendRemoveMenu(chatId);
    }
    if (data === "get_report") {
      return this._sendReport(chatId);
    }
    if (data === "main_menu") {
      return this._sendMainMenu(chatId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  INTERACTIVE FLOWS (Button-driven UI)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * STEP 0: Welcome — "What alerts do you want?"
   * This is the FIRST thing users see. It ASKS them to choose.
   */
  async _sendWelcome(chatId, username) {
    this._ensureUser(chatId, username);

    const text = [
      `🧬 <b>Welcome to Genesis Alert Bot!</b>`,
      ``,
      `Hello <b>${username}</b>! I monitor on-chain events and send you alerts — but <b>only the ones YOU choose</b>.`,
      ``,
      `⛓️ Chain: <b>Hardhat Localhost</b> (#31337)`,
      ``,
      `<b>How it works:</b>`,
      `1️⃣ Choose which alert types you care about`,
      `2️⃣ Set your minimum threshold (in USD)`,
      `3️⃣ Only receive alerts that match YOUR rules`,
      ``,
      `🚫 No spam. No unnecessary alerts. <b>You're in control.</b>`,
      ``,
      `👇 <b>Tap the button to set up your alerts:</b>`,
    ].join("\n");

    await this._sendWithButtons(chatId, text, [
      [{ text: "🔔 Choose My Alerts", callback_data: "choose_alerts" }],
      [{ text: "📊 Get Dashboard Report", callback_data: "get_report" }],
      [{ text: "ℹ️ Help", callback_data: "main_menu" }],
    ]);
  }

  /**
   * STEP 1: "What do you want to monitor?" — Alert type buttons
   */
  async _sendAlertTypeMenu(chatId) {
    const text = [
      `🔔 <b>What do you want to monitor?</b>`,
      ``,
      `Pick an alert type:`,
      ``,
      ...Object.entries(ALERT_TYPES).map(([, t]) => `${t.emoji} <b>${t.name}</b> — ${t.description}`),
    ].join("\n");

    const buttons = Object.entries(ALERT_TYPES).map(([key, t]) => ([
      { text: `${t.emoji} ${t.name}`, callback_data: `type:${key}` },
    ]));

    buttons.push([
      { text: "📋 My Alerts", callback_data: "view_alerts" },
      { text: "✅ Done", callback_data: "done" },
    ]);

    await this._sendWithButtons(chatId, text, buttons);
  }

  /**
   * STEP 2: "Set your minimum threshold" — Preset + custom buttons
   */
  async _sendThresholdMenu(chatId, alertType) {
    const typeDef = ALERT_TYPES[alertType];
    if (!typeDef) return;

    const presets = THRESHOLD_PRESETS[alertType] || [10000, 50000, 100000, 500000];

    const text = [
      `${typeDef.emoji} <b>${typeDef.name}</b>`,
      ``,
      `💵 <b>Set your minimum threshold (USD):</b>`,
      ``,
      `You'll only get alerts when the amount <b>exceeds</b> your threshold.`,
      `Lower threshold = more alerts. Higher = only big events.`,
      ``,
      `👇 <b>Pick a threshold or enter a custom amount:</b>`,
    ].join("\n");

    const row1 = presets.slice(0, 2).map(t => ({
      text: `💵 $${t.toLocaleString()}`,
      callback_data: `thresh:${alertType}:${t}`,
    }));
    const row2 = presets.slice(2, 4).map(t => ({
      text: `💵 $${t.toLocaleString()}`,
      callback_data: `thresh:${alertType}:${t}`,
    }));

    await this._sendWithButtons(chatId, text, [
      row1,
      row2,
      [{ text: "✏️ Custom Amount", callback_data: `thresh:${alertType}:custom` }],
      [{ text: "⬅️ Back to Alert Types", callback_data: "choose_alerts" }],
    ]);
  }

  /**
   * STEP 2b: Custom threshold — ask user to type a number
   */
  async _askCustomThreshold(chatId, alertType) {
    const typeDef = ALERT_TYPES[alertType];

    this._conversations.set(String(chatId), {
      step: "awaiting_threshold",
      alertType,
    });

    await this._send(chatId, [
      `✏️ <b>Enter your custom threshold</b>`,
      ``,
      `${typeDef.emoji} Alert type: <b>${typeDef.name}</b>`,
      ``,
      `Type a dollar amount (just the number):`,
      ``,
      `<i>Example: 75000 for $75,000</i>`,
    ].join("\n"), "HTML");
  }

  /** Handle typed text during a conversation */
  async _handleConversationInput(chatId, text) {
    const conv = this._conversations.get(String(chatId));
    if (!conv) return;

    if (conv.step === "awaiting_threshold") {
      const threshold = parseInt(text.replace(/[$,\s]/g, ""));
      if (isNaN(threshold) || threshold <= 0) {
        await this._send(chatId, `❌ Please enter a valid positive number. Example: <code>75000</code>`, "HTML");
        return;
      }
      this._conversations.delete(String(chatId));
      return this._createSubscription(chatId, conv.alertType, threshold);
    }
  }

  /**
   * STEP 3: Create subscription and confirm — "You're subscribed!"
   */
  async _createSubscription(chatId, alertTypeName, thresholdUsd) {
    this._ensureUser(chatId);
    const typeDef = ALERT_TYPES[alertTypeName];
    if (!typeDef) return;

    const prefId = this._prefIdCounter++;
    const pref = {
      id: prefId,
      alertType: typeDef.id,
      alertTypeName,
      threshold: thresholdUsd * 1e6, // 6 decimals like contract
      chain: "localhost",
      chainId: 31337,
      createdAt: Date.now(),
    };

    const user = this.users.get(String(chatId));
    user.alertPrefs.set(prefId, pref);
    await this._saveToDb(chatId, pref);

    const text = [
      `✅ <b>Alert subscription created!</b>`,
      ``,
      `${typeDef.emoji} <b>Type:</b> ${typeDef.name}`,
      `💵 <b>Threshold:</b> ≥ $${thresholdUsd.toLocaleString()}`,
      `⛓️ <b>Chain:</b> Hardhat Localhost (#31337)`,
      `🆔 <b>ID:</b> #${prefId}`,
      ``,
      `I'll <b>only</b> send you alerts that match this rule. No spam! 🎯`,
      ``,
      `👇 <b>What's next?</b>`,
    ].join("\n");

    await this._sendWithButtons(chatId, text, [
      [{ text: "➕ Add Another Alert", callback_data: "add_more" }],
      [{ text: "📋 View My Alerts", callback_data: "view_alerts" }],
      [{ text: "✅ I'm Done", callback_data: "done" }],
    ]);

    this.emit("preference_set", { chatId, pref });
  }

  /** Show user's current subscriptions */
  async _sendMyAlerts(chatId) {
    const user = this.users.get(String(chatId));
    if (!user || user.alertPrefs.size === 0) {
      await this._sendWithButtons(chatId, [
        `📭 <b>No alert subscriptions yet!</b>`,
        ``,
        `You haven't chosen any alerts. Tap below to pick what you want:`,
      ].join("\n"), [
        [{ text: "🔔 Choose My Alerts", callback_data: "choose_alerts" }],
      ]);
      return;
    }

    const lines = [`📋 <b>Your Alert Subscriptions (${user.alertPrefs.size}):</b>`, ""];
    for (const [id, pref] of user.alertPrefs) {
      const typeDef = Object.values(ALERT_TYPES).find(t => t.id === pref.alertType);
      lines.push(
        `  #${id} ${typeDef?.emoji || "📋"} <b>${typeDef?.name || "Custom"}</b>`,
        `     💵 Threshold: ≥ $${(pref.threshold / 1e6).toLocaleString()}`,
        `     ⛓️ Chain: Hardhat Localhost`,
        ``
      );
    }
    lines.push(`✅ Only events matching these rules are sent to you.`);

    await this._sendWithButtons(chatId, lines.join("\n"), [
      [{ text: "➕ Add More Alerts", callback_data: "add_more" }],
      [{ text: "🗑️ Remove an Alert", callback_data: "remove_menu" }],
      [{ text: "📊 Dashboard Report", callback_data: "get_report" }],
    ]);
  }

  /** Show remove menu — each subscription as a button */
  async _sendRemoveMenu(chatId) {
    const user = this.users.get(String(chatId));
    if (!user || user.alertPrefs.size === 0) {
      await this._send(chatId, "📭 No subscriptions to remove.");
      return;
    }

    const buttons = [];
    for (const [id, pref] of user.alertPrefs) {
      const typeDef = Object.values(ALERT_TYPES).find(t => t.id === pref.alertType);
      buttons.push([{
        text: `🗑️ #${id} ${typeDef?.name || "Custom"} ≥ $${(pref.threshold / 1e6).toLocaleString()}`,
        callback_data: `remove:${id}`,
      }]);
    }
    buttons.push([{ text: "⬅️ Back", callback_data: "view_alerts" }]);

    await this._sendWithButtons(chatId, `🗑️ <b>Tap a subscription to remove it:</b>`, buttons);
  }

  /** Remove a subscription by ID */
  async _removeSubscription(chatId, prefId) {
    const user = this.users.get(String(chatId));
    if (!user || !user.alertPrefs.has(prefId)) {
      await this._send(chatId, `❌ Subscription #${prefId} not found.`);
      return;
    }

    user.alertPrefs.delete(prefId);
    await this._deleteFromDb(chatId, prefId);

    await this._sendWithButtons(chatId, `✅ Subscription #${prefId} removed. You won't get those alerts anymore.`, [
      [{ text: "📋 View Remaining", callback_data: "view_alerts" }],
      [{ text: "➕ Add New Alert", callback_data: "choose_alerts" }],
    ]);

    this.emit("preference_removed", { chatId, prefId });
  }

  /** Send dashboard report with refresh button */
  async _sendReport(chatId) {
    const report = this._buildReport();
    await this._sendWithButtons(chatId, report, [
      [{ text: "🔄 Refresh Report", callback_data: "get_report" }],
      [{ text: "🔔 My Alerts", callback_data: "view_alerts" }],
    ], "HTML");
  }

  /** Send system status */
  async _sendStatus(chatId) {
    const stats = this.listener?.stats || {};
    const uptime = stats.startedAt ? Math.floor((Date.now() - stats.startedAt) / 1000) : 0;
    const user = this.users.get(String(chatId));

    await this._sendWithButtons(chatId, [
      `🧬 <b>Genesis System Status</b>`,
      ``,
      `⛓️ Chain: <b>localhost</b> (ID: 31337)`,
      `⏱️ Uptime: ${uptime}s`,
      ``,
      `📊 Events: ${stats.eventsReceived || 0}`,
      `🚨 Large movements: ${stats.largeMovements || 0}`,
      ``,
      `👤 Your subscriptions: ${user?.alertPrefs.size || 0}`,
      `👥 Total users: ${this.users.size}`,
    ].join("\n"), [
      [{ text: "📊 Full Report", callback_data: "get_report" }],
      [{ text: "🔔 My Alerts", callback_data: "view_alerts" }],
    ]);
  }

  /** "You're all set!" confirmation */
  async _sendDone(chatId) {
    const user = this.users.get(String(chatId));
    const count = user?.alertPrefs.size || 0;

    await this._sendWithButtons(chatId, [
      `✅ <b>You're all set!</b>`,
      ``,
      `📋 Active subscriptions: <b>${count}</b>`,
      ``,
      count > 0
        ? `I'll send you alerts that match your rules — nothing else. 🎯`
        : `You haven't set any alerts yet. You can do it anytime!`,
      ``,
      `💡 Change your alerts anytime with the buttons below.`,
    ].join("\n"), [
      [{ text: "🔔 Change Alerts", callback_data: "choose_alerts" }],
      [{ text: "📋 My Alerts", callback_data: "view_alerts" }],
      [{ text: "📊 Dashboard Report", callback_data: "get_report" }],
    ]);
  }

  /** Main menu / help */
  async _sendMainMenu(chatId) {
    return this._sendHelp(chatId);
  }

  async _sendHelp(chatId) {
    await this._sendWithButtons(chatId, [
      `🧬 <b>Genesis Alert Bot — Help</b>`,
      ``,
      `<b>🔔 How it works:</b>`,
      `I ask you which events to monitor and at what threshold. You pick with <b>buttons</b> — no commands needed!`,
      ``,
      `<b>📋 Alert Types you can choose:</b>`,
      ...Object.entries(ALERT_TYPES).map(([, t]) => `  ${t.emoji} <b>${t.name}</b> — ${t.description}`),
      ``,
      `<b>⛓️ Supported Chain:</b>`,
      `  🔨 Hardhat Localhost (#31337)`,
      ``,
      `<b>💡 How thresholds work:</b>`,
      `  Set a minimum $ amount. Events BELOW your threshold are ignored.`,
      `  Example: $100K threshold → only alerts for amounts ≥ $100K`,
      ``,
      `<b>Text commands (optional):</b>`,
      `  /start — Setup wizard`,
      `  /alerts — Choose alerts`,
      `  /myalerts — View subscriptions`,
      `  /report — Dashboard metrics`,
      `  /status — System health`,
    ].join("\n"), [
      [{ text: "🔔 Choose My Alerts", callback_data: "choose_alerts" }],
      [{ text: "📋 My Alerts", callback_data: "view_alerts" }],
      [{ text: "📊 Dashboard Report", callback_data: "get_report" }],
    ]);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  REPORT BUILDER
  // ═══════════════════════════════════════════════════════════════════════

  _buildReport() {
    const stats = this.listener?.stats || {};
    const uptime = stats.startedAt ? Math.floor((Date.now() - stats.startedAt) / 1000) : 0;
    const eventCount = this.eventLog?.length || 0;
    const chain = process.env.CHAIN_NAME || "localhost";
    const chainId = process.env.CHAIN_ID || "31337";

    const typeCounts = {};
    (this.eventLog || []).forEach(e => {
      typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    });

    const thresholds = this.listener?.getActiveThresholds() || [];
    const alertTypeNames = ["Large Transfer", "Whale Movement", "Rapid Flow", "Custom"];
    const leaderboard = this.pipeline?.walletProfiler?.getRiskLeaderboard() || [];
    const topRisk = leaderboard.slice(0, 3);

    const lines = [
      `📊 <b>═══ GENESIS DASHBOARD REPORT ═══</b>`,
      ``,
      `⛓️ Chain: ${chain} (ID: ${chainId})`,
      `⏱️ Uptime: ${uptime}s`,
      `📅 ${new Date().toLocaleString()}`,
      ``,
      `━━━━ <b>📈 EVENTS</b> ━━━━`,
      `  Total: <b>${eventCount}</b>`,
      `  💰 Deposits: <b>${stats.depositsDetected || 0}</b>`,
      `  📤 Withdrawals: <b>${stats.withdrawalsDetected || 0}</b>`,
      `  🚨 Large: <b>${stats.largeMovements || 0}</b>`,
    ];

    if (Object.keys(typeCounts).length > 0) {
      lines.push(``, `━━━━ <b>📋 BREAKDOWN</b> ━━━━`);
      for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        const icons = { deposit: "💰", withdrawal: "📤", internal_transfer: "🔄", large_movement: "🚨", user_threshold_triggered: "🔔", erc20_transfer: "💸", swap: "🔁" };
        lines.push(`  ${icons[type] || "📋"} ${type}: <b>${count}</b>`);
      }
    }

    if (thresholds.length > 0) {
      lines.push(``, `━━━━ <b>🔔 THRESHOLDS</b> ━━━━`);
      thresholds.slice(0, 6).forEach((t) => {
        const typeName = alertTypeNames[t.alertType] || "Custom";
        const src = t.source === "global" ? "🌍" : "👤";
        lines.push(`  ${src} ${typeName}: ≥$${(t.threshold / 1e6).toLocaleString()}`);
      });
    }

    if (topRisk.length > 0) {
      lines.push(``, `━━━━ <b>🏆 TOP RISK</b> ━━━━`);
      topRisk.forEach((w, i) => {
        const medal = ["🥇", "🥈", "🥉"][i];
        lines.push(`  ${medal} ${w.wallet.slice(0, 8)}…${w.wallet.slice(-4)} — ${w.riskScore}/100`);
      });
    }

    lines.push(
      ``,
      `━━━━ <b>🤖 BOT</b> ━━━━`,
      `  Users: <b>${this.users.size}</b> | Subscriptions: <b>${this._totalPrefCount()}</b>`,
      ``,
      `🧠 <i>Powered by Genesis AI (LangChain + Gemini)</i>`,
    );

    return lines.join("\n");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  INTERNALS
  // ═══════════════════════════════════════════════════════════════════════

  _mapEventType(eventType) {
    switch (eventType) {
      case "deposit": case "withdrawal": case "large_movement":
        return 0;
      case "user_threshold_triggered":
        return 3;
      case "erc20_transfer": case "internal_transfer":
        return 0;
      default:
        return 3;
    }
  }

  _extractRawAmount(alert) {
    if (alert.amountRaw) return Number(alert.amountRaw);
    if (alert.amount) {
      const cleaned = String(alert.amount).replace(/,/g, "");
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed)) {
        if (cleaned.includes(".")) return parsed * 1e6;
        return parsed;
      }
    }
    return 0;
  }

  _findMatchingPrefs(user, eventTypeId, rawAmount) {
    const matches = [];
    for (const [, pref] of user.alertPrefs) {
      const typeMatch = pref.alertType === eventTypeId || pref.alertType === 3 || eventTypeId === 3;
      const thresholdMatch = rawAmount >= pref.threshold;
      const chainMatch = pref.chain === "localhost";
      if (typeMatch && thresholdMatch && chainMatch) {
        matches.push(pref);
      }
    }
    return matches;
  }

  _ensureUser(chatId, username) {
    const key = String(chatId);
    if (!this.users.has(key)) {
      this.users.set(key, {
        chatId: key,
        username: username || `user_${chatId}`,
        alertPrefs: new Map(),
        registeredAt: Date.now(),
      });
    } else if (username) {
      this.users.get(key).username = username;
    }
    return this.users.get(key);
  }

  _totalPrefCount() {
    let total = 0;
    for (const [, user] of this.users) total += user.alertPrefs.size;
    return total;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  TELEGRAM API — with inline keyboard support
  // ═══════════════════════════════════════════════════════════════════════

  async _send(chatId, text, parseMode = "HTML") {
    const url = `${this.baseUrl}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram API ${res.status}: ${body}`);
    }
  }

  /** Send message with inline keyboard buttons */
  async _sendWithButtons(chatId, text, buttons, parseMode = "HTML") {
    const url = `${this.baseUrl}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: buttons,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram API ${res.status}: ${body}`);
    }
  }

  /** Acknowledge callback query (removes loading spinner on button) */
  async _answerCallback(callbackQueryId) {
    try {
      await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    } catch (err) { /* silent */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SQLite PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════

  async _ensureTables() {
    if (!this.db?._isConnected) return;
    try {
      this.db.db.run(`
        CREATE TABLE IF NOT EXISTS telegram_users (
          chat_id TEXT PRIMARY KEY,
          username TEXT,
          registered_at INTEGER DEFAULT (strftime('%s','now'))
        )
      `);
      this.db.db.run(`
        CREATE TABLE IF NOT EXISTS telegram_preferences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          alert_type INTEGER NOT NULL,
          alert_type_name TEXT NOT NULL,
          threshold INTEGER NOT NULL,
          chain TEXT NOT NULL DEFAULT 'localhost',
          chain_id INTEGER NOT NULL DEFAULT 31337,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          FOREIGN KEY (chat_id) REFERENCES telegram_users(chat_id)
        )
      `);
      this.db.db.run(`CREATE INDEX IF NOT EXISTS idx_tg_prefs_chat ON telegram_preferences(chat_id)`);
      this.db.save();
    } catch (err) { /* non-fatal */ }
  }

  async _loadFromDb() {
    if (!this.db?._isConnected) return;
    try {
      await this._ensureTables();
      const userStmt = this.db.db.prepare("SELECT chat_id, username, registered_at FROM telegram_users");
      while (userStmt.step()) {
        const row = userStmt.getAsObject();
        this._ensureUser(row.chat_id, row.username);
      }
      userStmt.free();

      const prefStmt = this.db.db.prepare("SELECT id, chat_id, alert_type, alert_type_name, threshold, chain, chain_id, created_at FROM telegram_preferences");
      while (prefStmt.step()) {
        const row = prefStmt.getAsObject();
        const user = this._ensureUser(row.chat_id);
        const prefId = row.id;
        if (prefId >= this._prefIdCounter) this._prefIdCounter = prefId + 1;
        user.alertPrefs.set(prefId, {
          id: prefId,
          alertType: row.alert_type,
          alertTypeName: row.alert_type_name,
          threshold: row.threshold,
          chain: row.chain,
          chainId: row.chain_id,
          createdAt: row.created_at * 1000,
        });
      }
      prefStmt.free();

      const totalPrefs = this._totalPrefCount();
      if (this.users.size > 0 || totalPrefs > 0) {
        console.log(`  🤖 [TelegramBot] Loaded ${this.users.size} users, ${totalPrefs} alert subscriptions from DB`);
      }
    } catch (err) { /* non-fatal */ }
  }

  async _saveToDb(chatId, pref) {
    if (!this.db?._isConnected) return;
    try {
      const user = this.users.get(String(chatId));
      this.db.db.run("INSERT OR REPLACE INTO telegram_users (chat_id, username) VALUES (?, ?)", [String(chatId), user?.username || "unknown"]);
      this.db.db.run("INSERT INTO telegram_preferences (id, chat_id, alert_type, alert_type_name, threshold, chain, chain_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [pref.id, String(chatId), pref.alertType, pref.alertTypeName, pref.threshold, pref.chain, pref.chainId]);
      this.db.save();
    } catch (err) { /* non-fatal */ }
  }

  async _deleteFromDb(chatId, prefId) {
    if (!this.db?._isConnected) return;
    try {
      this.db.db.run("DELETE FROM telegram_preferences WHERE id = ? AND chat_id = ?", [prefId, String(chatId)]);
      this.db.save();
    } catch (err) { /* non-fatal */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PUBLIC API — for demo script
  // ═══════════════════════════════════════════════════════════════════════

  /** Programmatically add a preference (for demo to simulate user setup). */
  addPreference(chatId, alertTypeName, thresholdUsd) {
    this._ensureUser(chatId);
    const typeDef = ALERT_TYPES[alertTypeName];
    if (!typeDef) return null;

    const prefId = this._prefIdCounter++;
    const pref = {
      id: prefId,
      alertType: typeDef.id,
      alertTypeName,
      threshold: thresholdUsd * 1e6,
      chain: "localhost",
      chainId: 31337,
      createdAt: Date.now(),
    };
    this.users.get(String(chatId)).alertPrefs.set(prefId, pref);
    this._saveToDb(chatId, pref).catch(() => {});
    return pref;
  }

  /** Send welcome message with buttons to a chat (for demo to trigger the interactive flow). */
  async sendWelcomePrompt(chatId) {
    const targetChat = chatId || this.defaultChatId;
    if (!targetChat) return;
    const user = this.users.get(String(targetChat));
    await this._sendWelcome(targetChat, user?.username || "User");
  }

  /** Get summary for console/API display. */
  getSummary() {
    const userList = [];
    for (const [chatId, user] of this.users) {
      const prefs = [];
      for (const [, pref] of user.alertPrefs) {
        const typeDef = Object.values(ALERT_TYPES).find(t => t.id === pref.alertType);
        prefs.push({ id: pref.id, type: typeDef?.name || "Custom", threshold: pref.threshold, chain: pref.chain });
      }
      userList.push({ chatId, username: user.username, preferences: prefs });
    }
    return { totalUsers: this.users.size, totalPreferences: this._totalPrefCount(), users: userList };
  }
}

module.exports = TelegramBot;
module.exports.ALERT_TYPES = ALERT_TYPES;
module.exports.SUPPORTED_CHAINS = SUPPORTED_CHAINS;
