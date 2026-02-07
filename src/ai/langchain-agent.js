/**
 * Genesis — LangChain AI Agent
 *
 * Uses Google Gemini (free tier) via LangChain to analyze blockchain events
 * and produce meaningful, human-readable insights.
 *
 * Flow:
 *   Raw Event → LangChain Prompt → Gemini LLM → Structured Insight
 *
 * The agent converts raw numbers & addresses into:
 *   - Plain English explanation
 *   - Risk assessment
 *   - Actionable recommendation
 *   - Severity classification
 */

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");

class GenesisLangChainAgent {
  constructor(config = {}) {
    this.apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    this.enabled = !!this.apiKey;
    this.model = null;
    this.chain = null;
    this.analysisCount = 0;
    this.errorCount = 0;
    this._consecutiveErrors = 0;
    this._rateLimitLogged = false;

    if (this.enabled) {
      this._initChain();
      console.log("  🧠 [LangChain] AI agent initialized with Gemini");
    } else {
      console.log("  ⚠️  [LangChain] No GEMINI_API_KEY — AI analysis disabled");
      console.log("     Get a free key at: https://aistudio.google.com/apikey");
    }
  }

  _initChain() {
    // Initialize Gemini model via LangChain
    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: this.apiKey,
      temperature: 0.3, // Low temperature for consistent, factual analysis
      maxOutputTokens: 500,
    });

    // Build the analysis prompt template
    this.promptTemplate = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are Genesis AI — a blockchain security analyst that monitors smart contract events in real-time.

Your job: Take raw blockchain event data and produce a brief, clear analysis that a non-technical person can understand.

RULES:
- Be concise (2-3 sentences max for summary)
- Use dollar amounts, not raw token units
- Flag risk levels accurately: low, medium, high, critical
- Give ONE actionable recommendation
- If amount >= $100,000 it's a whale movement
- If amount >= $500,000 it's critical
- Emergency/pause events are always critical

Respond ONLY in this exact JSON format (no markdown, no code blocks):
{{"title":"short title with emoji","summary":"2-3 sentence plain English explanation","severity":"low|medium|high|critical","recommendation":"one actionable step","riskScore":0-100,"pattern":"pattern_name"}}`,
      ],
      [
        "human",
        `Analyze this blockchain event:

Event Type: {eventType}
Event Data: {eventData}

Provide your analysis as JSON:`,
      ],
    ]);

    // Create the chain: prompt → model → parse output
    this.chain = this.promptTemplate
      .pipe(this.model)
      .pipe(new StringOutputParser());
  }

  /**
   * Analyze a blockchain event using LangChain + Gemini
   * @param {object} event - Raw event from contract listener
   * @returns {Promise<object>} Structured insight
   */
  async analyze(event) {
    if (!this.enabled) {
      return null; // Caller should fall back to local formatter
    }

    // Auto-disable after too many consecutive failures (rate limits)
    // But auto-recover after 30 seconds cooldown
    if (this._consecutiveErrors >= 3) {
      const cooldownMs = 30_000; // 30 second cooldown
      const elapsed = Date.now() - (this._lastErrorTime || 0);
      if (elapsed < cooldownMs) {
        if (!this._rateLimitLogged) {
          console.log(`  ⚠️  [LangChain] Gemini rate limit hit — cooling down ${Math.ceil(cooldownMs / 1000)}s. Using local formatter.`);
          this._rateLimitLogged = true;
        }
        return null;
      }
      // Cooldown expired — retry
      this._consecutiveErrors = 0;
      this._rateLimitLogged = false;
      console.log(`  🧠 [LangChain] Cooldown expired — retrying Gemini AI...`);
    }

    try {
      const eventType = event.eventType || event.type || "Unknown";
      const eventData = this._formatEventData(event);

      // Run the LangChain chain
      const rawResponse = await this.chain.invoke({
        eventType,
        eventData,
      });

      // Parse the JSON response from Gemini
      const insight = this._parseResponse(rawResponse, event);
      this.analysisCount++;
      this._consecutiveErrors = 0; // Reset on success

      console.log(
        `  🧠 [LangChain] Analyzed: ${insight.title} (severity: ${insight.severity})`
      );

      return insight;
    } catch (err) {
      this.errorCount++;
      this._consecutiveErrors = (this._consecutiveErrors || 0) + 1;
      this._lastErrorTime = Date.now();
      if (this._consecutiveErrors <= 2) {
        const shortMsg = err.message.includes("429") ? "Gemini rate limit hit" : err.message.slice(0, 80);
        console.error(`  ⚠️  [LangChain] ${shortMsg} — falling back to local formatter`);
      }
      return null; // Fall back to local formatter
    }
  }

  /**
   * Format raw event data into a readable string for the LLM
   */
  _formatEventData(event) {
    const args = event.args || {};
    const parts = [];

    if (args.user) parts.push(`User: ${args.user}`);
    if (args.from) parts.push(`From: ${args.from}`);
    if (args.to) parts.push(`To: ${args.to}`);
    if (args.amount) parts.push(`Amount: $${Number(args.amount).toLocaleString()}`);
    if (args.newBalance) parts.push(`New Balance: $${Number(args.newBalance).toLocaleString()}`);
    if (args.remainingBalance) parts.push(`Remaining Balance: $${Number(args.remainingBalance).toLocaleString()}`);
    if (args.threshold) parts.push(`Threshold: $${Number(args.threshold).toLocaleString()}`);
    if (args.isDeposit !== undefined) parts.push(`Direction: ${args.isDeposit ? "Deposit" : "Withdrawal"}`);
    if (args.paused !== undefined) parts.push(`Vault Status: ${args.paused ? "PAUSED" : "ACTIVE"}`);
    if (args.triggeredBy || args.owner) parts.push(`Triggered by: ${args.triggeredBy || args.owner}`);
    if (args.severity) parts.push(`Alert Severity: ${args.severity}`);
    if (args.description) parts.push(`Description: ${args.description}`);

    if (event.blockNumber) parts.push(`Block: #${event.blockNumber}`);
    if (event.transactionHash) parts.push(`Tx: ${event.transactionHash}`);

    return parts.length > 0 ? parts.join("\n") : JSON.stringify(args);
  }

  /**
   * Parse LLM response into structured insight object
   */
  _parseResponse(rawResponse, originalEvent) {
    try {
      // Clean up potential markdown code blocks from response
      let cleaned = rawResponse.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }

      const parsed = JSON.parse(cleaned);

      return {
        title: parsed.title || `📋 ${originalEvent.eventType || "Event"}`,
        summary: parsed.summary || "Event detected on-chain.",
        details: parsed.details || "",
        severity: parsed.severity || "medium",
        recommendation: parsed.recommendation || "Monitor the situation.",
        riskScore: parsed.riskScore || 50,
        pattern: parsed.pattern || "unknown",
        aiPowered: true,
        model: "gemini-2.0-flash",
        engine: "langchain",
      };
    } catch (parseErr) {
      // If JSON parsing fails, extract what we can from raw text
      return {
        title: `📋 ${originalEvent.eventType || "Event"} Detected`,
        summary: rawResponse.slice(0, 200),
        details: "",
        severity: "medium",
        recommendation: "Review event details manually.",
        riskScore: 50,
        pattern: "unparsed",
        aiPowered: true,
        model: "gemini-2.0-flash",
        engine: "langchain",
      };
    }
  }

  /**
   * Get agent stats
   */
  getStats() {
    return {
      enabled: this.enabled,
      engine: "LangChain + Gemini",
      model: "gemini-2.0-flash",
      analysisCount: this.analysisCount,
      errorCount: this.errorCount,
      successRate:
        this.analysisCount > 0
          ? (
              ((this.analysisCount - this.errorCount) / this.analysisCount) *
              100
            ).toFixed(1) + "%"
          : "N/A",
    };
  }
}

module.exports = GenesisLangChainAgent;
