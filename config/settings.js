require('dotenv').config();

module.exports = {
  dockerImage: process.env.DOCKER_IMAGE || 'node:20-alpine',
  dockerSocket: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3
};
