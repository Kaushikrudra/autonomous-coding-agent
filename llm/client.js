const { GoogleGenAI } = require('@google/genai');
const config = require('../config/settings');
const { SYSTEM_PROMPT, getFixPrompt, getAutoFixPrompt, getDirectDebugPrompt } = require('./prompts/fix-prompt');

let geminiClient = null;

function getClient() {
  if (!geminiClient) {
    if (!config.geminiApiKey || config.geminiApiKey === 'your_gemini_api_key_here') {
      throw new Error(
        'Gemini API Key is not set or is still the placeholder. Please set GEMINI_API_KEY in your .env file.'
      );
    }
    // Initialize the Google Gen AI client
    geminiClient = new GoogleGenAI({
      apiKey: config.geminiApiKey,
    });
  }
  return geminiClient;
}

/**
 * Extracts content from inside a markdown code block.
 * Supports ```javascript, ```js, or generic ``` code blocks.
 * @param {string} text 
 * @returns {string}
 */
function extractCodeBlock(text) {
  const regex = /```(?:javascript|js)?\n([\s\S]*?)\n```/i;
  const match = text.match(regex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return text.trim();
}

/**
 * Sends code and error details to Gemini LLM to get a bug fix.
 * @param {string} filePath Path or name of the file being fixed.
 * @param {string} fileContent Original content of the file.
 * @param {string} testError The failure output or error details from test runner.
 * @param {string} customInstructions User custom instructions
 * @param {object} options Override model/temperature parameters
 * @returns {Promise<string>} Corrected file content returned by the LLM.
 */
async function getFix(filePath, fileContent, testError, customInstructions, options = {}) {
  const client = getClient();
  const promptText = getFixPrompt(filePath, fileContent, testError, customInstructions);
  const targetModel = options.model || config.geminiModel;
  const temp = options.temperature !== undefined ? parseFloat(options.temperature) : 0.2;

  console.log(`Sending fix request to Gemini (${targetModel}, temp=${temp}) for ${filePath}...`);
  
  const response = await client.models.generateContent({
    model: targetModel,
    contents: promptText,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: temp
    }
  });

  const rawContent = response.text;
  const parsedCode = extractCodeBlock(rawContent);
  return parsedCode;
}

/**
 * Sends test error details and all codebase file contexts to Gemini to auto-detect and fix the bug.
 * @param {Array<{relativePath: string, content: string}>} sourceFiles Project files
 * @param {string} testError Failed test outputs
 * @param {string} customInstructions Custom goals
 * @param {object} options Override model/temperature parameters
 * @returns {Promise<{file: string, code: string}>}
 */
async function getAutoFix(sourceFiles, testError, customInstructions, options = {}) {
  const client = getClient();
  const promptText = getAutoFixPrompt(sourceFiles, testError, customInstructions);
  const targetModel = options.model || config.geminiModel;
  const temp = options.temperature !== undefined ? parseFloat(options.temperature) : 0.2;

  console.log(`Sending auto-detect fix request to Gemini (${targetModel}, temp=${temp})...`);
  
  const response = await client.models.generateContent({
    model: targetModel,
    contents: promptText,
    config: {
      temperature: temp,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          file: { type: 'STRING' },
          code: { type: 'STRING' }
        },
        required: ['file', 'code']
      },
      systemInstruction: 'You are an expert software engineer and debugger. Find the buggy file, fix it, and return a JSON block mapping "file" (relative path) and "code" (full contents) to repair the codebase.',
    }
  });

  const rawText = response.text;
  try {
    const parsed = JSON.parse(rawText.trim());
    if (!parsed.file || !parsed.code) {
      throw new Error('LLM response missing file or code parameters.');
    }
    return parsed;
  } catch (err) {
    console.error('Failed to parse auto-fix result:', rawText);
    throw new Error('LLM did not return a valid JSON structure. Error: ' + err.message);
  }
}

/**
 * Direct codebase debugger using Gemini context. Reads all project files and user instructions to rewrite file contents directly.
 * @param {Array<{relativePath: string, content: string}>} sourceFiles 
 * @param {string} userInstructions 
 * @param {object} options Override model/temperature parameters
 * @returns {Promise<{explanation: string, files: Array<{path: string, code: string}>}>}
 */
async function getDirectDebugFix(sourceFiles, userInstructions, options = {}) {
  const client = getClient();
  const promptText = getDirectDebugPrompt(sourceFiles, userInstructions);
  const targetModel = options.model || config.geminiModel;
  const temp = options.temperature !== undefined ? parseFloat(options.temperature) : 0.2;

  console.log(`Sending direct codebase debug request to Gemini (${targetModel}, temp=${temp})...`);

  const response = await client.models.generateContent({
    model: targetModel,
    contents: promptText,
    config: {
      temperature: temp,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          explanation: { type: 'STRING' },
          files: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                path: { type: 'STRING' },
                code: { type: 'STRING' }
              },
              required: ['path', 'code']
            }
          }
        },
        required: ['explanation', 'files']
      },
      systemInstruction: 'You are an expert software engineer and debugger. Satisfy user requirements by modifying project files and returning JSON mapping of modified files.'
    }
  });

  const rawText = response.text;
  try {
    const parsed = JSON.parse(rawText.trim());
    return parsed; // Returns { explanation, files: [{ path, code }] }
  } catch (err) {
    console.error('Failed to parse direct debug fix:', rawText);
    throw new Error('LLM failed to return valid JSON results. Error: ' + err.message);
  }
}

async function generateCode(prompt, systemInstruction = 'You are an expert developer. Return only the requested code block.', options = {}) {
  const client = getClient();
  const targetModel = options.model || config.geminiModel;
  const temp = options.temperature !== undefined ? parseFloat(options.temperature) : 0.2;

  const reqConfig = {
    systemInstruction: systemInstruction,
    temperature: temp
  };

  if (options.responseMimeType) {
    reqConfig.responseMimeType = options.responseMimeType;
  }

  const response = await client.models.generateContent({
    model: targetModel,
    contents: prompt,
    config: reqConfig
  });

  const rawContent = response.text;
  return extractCodeBlock(rawContent);
}

module.exports = {
  getFix,
  getAutoFix,
  getDirectDebugFix,
  extractCodeBlock,
  generateCode
};
