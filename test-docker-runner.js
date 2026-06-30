const path = require('path');
const containerManager = require('./docker-runner/container-manager');
const executor = require('./docker-runner/executor');

async function main() {
  const projectPath = path.join(__dirname, 'workspace', 'sample-project');
  console.log(`Starting test runner for project at: ${projectPath}`);
  
  let container = null;
  try {
    container = await containerManager.startContainer(projectPath);
    console.log('Container started successfully.');
    
    console.log('Executing tests inside the container...');
    const result = await executor.runTests(container);
    
    console.log('\n--- Execution Result ---');
    console.log(`Success: ${result.success}`);
    console.log('Output (Stdout):');
    console.log(result.output || '(No stdout)');
    console.log('Error (Stderr):');
    console.log(result.error || '(No stderr)');
    console.log('------------------------\n');
    
  } catch (err) {
    console.error('An error occurred during execution:', err);
  } finally {
    if (container) {
      console.log('Cleaning up container...');
      await containerManager.cleanupContainer(container);
      console.log('Cleanup completed.');
    }
  }
}

main().catch(err => {
  console.error('Fatal error in main:', err);
});
