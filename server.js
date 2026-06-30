const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { runFixLoop } = require('./core/orchestrator');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: path.join(__dirname, 'workspace', 'temp_uploads') });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Clone GitHub repository into workspace
app.post('/api/project/clone', async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) {
    return res.status(400).json({ error: 'Missing parameter: repoUrl' });
  }

  // Parse project name from GitHub URL
  const matches = repoUrl.match(/\/([^\/]+?)(?:\.git)?\/?$/);
  if (!matches || !matches[1]) {
    return res.status(400).json({ error: 'Invalid GitHub Repository URL' });
  }
  const projectName = matches[1];
  const targetPath = path.join(__dirname, 'workspace', projectName);

  if (fs.existsSync(targetPath)) {
    return res.status(400).json({ error: `Project folder "${projectName}" already exists in workspace/` });
  }

  try {
    const { exec } = require('child_process');
    console.log(`Cloning ${repoUrl} to workspace/${projectName}...`);
    
    await new Promise((resolve, reject) => {
      exec(`git clone "${repoUrl}" "${targetPath}"`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      });
    });

    res.json({ success: true, project: projectName, message: `Successfully cloned ${projectName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload and extract ZIP file into workspace
app.post('/api/project/upload-zip', upload.single('zipFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded' });
  }

  const tempPath = req.file.path;
  const originalName = req.file.originalname;

  // Validate ZIP extension
  if (!originalName.toLowerCase().endsWith('.zip')) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    return res.status(400).json({ error: 'Uploaded file is not a ZIP archive' });
  }

  // Parse project name from ZIP name (e.g. project.zip -> project)
  const baseName = path.basename(originalName, '.zip');
  const projectName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_'); // sanitize name
  const targetPath = path.join(__dirname, 'workspace', projectName);

  if (fs.existsSync(targetPath)) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    return res.status(400).json({ error: `Project folder "${projectName}" already exists in workspace/` });
  }

  try {
    const { exec } = require('child_process');
    fs.mkdirSync(targetPath, { recursive: true });
    
    console.log(`Extracting uploaded ZIP ${originalName} to workspace/${projectName}...`);
    
    await new Promise((resolve, reject) => {
      exec(`unzip -o "${tempPath}" -d "${targetPath}"`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      });
    });

    // Clean up temporary file
    try { fs.unlinkSync(tempPath); } catch (_) {}

    res.json({ success: true, project: projectName, message: `Successfully uploaded and extracted ${projectName}` });
  } catch (err) {
    // Cleanup on failure
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    if (fs.existsSync(targetPath)) {
      try { fs.rmdirSync(targetPath, { recursive: true }); } catch (_) {}
    }
    res.status(500).json({ error: err.message });
  }
});

// List projects in workspace/
app.get('/api/projects', (req, res) => {
  try {
    const workspacePath = path.join(__dirname, 'workspace');
    if (!fs.existsSync(workspacePath)) {
      return res.json([]);
    }
    const items = fs.readdirSync(workspacePath, { withFileTypes: true });
    const projects = items
      .filter(item => item.isDirectory() && item.name !== 'node_modules' && item.name !== 'sample-project/.next')
      .map(item => item.name);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE endpoint to trigger self-healing and stream progress
app.get('/api/heal', async (req, res) => {
  const { project, prompt, mode, model, temperature } = req.query;
  
  if (!project) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Missing project parameter');
  }

  // Set headers for Server-Sent Events (SSE) and prevent buffering
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders(); // Establish the connection immediately to prevent buffering

  const projectPath = path.join(__dirname, 'workspace', project);

  const sendEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Compile options from request
  const options = {};
  if (model) options.model = model;
  if (temperature) options.temperature = parseFloat(temperature);

  try {
    const result = await runFixLoop(projectPath, undefined, prompt, mode || 'direct', options, (update) => {
      sendEvent(update);
    });
    
    sendEvent({
      type: 'done',
      message: 'Self-healing process finished.',
      payload: result
    });
  } catch (err) {
    sendEvent({
      type: 'error',
      message: `Fatal error: ${err.message}`
    });
  } finally {
    res.end();
  }
});

// Trigger a bug in workspace/sample-project/index.js for testing
app.post('/api/trigger-bug', (req, res) => {
  try {
    const projectPath = path.join(__dirname, 'workspace', 'sample-project');
    const targetFilePath = path.join(projectPath, 'index.js');
    const buggyCode = `function add(a, b) {
  // BUG: Subtracting instead of adding
  return a - b;
}

module.exports = { add };
`;
    fs.writeFileSync(targetFilePath, buggyCode, 'utf8');
    res.json({ success: true, message: 'Bug introduced in index.js successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HTML Route for the login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// HTML Route for the signup page
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// HTML Route for the playground page
app.get('/generate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'generate.html'));
});

// POST API Endpoint for code playground generation
app.post('/api/generate-code', async (req, res) => {
  const { task, language } = req.body;
  if (!task) {
    return res.status(400).json({ error: 'Missing parameter: task' });
  }

  const targetLanguage = language || 'javascript';

  const { generateCode } = require('./llm/client');
  const { SYSTEM_PROMPT, getUserPrompt } = require('./llm/prompts/direct-code-gen');

  try {
    const rawText = await generateCode(getUserPrompt(task, targetLanguage), SYSTEM_PROMPT, { responseMimeType: 'application/json' });
    
    // Parse the structured JSON response
    let parsedResult;
    try {
      let cleaned = rawText.trim();
      // Strip ```json and ``` markdown formatting if present
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/```$/i, '').trim();
      }
      parsedResult = JSON.parse(cleaned);
    } catch (jsonErr) {
      console.error('Failed to parse Gemini response as JSON:', rawText);
      return res.status(500).json({
        error: 'Gemini returned malformed output. Please try rephrasing your description.',
        raw: rawText
      });
    }

    // Validate structured response
    if (!parsedResult.code) {
      return res.status(500).json({
        error: 'Gemini response did not contain code.',
        raw: rawText
      });
    }

    res.json({
      success: true,
      language: parsedResult.language || 'javascript',
      code: parsedResult.code,
      explanation: parsedResult.explanation || 'No explanation provided.'
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/project/files - Recursively list files in a project for the file tree explorer
app.get('/api/project/files', (req, res) => {
  const { project } = req.query;
  if (!project) {
    return res.status(400).json({ error: 'Missing parameter: project' });
  }

  const projectPath = path.join(__dirname, 'workspace', project);
  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: `Project "${project}" does not exist.` });
  }

  const buildTree = (dirPath) => {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const nodes = [];

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const relativePath = path.relative(projectPath, fullPath);

      if (item.isDirectory()) {
        if (item.name !== 'node_modules' && item.name !== '.git' && item.name !== '.healer_backups') {
          nodes.push({
            name: item.name,
            path: relativePath,
            type: 'directory',
            children: buildTree(fullPath)
          });
        }
      } else {
        const ext = path.extname(item.name).toLowerCase();
        const allowedExts = ['.js', '.json', '.ts', '.py', '.go', '.rs', '.java', '.cpp', '.h', '.c', '.html', '.css', '.md', '.env'];
        if (allowedExts.includes(ext)) {
          nodes.push({
            name: item.name,
            path: relativePath,
            type: 'file'
          });
        }
      }
    }
    // Sort directories first, then files alphabetically
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  };

  try {
    const fileTree = buildTree(projectPath);
    res.json(fileTree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/project/file-content - Retrieve current content of a specific file
app.get('/api/project/file-content', (req, res) => {
  const { project, filePath } = req.query;
  if (!project || !filePath) {
    return res.status(400).json({ error: 'Missing parameters: project or filePath' });
  }

  const projectPath = path.join(__dirname, 'workspace', project);
  const absolutePath = path.resolve(projectPath, filePath);

  if (!absolutePath.startsWith(projectPath)) {
    return res.status(400).json({ error: 'Access denied: Path lies outside project workspace' });
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/project/backups - List backups
app.get('/api/project/backups', (req, res) => {
  const { project } = req.query;
  if (!project) {
    return res.status(400).json({ error: 'Missing parameter: project' });
  }

  const projectPath = path.join(__dirname, 'workspace', project);
  const metaPath = path.join(projectPath, '.healer_backups', 'meta.json');

  if (!fs.existsSync(metaPath)) {
    return res.json([]);
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const backups = Object.entries(meta).map(([timestamp, data]) => ({
      timestamp: Number(timestamp),
      ...data
    })).sort((a, b) => b.timestamp - a.timestamp); // newest first
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/project/restore-backup - Restore specific backup
app.post('/api/project/restore-backup', (req, res) => {
  const { project, timestamp } = req.body;
  if (!project || !timestamp) {
    return res.status(400).json({ error: 'Missing parameter: project or timestamp' });
  }

  const projectPath = path.join(__dirname, 'workspace', project);
  const backupsDir = path.join(projectPath, '.healer_backups');
  const metaPath = path.join(backupsDir, 'meta.json');

  if (!fs.existsSync(metaPath)) {
    return res.status(400).json({ error: 'No backups found for this project.' });
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const backupEntry = meta[timestamp];

    if (!backupEntry) {
      return res.status(400).json({ error: 'Backup entry not found.' });
    }

    const backupFilePath = path.join(backupsDir, backupEntry.backupFile);
    if (!fs.existsSync(backupFilePath)) {
      return res.status(400).json({ error: 'Backup file missing from disk.' });
    }

    const targetFilePath = path.resolve(projectPath, backupEntry.relativeFilePath);
    const backupContent = fs.readFileSync(backupFilePath, 'utf8');

    // Read current content first to return it
    const currentContent = fs.existsSync(targetFilePath) ? fs.readFileSync(targetFilePath, 'utf8') : '';

    // Overwrite with backup
    fs.writeFileSync(targetFilePath, backupContent, 'utf8');

    // Remove the restored backup from list
    delete meta[timestamp];
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    
    // Delete actual file
    try { fs.unlinkSync(backupFilePath); } catch (_) {}

    res.json({
      success: true,
      message: `Restored ${backupEntry.relativeFilePath} to state from ${new Date(Number(timestamp)).toLocaleString()}`,
      file: backupEntry.relativeFilePath,
      originalContent: currentContent,
      restoredContent: backupContent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/project/apply-patch - Apply and save user-approved file patch
app.post('/api/project/apply-patch', (req, res) => {
  const { project, filePath, code } = req.body;
  if (!project || !filePath || code === undefined) {
    return res.status(400).json({ error: 'Missing parameters: project, filePath, or code' });
  }

  const projectPath = path.join(__dirname, 'workspace', project);
  const absolutePath = path.resolve(projectPath, filePath);

  // Validate directory traversal
  if (!absolutePath.startsWith(projectPath)) {
    return res.status(400).json({ error: 'Invalid file path: outside project workspace' });
  }

  try {
    const StateManager = require('./core/state-manager');
    const state = new StateManager(projectPath);

    // Save backup first so the user can revert this if needed
    state.backupFile(filePath);

    // Write modified code to disk
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, code, 'utf8');

    res.json({
      success: true,
      message: `Successfully applied patch to ${filePath}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
