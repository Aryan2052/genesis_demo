/**
 * Retry Engine - Exponential backoff with dead-letter queue
 * Handles failed notification deliveries
 */

class RetryEngine {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000; // 1 second
    this.maxDelay = options.maxDelay || 30000;  // 30 seconds
    this.deadLetterQueue = [];
  }

  /**
   * Execute operation with exponential backoff retry
   */
  async executeWithRetry(operation, context = {}) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await operation();
        return { success: true, result, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          console.log(`⏳ Retry attempt ${attempt + 1}/${this.maxRetries} in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }
    
    // All retries exhausted - add to dead letter queue
    this.deadLetterQueue.push({
      context,
      error: lastError.message,
      timestamp: Date.now(),
      attempts: this.maxRetries + 1
    });
    
    return { success: false, error: lastError, attempts: this.maxRetries + 1 };
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateDelay(attempt) {
    const delay = this.baseDelay * Math.pow(2, attempt);
    return Math.min(delay, this.maxDelay);
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get dead letter queue
   */
  getDeadLetterQueue() {
    return [...this.deadLetterQueue];
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetterQueue() {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    return count;
  }
}

module.exports = RetryEngine;
