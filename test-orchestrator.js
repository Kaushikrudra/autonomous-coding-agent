const fs = require('fs');
const path = require('path');
const orchestrator = require('./core/orchestrator');

async function runVerification() {
  const projectPath = path.join(__dirname, 'workspace', 'sample-project');
  const targetFile = 'index.js';
  const targetFilePath = path.join(projectPath, targetFile);

  // 1. Introduce a bug in index.js to cause the test to fail
  const buggyCode = `function add(a, b) {
  // BUG: Subtracting instead of adding
  return a - b;
}

module.exports = { add };
`;

  console.log('Writing buggy version of index.js to simulate a test failure...');
  fs.writeFileSync(targetFilePath, buggyCode, 'utf8');

  // 2. Start the self-healing orchestrator fix-loop
  const result = await orchestrator.runFixLoop(projectPath, targetFile);

  console.log('\n--- Orchestrator Loop Finished ---');
  console.log(`Success: ${result.success}`);
  console.log(`Total Attempts: ${result.attempts}`);
  if (result.error) {
    console.log(`Error Message: ${result.error}`);
  }

  // 3. Print the final code to verify the fix
  const finalCode = fs.readFileSync(targetFilePath, 'utf8');
  console.log('\nFinal contents of index.js:');
  console.log('==========================');
  console.log(finalCode);
  console.log('==========================\n');
}

runVerification().catch(err => {
  console.error('Orchestration test failed:', err);
});
