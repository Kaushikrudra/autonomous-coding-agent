const config = require('../config/settings');

class RetryHandler {
  constructor(maxRetries = config.maxRetries) {
    this.maxRetries = maxRetries;
  }

  /**
   * Evaluates if the agent should make another attempt to fix the code.
   * @param {number} attempts Current attempt count
   * @returns {boolean}
   */
  shouldRetry(attempts) {
    return attempts < this.maxRetries;
  }
}

module.exports = RetryHandler;
