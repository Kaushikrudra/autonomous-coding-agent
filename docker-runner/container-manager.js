const Docker = require('dockerode');
const path = require('path');
const fs = require('fs');
const config = require('../config/settings');

const docker = new Docker({ socketPath: config.dockerSocket });

/**
 * Ensures the specified Docker image is available locally.
 * Pulls the image if it is missing.
 * @param {string} imageName 
 */
async function ensureImage(imageName) {
  try {
    await docker.getImage(imageName).inspect();
    // Image exists locally
    return;
  } catch (err) {
    if (err.statusCode === 404) {
      console.log(`Image ${imageName} not found locally. Pulling...`);
      await new Promise((resolve, reject) => {
        docker.pull(imageName, (err, stream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (err, output) => {
            if (err) return reject(err);
            console.log(`Successfully pulled ${imageName}`);
            resolve(output);
          }, (event) => {
            // Optional progress logging
          });
        });
      });
    } else {
      throw err;
    }
  }
}

/**
 * Spins up a Docker container mounting the specified project directory.
 * @param {string} projectPath Absolute or relative path to the project directory on host.
 * @returns {Promise<Docker.Container>}
 */
async function startContainer(projectPath) {
  const absoluteProjectPath = path.resolve(projectPath);
  if (!fs.existsSync(absoluteProjectPath)) {
    throw new Error(`Project path does not exist: ${absoluteProjectPath}`);
  }

  const imageName = config.dockerImage;
  await ensureImage(imageName);

  // We mount the project directory to /usr/src/app in the container
  const containerPath = '/usr/src/app';

  const container = await docker.createContainer({
    Image: imageName,
    Cmd: ['tail', '-f', '/dev/null'], // Keep the container running
    HostConfig: {
      Binds: [`${absoluteProjectPath}:${containerPath}`],
    },
    WorkingDir: containerPath,
  });

  await container.start();
  console.log(`Started container ${container.id.substring(0, 12)} for project: ${absoluteProjectPath}`);
  return container;
}

/**
 * Stops and removes a Docker container.
 * @param {Docker.Container} container 
 */
async function cleanupContainer(container) {
  if (!container) return;
  try {
    const containerInfo = await container.inspect();
    if (containerInfo.State.Running) {
      console.log(`Stopping container ${container.id.substring(0, 12)}...`);
      await container.stop();
    }
    console.log(`Removing container ${container.id.substring(0, 12)}...`);
    await container.remove();
  } catch (err) {
    console.error(`Error during container cleanup: ${err.message}`);
  }
}

module.exports = {
  startContainer,
  cleanupContainer
};
