const fs = require('fs');
const path = require('path');
const StateManager = require('./state-manager');
const llmClient = require('../llm/client');
const containerManager = require('../docker-runner/container-manager');
const executor = require('../docker-runner/executor');
const config = require('../config/settings');

/**
 * Scans the project directory recursively to extract readable source files.
 * @param {string} projectPath 
 * @returns {Array<{relativePath: string, content: string}>}
 */
function getProjectSourceFiles(projectPath) {
  const sourceFiles = [];
  const readDir = (dir) => {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git' && file !== 'temp_uploads' && file !== 'temp_debug' && file !== '.healer_backups') {
          readDir(fullPath);
        }
      } else {
        const ext = path.extname(file).toLowerCase();
        const allowedExts = ['.js', '.json', '.ts', '.py', '.go', '.rs', '.java', '.cpp', '.h', '.c', '.html', '.css'];
        // Ignore test files to keep context window light and clean
        if (allowedExts.includes(ext) && !file.includes('.test.') && file !== 'test.js' && stat.size < 100 * 1024) {
          const content = fs.readFileSync(fullPath, 'utf8');
          sourceFiles.push({
            relativePath: path.relative(projectPath, fullPath),
            content
          });
        }
      }
    }
  };
  try {
    readDir(projectPath);
  } catch (err) {
    console.error('Error scanning project files:', err);
  }
  return sourceFiles;
}

/**
 * Runs self-healing loop in either direct or docker mode.
 * @param {string} projectPath Path to the project root directory
 * @param {string} targetFile Main target file for debugging (ignored in direct)
 * @param {string} customInstructions Custom goals/prompts
 * @param {string} mode Execution mode ('direct' or 'docker')
 * @param {function} onUpdate Callback function for reporting events to frontend
 * @returns {Promise<{ success: boolean, attempts: number, error?: string }>}
 */
async function runFixLoop(projectPath, targetFile, customInstructions, mode = 'direct', options = {}, onUpdate = () => {}) {
  // Normalize parameters
  if (typeof mode === 'function') {
    onUpdate = mode;
    mode = 'direct';
    options = {};
  }
  if (typeof options === 'function') {
    onUpdate = options;
    options = {};
  }
  if (typeof customInstructions === 'function') {
    onUpdate = customInstructions;
    customInstructions = undefined;
    mode = 'direct';
    options = {};
  }

  const emit = (message, type = 'info', payload = {}) => {
    console.log(message);
    onUpdate({ message, type, payload, timestamp: new Date() });
  };

  const projectName = path.basename(projectPath);
  emit(`Initiating ${mode} session for project: ${projectName}...`, 'start');

  const state = new StateManager(projectPath);
  state.start();

  if (mode === 'direct') {
    try {
      emit('Scanning codebase source files...', 'info');
      const sourceFiles = getProjectSourceFiles(projectPath);
      
      if (sourceFiles.length === 0) {
        throw new Error('No readable source files found in the project.');
      }

      emit(`Read ${sourceFiles.length} files. Sending codebase to Gemini...`, 'info');
      emit('Gemini is analyzing files and applying fixes...', 'llm_starting');

      const debugResult = await llmClient.getDirectDebugFix(sourceFiles, customInstructions || 'Analyze files and explain them.', options);

      emit(`Gemini analysis complete: ${debugResult.explanation || 'Applied fixes successfully'}`, 'info');
      emit('Analysis explanation generated.', 'llm_explanation', {
        explanation: debugResult.explanation || 'Applied fixes successfully.'
      });

      if (!debugResult.files || debugResult.files.length === 0) {
        emit('No changes were suggested by Gemini.', 'info');
        emit('Debugging finished with no modifications.', 'success');
        return { success: true, attempts: 1 };
      }

      for (const file of debugResult.files) {
        const absolutePath = path.resolve(projectPath, file.path);
        const originalCode = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
        
        emit(`Proposed fix for file: ${file.path}`, 'llm_fixed', {
          attempt: file.path,
          originalCode: originalCode,
          fixedCode: file.code
        });
      }

      emit('All proposed changes loaded! Please review and click Approve to apply them to disk.', 'success');
      return { success: true, attempts: 1 };

    } catch (error) {
      emit(`Debugging error: ${error.message}`, 'error');
      return { success: false, attempts: 1, error: error.message };
    }
  } else {
    // Docker execution mode
    let container = null;
    try {
      emit('Initializing Docker container for automated tests...', 'container_starting');
      container = await containerManager.startContainer(projectPath);
      emit(`Docker container ${container.id.substring(0, 12)} started successfully.`, 'container_started');

      const maxRetries = config.maxRetries || 3;
      let attempt = 0;
      let healed = false;

      while (attempt < maxRetries) {
        attempt++;
        emit(`[Attempt ${attempt}/${maxRetries}] Running tests inside Docker container...`, 'test_running');
        const testResult = await executor.runTests(container);

        if (testResult.success) {
          emit(`[Attempt ${attempt}/${maxRetries}] All tests passed successfully!`, 'success');
          healed = true;
          break;
        }

        emit(`[Attempt ${attempt}/${maxRetries}] Tests failed. Errors detected.`, 'info');
        emit(`Test output logs:\n${testResult.error || testResult.output}`, 'error');

        emit('Scanning source files to feed context to Gemini...', 'info');
        const sourceFiles = getProjectSourceFiles(projectPath);

        emit('Sending failed test context to Gemini for auto-fixing...', 'llm_starting');
        const fixResult = await llmClient.getAutoFix(sourceFiles, testResult.error || testResult.output, customInstructions, options);

        emit(`Gemini identified bug in: ${fixResult.file}. Applying fix...`, 'info');

        const absolutePath = path.resolve(projectPath, fixResult.file);
        const originalCode = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';

        // Save backup
        state.backupFile(fixResult.file);

        // Apply fix directly for next test run
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, fixResult.code, 'utf8');

        emit(`Applied fix to file: ${fixResult.file}`, 'llm_fixed', {
          attempt: attempt,
          originalCode: originalCode,
          fixedCode: fixResult.code
        });
      }

      if (healed) {
        emit('Automated healing session finished successfully!', 'success');
        return { success: true, attempts: attempt };
      } else {
        emit(`Automated healing finished but test suite is still failing after ${maxRetries} attempts.`, 'failed');
        return { success: false, attempts: maxRetries, error: 'Test suite failed' };
      }

    } catch (error) {
      emit(`Docker execution error: ${error.message}`, 'error');
      return { success: false, attempts: 1, error: error.message };
    } finally {
      if (container) {
        emit('Cleaning up and removing Docker container...', 'info');
        await containerManager.cleanupContainer(container);
        emit('Docker container cleanup complete.', 'info');
      }
    }
  }
}

module.exports = {
  runFixLoop
};
