/**
 * Genesis — CyreneAI Integration
 * 
 * Intelligence layer that analyzes blockchain events and provides:
 * - Risk scoring
 * - Pattern detection
 * - Contextual summaries
 * - False positive reduction
 */

class CyreneAgent {
  constructor(config = {}) {
    this.apiEndpoint = config.endpoint || process.env.CYRENE_AGENT_ENDPOINT;
    this.apiKey = config.apiKey || process.env.CYRENE_API_KEY;
    this.enabled = !!(this.apiEndpoint && this.apiKey);

    if (!this.enabled) {
      console.log('⚠️  [CyreneAI] Not configured - AI analysis disabled');
      console.log('   Set CYRENE_AGENT_ENDPOINT and CYRENE_API_KEY to enable');
    } else {
      console.log('✅ [CyreneAI] Intelligence layer enabled');
    }
  }

  /**
   * Analyze a blockchain event with AI
   * @param {object} event - Genesis event object
   * @param {object} ruleContext - Rule that triggered this event
   * @returns {Promise<object>} AI analysis result
   */
  async analyzeEvent(event, ruleContext) {
    if (!this.enabled) {
      return this.getFallbackAnalysis(event);
    }

    try {
      const payload = {
        task: 'analyze_blockchain_event',
        payload: {
          // Event data
          eventType: event.eventType,
          contractAddress: event.contractAddress,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          args: event.args,
          
          // Context
          chain: event.chain,
          ruleName: ruleContext?.name,
          severity: ruleContext?.severity,
          
          // Metadata for pattern detection
          timestamp: event.blockTimestamp,
          finality: event.finality,
        },
      };

      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeout: 5000, // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`CyreneAI API error: ${response.status}`);
      }

      const analysis = await response.json();
      return this.formatAnalysis(analysis);

    } catch (err) {
      console.error(`  ⚠️  [CyreneAI] Analysis failed: ${err.message}`);
      return this.getFallbackAnalysis(event);
    }
  }

  /**
   * Analyze multiple events for pattern detection
   * @param {Array<object>} events - Array of Genesis events
   * @returns {Promise<object>} Pattern analysis
   */
  async analyzePattern(events) {
    if (!this.enabled || events.length === 0) {
      return { hasPattern: false };
    }

    try {
      const payload = {
        task: 'detect_pattern',
        payload: {
          events: events.map(e => ({
            eventType: e.eventType,
            contractAddress: e.contractAddress,
            blockNumber: e.blockNumber,
            timestamp: e.blockTimestamp,
            args: e.args,
          })),
        },
      };

      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeout: 10000,
      });

      if (!response.ok) {
        throw new Error(`CyreneAI API error: ${response.status}`);
      }

      return await response.json();

    } catch (err) {
      console.error(`  ⚠️  [CyreneAI] Pattern analysis failed: ${err.message}`);
      return { hasPattern: false };
    }
  }

  /**
   * Format AI analysis into standard structure
   */
  formatAnalysis(rawAnalysis) {
    return {
      // AI-generated summary
      summary: rawAnalysis.summary || 'Event detected',
      
      // Risk assessment
      riskLevel: rawAnalysis.risk || 'medium', // low, medium, high, critical
      confidence: rawAnalysis.confidence || 'medium', // low, medium, high
      confidenceScore: rawAnalysis.confidence_score || 0.5, // 0-1
      
      // Pattern detection
      pattern: rawAnalysis.pattern || 'unknown',
      isAnomalous: rawAnalysis.is_anomalous || false,
      
      // Contextual information
      similarEvents: rawAnalysis.similar_events || 0,
      historicalBehavior: rawAnalysis.historical_behavior || 'unknown',
      
      // Recommendations
      recommendation: rawAnalysis.recommendation || 'Monitor',
      suggestedActions: rawAnalysis.suggested_actions || [],
      
      // Raw response for debugging
      raw: rawAnalysis,
    };
  }

  /**
   * Fallback analysis when CyreneAI is unavailable
   */
  getFallbackAnalysis(event) {
    return {
      summary: `${event.eventType} detected on ${event.contractAddress}`,
      riskLevel: 'medium',
      confidence: 'low',
      confidenceScore: 0.3,
      pattern: 'unknown',
      isAnomalous: false,
      similarEvents: 0,
      historicalBehavior: 'unknown',
      recommendation: 'Manual review recommended',
      suggestedActions: ['Review transaction details', 'Check contract history'],
      fallback: true,
    };
  }

  /**
   * Classify alert severity based on AI analysis
   */
  classifySeverity(analysis, originalSeverity) {
    // AI can upgrade or downgrade severity based on risk assessment
    const riskToSeverity = {
      critical: 'critical',
      high: 'high',
      medium: 'medium',
      low: 'low',
    };

    const aiSeverity = riskToSeverity[analysis.riskLevel];
    
    // If confidence is high, trust AI classification
    if (analysis.confidenceScore > 0.8) {
      return aiSeverity;
    }

    // Otherwise, keep original or take the higher severity
    const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
    const original = severityLevels[originalSeverity] || 2;
    const ai = severityLevels[aiSeverity] || 2;
    
    return ai > original ? aiSeverity : originalSeverity;
  }

  /**
   * Check if alert should be sent based on AI analysis
   * (False positive reduction)
   */
  shouldAlert(analysis) {
    // Don't alert for low-risk events with high confidence
    if (analysis.riskLevel === 'low' && analysis.confidenceScore > 0.8) {
      return false;
    }

    // Always alert for critical/high risk
    if (['critical', 'high'].includes(analysis.riskLevel)) {
      return true;
    }

    // For medium risk, only alert if it's anomalous
    if (analysis.riskLevel === 'medium') {
      return analysis.isAnomalous || analysis.confidenceScore > 0.7;
    }

    return true; // Default: send alert
  }

  /**
   * Generate enhanced alert message with AI insights
   */
  enhanceAlertMessage(originalMessage, analysis) {
    if (analysis.fallback) {
      return originalMessage; // No enhancement available
    }

    const riskEmoji = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };

    const confidenceEmoji = {
      high: '✅',
      medium: '⚠️',
      low: '❓',
    };

    const enhanced = `
${originalMessage}

🧠 AI Analysis:
${analysis.summary}

📊 Risk Assessment:
${riskEmoji[analysis.riskLevel] || '⚪'} Risk Level: ${analysis.riskLevel.toUpperCase()}
${confidenceEmoji[analysis.confidence] || '⚪'} Confidence: ${analysis.confidence.toUpperCase()} (${Math.round(analysis.confidenceScore * 100)}%)
🔍 Pattern: ${analysis.pattern}
${analysis.isAnomalous ? '⚠️ ANOMALOUS BEHAVIOR DETECTED' : '✅ Normal pattern'}

📈 Context:
• Similar events (24h): ${analysis.similarEvents}
• Historical behavior: ${analysis.historicalBehavior}

🎯 Recommendation: ${analysis.recommendation}
`;

    return enhanced.trim();
  }
}

module.exports = CyreneAgent;
