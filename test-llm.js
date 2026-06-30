const client = require('./llm/client');

async function testLLM() {
  const filePath = 'math.js';
  const fileContent = `function divide(a, b) {
  // Bug: does not check for division by zero
  return a / b;
}`;
  const testError = `AssertionError [ERR_ASSERTION]: Expected division by zero to throw Error
    at Object.<anonymous> (math.test.js:8:10)
    Output: divide(4, 0) returned Infinity, expected throw.`;

  console.log('Testing LLM Client with a mock bug...\n');
  try {
    const fixedCode = await client.getFix(filePath, fileContent, testError);
    console.log('\n--- LLM Response (Parsed Code) ---');
    console.log(fixedCode);
    console.log('----------------------------------\n');
  } catch (error) {
    console.error('Test failed with error:', error.message);
    console.log('\nMake sure you have set a valid GEMINI_API_KEY in your .env file.');
  }
}

testLLM();
