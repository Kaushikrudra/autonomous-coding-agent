/**
 * Parses stdout and stderr from a Jest test execution run.
 * @param {string} stdout 
 * @param {string} stderr 
 * @returns {{ passed: boolean, errorSummary: string }}
 */
function parseJestOutput(stdout, stderr) {
  // Jest writes execution logs and error reports to stderr
  const combined = (stderr || '') + '\n' + (stdout || '');
  
  // Jest outputs PASS when tests pass and FAIL when they fail
  const passed = combined.includes('PASS') && !combined.includes('FAIL');
  
  let errorSummary = '';
  if (!passed) {
    // Collect lines that show FAIL status or details of the assertion errors
    const lines = combined.split('\n');
    const failureLines = lines.filter(line => 
      line.includes('FAIL') || 
      line.includes('●') || 
      line.includes('Error:') || 
      line.includes('expect(') || 
      line.includes('AssertionError')
    );
    errorSummary = failureLines.join('\n') || combined;
  }
  
  return {
    passed,
    errorSummary: errorSummary.trim()
  };
}

module.exports = {
  parseJestOutput
};
