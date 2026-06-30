const { Writable } = require('stream');

/**
 * Runs a command inside a running Docker container and captures stdout, stderr, and exit code.
 * @param {Docker.Container} container 
 * @param {string[]} cmd The command and its arguments, e.g. ['npm', 'install']
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
async function runCommand(container, cmd) {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true
  });

  const stream = await exec.start({ Detach: false });

  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];

    const stdoutStream = new Writable({
      write(chunk, encoding, callback) {
        stdoutChunks.push(chunk);
        callback();
      }
    });

    const stderrStream = new Writable({
      write(chunk, encoding, callback) {
        stderrChunks.push(chunk);
        callback();
      }
    });

    // Use dockerode modem's demuxStream to separate stdout and stderr
    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    stream.on('end', async () => {
      try {
        const inspect = await exec.inspect();
        resolve({
          exitCode: inspect.ExitCode,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8')
        });
      } catch (err) {
        reject(err);
      }
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Runs npm install and npm test in the container and returns the structured result.
 * @param {Docker.Container} container 
 * @returns {Promise<{ success: boolean, output: string, error: string }>}
 */
async function runTests(container) {
  console.log('Running npm install in container...');
  const installResult = await runCommand(container, ['npm', 'install']);
  
  if (installResult.exitCode !== 0) {
    return {
      success: false,
      output: installResult.stdout,
      error: `npm install failed with exit code ${installResult.exitCode}. Stderr: ${installResult.stderr}`
    };
  }

  console.log('Running npm test in container...');
  const testResult = await runCommand(container, ['npm', 'test']);

  return {
    success: testResult.exitCode === 0,
    output: testResult.stdout,
    error: testResult.stderr
  };
}

module.exports = {
  runCommand,
  runTests
};
