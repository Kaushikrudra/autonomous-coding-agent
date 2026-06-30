const SYSTEM_PROMPT = `You are an autonomous AI coding assistant.
Your task is to analyze test failures, identify the root cause of the bug in the provided source file, and fix it.
Return only the updated file content inside a markdown code block. Do not provide explanations, markdown commentary, or preamble.`;

/**
 * Generates the user prompt for the LLM to fix a bug in a file.
 * @param {string} filePath Name or path of the file to fix
 * @param {string} fileContent Current contents of the file
 * @param {string} testError Stderr or stdout error output from the failed test
 * @param {string} customInstructions User's custom prompt
 * @returns {string} The formatted prompt string
 */
function getFixPrompt(filePath, fileContent, testError, customInstructions) {
  let prompt = `A test suite failed for the file: "${filePath}".

Here is the current content of "${filePath}":
\`\`\`javascript
${fileContent}
\`\`\`

Here is the test failure output/error message:
\`\`\`
${testError}
\`\`\``;

  if (customInstructions) {
    prompt += `\n\nAdditional instructions/goals from the user:\n${customInstructions}`;
  }

  prompt += `\n\nAnalyze the failure, correct the bug in "${filePath}", and return the entire updated file content.
Ensure you output the complete file contents wrapped in a markdown code block starting with \`\`\`javascript and ending with \`\`\`.
Do not include any explanation.`;

  return prompt;
}

/**
 * Generates the user prompt for auto-detecting the buggy file and fixing it.
 * @param {Array<{relativePath: string, content: string}>} sourceFiles List of source code files
 * @param {string} testError Stderr or stdout error output from the failed test
 * @param {string} customInstructions User's custom prompt
 * @returns {string} The formatted prompt string
 */
function getAutoFixPrompt(sourceFiles, testError, customInstructions) {
  let prompt = `A test suite failed in the project. Below is the list of source files in the project:\n\n`;
  sourceFiles.forEach(file => {
    prompt += `=========================================\n`;
    prompt += `File: ${file.relativePath}\n`;
    prompt += `=========================================\n`;
    prompt += `${file.content}\n\n`;
  });

  prompt += `=========================================\n`;
  prompt += `Test Failure Output/Error Message:\n`;
  prompt += `=========================================\n`;
  prompt += `${testError}\n\n`;

  if (customInstructions) {
    prompt += `=========================================\n`;
    prompt += `User Additional Instructions/Goals:\n`;
    prompt += `${customInstructions}\n\n`;
  }

  prompt += `Analyze the project files and the test failure. Identify which file contains the bug. Correct the bug in that file, and return the relative file path and its complete updated content in JSON format inside a markdown code block.
The JSON output must have this exact schema:
{
  "file": "relative/path/to/buggy_file.js",
  "code": "entire updated content of the file"
}
Ensure the output is wrapped in a markdown code block starting with \`\`\`json and ending with \`\`\`. Do not include any explanations.`;

  return prompt;
}

function getDirectDebugPrompt(sourceFiles, userInstructions) {
  let prompt = `You are debugging a project codebase. Below is the list of source files in the project:\n\n`;
  sourceFiles.forEach(file => {
    prompt += `=========================================\n`;
    prompt += `File: ${file.relativePath}\n`;
    prompt += `=========================================\n`;
    prompt += `${file.content}\n\n`;
  });

  prompt += `=========================================\n`;
  prompt += `User Instruction / Debug Request:\n`;
  prompt += `=========================================\n`;
  prompt += `${userInstructions}\n\n`;
  
  prompt += `Analyze the codebase files and satisfy the user's instructions.
Identify which files need to be edited, correct the bugs or implement the features, and return the modified files.
Format your output as a JSON object inside a markdown code block (starting with \`\`\`json and ending with \`\`\`).
The JSON object must have this exact schema:
{
  "explanation": "Brief explanation of the changes made",
  "files": [
    {
      "path": "relative/path/to/modified_file.js",
      "code": "complete updated content of the file"
    }
  ]
}
Do not include any text outside the JSON code block.`;

  return prompt;
}

module.exports = {
  SYSTEM_PROMPT,
  getFixPrompt,
  getAutoFixPrompt,
  getDirectDebugPrompt
};
