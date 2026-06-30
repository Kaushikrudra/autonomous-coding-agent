// Helper to escape HTML tags to avoid XSS issues when rendering code
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  const projectSelect = document.getElementById('project-select');
  const healInstructionsInput = document.getElementById('heal-instructions');
  const btnStart = document.getElementById('btn-start');
  const btnClearConsole = document.getElementById('btn-clear-console');
  const terminal = document.getElementById('terminal');
  
  const agentState = document.getElementById('agent-state');
  const currentAttempt = document.getElementById('current-attempt');
  const containerStatus = document.getElementById('container-status');
  
  const diffContent = document.getElementById('diff-content');
  const diffPlaceholder = document.getElementById('diff-placeholder');
  const diffTabsContainer = document.getElementById('diff-tabs-container');
  const fixExplanationContainer = document.getElementById('fix-explanation-container');
  const fixExplanation = document.getElementById('fix-explanation');

  // Custom optimization selectors
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const dashboard = document.querySelector('.dashboard');
  const btnRefreshBackups = document.getElementById('btn-refresh-backups');
  const backupList = document.getElementById('backup-list');

  // Add Project UI Selectors
  const tabBtnGit = document.getElementById('tab-btn-git');
  const tabBtnZip = document.getElementById('tab-btn-zip');
  const formGit = document.getElementById('form-git');
  const formZip = document.getElementById('form-zip');
  const gitUrlInput = document.getElementById('git-url');
  const zipFileInput = document.getElementById('zip-file');
  const zipLabel = document.getElementById('zip-label');
  const btnClone = document.getElementById('btn-clone');
  const btnUnzip = document.getElementById('btn-unzip');

  // Approval UI Selectors
  const approvalBar = document.getElementById('approval-bar');
  const approvalStatusIcon = document.getElementById('approval-status-icon');
  const approvalStatusText = document.getElementById('approval-status-text');
  const btnApprove = document.getElementById('btn-approve');
  const btnReject = document.getElementById('btn-reject');

  let patchesStatus = {}; // Stores { [filePath]: 'proposed' | 'applied' | 'discarded' }
  let currentActiveFile = null;
  
  let attemptsFixes = {}; // Stores { [attempt]: { originalCode, fixedCode } }
  let currentActiveTab = null;
  let eventSource = null;

  // Monaco Editor state
  let diffEditor = null;
  let monacoReady = false;

  // Configure and load Monaco Editor dynamically
  if (typeof require !== 'undefined' && typeof require.config === 'function') {
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
      monacoReady = true;
      monaco.editor.defineTheme('healer-theme', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'ff79c6' },
          { token: 'string', foreground: 'f1fa8c' }
        ],
        colors: {
          'editor.background': '#16181d',
          'editor.lineHighlightBackground': '#1f2128',
          'editorLineNumber.foreground': '#64748b',
          'editorLineNumber.activeForeground': '#3b82f6',
          'diffEditor.insertedTextBackground': 'rgba(16, 185, 129, 0.12)',
          'diffEditor.removedTextBackground': 'rgba(239, 68, 68, 0.12)'
        }
      });
    });
  }

  // Tab switching logic for Add Project
  tabBtnGit.addEventListener('click', () => {
    tabBtnGit.classList.add('active');
    tabBtnGit.style.background = 'var(--primary-color)';
    tabBtnZip.classList.remove('active');
    tabBtnZip.style.background = 'transparent';
    formGit.classList.remove('hidden');
    formZip.classList.add('hidden');
  });

  tabBtnZip.addEventListener('click', () => {
    tabBtnZip.classList.add('active');
    tabBtnZip.style.background = 'var(--primary-color)';
    tabBtnGit.classList.remove('active');
    tabBtnGit.style.background = 'transparent';
    formZip.classList.remove('hidden');
    formGit.classList.add('hidden');
  });

  // 1.1 Fetch and display backups for selected project
  async function loadBackups(project) {
    if (!project) {
      backupList.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center;">No project selected.</div>';
      return;
    }

    try {
      const response = await fetch(`/api/project/backups?project=${encodeURIComponent(project)}`);
      const backups = await response.json();

      backupList.innerHTML = '';
      if (backups.length === 0) {
        backupList.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center;">No restore points created yet.</div>';
        return;
      }

      backups.forEach(backup => {
        const item = document.createElement('div');
        item.className = 'backup-item';

        const info = document.createElement('div');
        info.className = 'backup-info';

        const fileSpan = document.createElement('span');
        fileSpan.className = 'backup-file';
        fileSpan.textContent = backup.relativeFilePath;
        fileSpan.title = backup.relativeFilePath;

        const dateSpan = document.createElement('span');
        dateSpan.className = 'backup-date';
        dateSpan.textContent = new Date(backup.timestamp).toLocaleString();

        info.appendChild(fileSpan);
        info.appendChild(dateSpan);

        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn-restore';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', async () => {
          if (!confirm(`Are you sure you want to restore ${backup.relativeFilePath} to this state?`)) return;
          
          restoreBtn.disabled = true;
          restoreBtn.textContent = 'Restoring...';
          
          try {
            const res = await fetch('/api/project/restore-backup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project, timestamp: backup.timestamp })
            });
            const result = await res.json();
            if (res.ok && result.success) {
              logLine(result.message, 'success');
              
              // Load restored diff into visualizer
              addAttemptTab(`Restored: ${backup.relativeFilePath}`, result.originalContent, result.restoredContent);
              
              // Refresh backups
              loadBackups(project);
            } else {
              logLine(`Restore failed: ${result.error}`, 'error');
            }
          } catch (err) {
            logLine(`Network error during restore: ${err.message}`, 'error');
          } finally {
            restoreBtn.disabled = false;
            restoreBtn.textContent = 'Restore';
          }
        });

        item.appendChild(info);
        item.appendChild(restoreBtn);
        backupList.appendChild(item);
      });
    } catch (err) {
      console.error('Error loading backups:', err);
    }
  }

  // Bind change listener and toggle events
  projectSelect.addEventListener('change', () => {
    loadBackups(projectSelect.value);
    loadFileExplorer(projectSelect.value);
  });

  btnRefreshBackups.addEventListener('click', () => {
    loadBackups(projectSelect.value);
  });

  btnToggleSidebar.addEventListener('click', () => {
    dashboard.classList.toggle('sidebar-collapsed');
  });

  // 1. Fetch available projects in the workspace
  async function loadProjects(selectVal = null) {
    try {
      const response = await fetch('/api/projects');
      const projects = await response.json();
      
      projectSelect.innerHTML = '';
      if (projects.length === 0) {
        projectSelect.innerHTML = '<option value="" disabled>No projects found in workspace/</option>';
        return;
      }
      
      projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project;
        option.textContent = project;
        projectSelect.appendChild(option);
      });
      
      // Auto-select the newly added project, or fallback to sample-project
      if (selectVal && projects.includes(selectVal)) {
        projectSelect.value = selectVal;
      } else if (projects.includes('sample-project')) {
        projectSelect.value = 'sample-project';
      }
      
      // Load backups for selected project
      loadBackups(projectSelect.value);
      loadFileExplorer(projectSelect.value);
    } catch (err) {
      logLine(`Error loading projects: ${err.message}`, 'error');
    }
  }

  // Clone repo click handler
  btnClone.addEventListener('click', async () => {
    const repoUrl = gitUrlInput.value.trim();
    if (!repoUrl) {
      alert('Please enter a GitHub repository URL!');
      return;
    }

    btnClone.disabled = true;
    btnClone.innerHTML = '<span class="spinner"></span>';
    logLine(`Starting clone operation for: ${repoUrl}`, 'container');

    try {
      const response = await fetch('/api/project/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl })
      });
      const result = await response.json();

      if (response.ok && result.success) {
        logLine(result.message, 'success');
        gitUrlInput.value = '';
        await loadProjects(result.project);
      } else {
        logLine(`Clone failed: ${result.error}`, 'error');
      }
    } catch (err) {
      logLine(`Network error during clone: ${err.message}`, 'error');
    } finally {
      btnClone.disabled = false;
      btnClone.innerHTML = 'Clone';
    }
  });

  // Update ZIP label when a file is selected
  zipFileInput.addEventListener('change', () => {
    const file = zipFileInput.files[0];
    if (file) {
      zipLabel.innerHTML = `📁 ${file.name}`;
      zipLabel.style.borderColor = 'var(--primary-color)';
      zipLabel.style.color = '#fff';
      btnUnzip.disabled = false;
    } else {
      zipLabel.innerHTML = '📁 Choose ZIP File';
      zipLabel.style.borderColor = '';
      zipLabel.style.color = '';
      btnUnzip.disabled = true;
    }
  });

  // Extract uploaded ZIP file click handler
  btnUnzip.addEventListener('click', async () => {
    const file = zipFileInput.files[0];
    if (!file) {
      alert('Please choose a ZIP file first!');
      return;
    }

    btnUnzip.disabled = true;
    btnUnzip.innerHTML = '<span class="spinner"></span>';
    logLine(`Uploading and extracting: ${file.name}...`, 'container');

    const formData = new FormData();
    formData.append('zipFile', file);

    try {
      const response = await fetch('/api/project/upload-zip', {
        method: 'POST',
        body: formData
      });
      const result = await response.json();

      if (response.ok && result.success) {
        logLine(result.message, 'success');
        
        // Reset file input and label
        zipFileInput.value = '';
        zipLabel.innerHTML = '📁 Choose ZIP File';
        zipLabel.style.borderColor = '';
        zipLabel.style.color = '';
        btnUnzip.disabled = true;
        
        await loadProjects(result.project);
      } else {
        logLine(`Extraction failed: ${result.error}`, 'error');
      }
    } catch (err) {
      logLine(`Network error during extraction: ${err.message}`, 'error');
    } finally {
      btnUnzip.disabled = false;
      btnUnzip.innerHTML = 'Upload & Unzip';
    }
  });

  // 2. Logging helper for the terminal window
  function logLine(message, type = 'info') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.setAttribute('data-type', type);
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    terminal.appendChild(line);
    
    // Apply filters
    filterSingleLine(line);
    
    // Keep scrolled to bottom
    terminal.scrollTop = terminal.scrollHeight;
  }

  // 3. Clear console
  btnClearConsole.addEventListener('click', () => {
    terminal.innerHTML = '<div class="terminal-line" data-type="info">Terminal cleared.</div>';
  });

  // Suggestion 2 & 4: Timeline Stepper & Console filter logic
  const consoleSearch = document.getElementById('console-search');
  const filterPills = document.querySelectorAll('.filter-pill');
  let currentLogFilter = 'all';

  function filterLogs() {
    const query = consoleSearch.value ? consoleSearch.value.toLowerCase() : '';
    const lines = terminal.querySelectorAll('.terminal-line');
    
    lines.forEach(line => {
      const text = line.textContent.toLowerCase();
      const type = line.getAttribute('data-type') || 'info';
      
      const matchesQuery = text.includes(query);
      const matchesFilter = currentLogFilter === 'all' || 
                            (currentLogFilter === 'error' && (type === 'error' || type === 'failed')) ||
                            type === currentLogFilter;
      
      if (matchesQuery && matchesFilter) {
        line.style.display = 'block';
      } else {
        line.style.display = 'none';
      }
    });
  }

  function filterSingleLine(line) {
    const query = consoleSearch && consoleSearch.value ? consoleSearch.value.toLowerCase() : '';
    const text = line.textContent.toLowerCase();
    const type = line.getAttribute('data-type') || 'info';
    
    const matchesQuery = text.includes(query);
    const matchesFilter = currentLogFilter === 'all' || 
                          (currentLogFilter === 'error' && (type === 'error' || type === 'failed')) ||
                          type === currentLogFilter;
    
    if (matchesQuery && matchesFilter) {
      line.style.display = 'block';
    } else {
      line.style.display = 'none';
    }
  }

  if (consoleSearch) {
    consoleSearch.addEventListener('input', filterLogs);
  }
  
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentLogFilter = pill.getAttribute('data-filter');
      filterLogs();
    });
  });

  function updateStepperState(stepId, status) {
    const stepEl = document.getElementById(stepId);
    if (!stepEl) return;
    stepEl.setAttribute('data-status', status);
    
    const iconEl = stepEl.querySelector('.step-icon');
    if (iconEl) {
      if (status === 'completed') iconEl.innerHTML = '✓';
      else if (status === 'active') iconEl.innerHTML = '●';
      else if (status === 'failed') iconEl.innerHTML = '✗';
      else iconEl.innerHTML = '○';
    }
  }

  function resetStepper() {
    ['step-clone', 'step-inspect', 'step-diagnose', 'step-verify', 'step-patch'].forEach(stepId => {
      updateStepperState(stepId, 'pending');
    });
  }



  // 5. Monaco-based Side-by-Side Diff Visualizer
  function displayDiff(original, fixed, filename = 'index.js') {
    if (!monacoReady) {
      setTimeout(() => displayDiff(original, fixed, filename), 100);
      return;
    }

    currentActiveFile = filename;

    let language = 'javascript';
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'py') language = 'python';
    else if (ext === 'go') language = 'go';
    else if (ext === 'rs') language = 'rust';
    else if (ext === 'java') language = 'java';
    else if (ext === 'cpp' || ext === 'h' || ext === 'c') language = 'cpp';
    else if (ext === 'html') language = 'html';
    else if (ext === 'css') language = 'css';
    else if (ext === 'json') language = 'json';
    else if (ext === 'ts') language = 'typescript';

    const container = document.getElementById('monaco-diff-container');
    
    // Dispose previous models to avoid memory leak
    if (diffEditor) {
      const currentModel = diffEditor.getModel();
      if (currentModel) {
        if (currentModel.original) currentModel.original.dispose();
        if (currentModel.modified) currentModel.modified.dispose();
      }
    } else {
      diffEditor = monaco.editor.createDiffEditor(container, {
        theme: 'healer-theme',
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: true
      });
    }

    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(fixed, language);

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });

    if (!patchesStatus[filename]) {
      patchesStatus[filename] = 'proposed';
    }

    updateApprovalBarUI(filename);

    diffPlaceholder.classList.add('hidden');
    diffContent.classList.remove('hidden');
  }

  function updateApprovalBarUI(filename) {
    const status = patchesStatus[filename] || 'proposed';
    approvalBar.classList.remove('hidden');

    if (status === 'proposed') {
      approvalBar.style.background = 'rgba(251, 191, 36, 0.05)';
      approvalBar.style.borderColor = 'rgba(251, 191, 36, 0.2)';
      approvalStatusIcon.textContent = '⚠️';
      approvalStatusText.innerHTML = `Proposed fix for <strong style="color: #fff;">${filename}</strong> (Not applied to disk yet)`;
      btnApprove.disabled = false;
      btnApprove.style.opacity = '1';
      btnApprove.innerHTML = '✓ Approve & Apply';
      btnReject.disabled = false;
      btnReject.style.opacity = '1';
      btnReject.innerHTML = '✗ Discard';
    } else if (status === 'applied') {
      approvalBar.style.background = 'rgba(16, 185, 129, 0.05)';
      approvalBar.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      approvalStatusIcon.textContent = '✅';
      approvalStatusText.innerHTML = `Successfully applied to disk for <strong style="color: #fff;">${filename}</strong>`;
      btnApprove.disabled = true;
      btnApprove.style.opacity = '0.5';
      btnApprove.innerHTML = 'Applied';
      btnReject.disabled = true;
      btnReject.style.opacity = '0.5';
      btnReject.innerHTML = 'Discard';
    } else if (status === 'discarded') {
      approvalBar.style.background = 'rgba(239, 68, 68, 0.05)';
      approvalBar.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      approvalStatusIcon.textContent = '❌';
      approvalStatusText.innerHTML = `Proposed patch for <strong style="color: #fff;">${filename}</strong> was discarded`;
      btnApprove.disabled = true;
      btnApprove.style.opacity = '0.5';
      btnApprove.innerHTML = 'Approve & Apply';
      btnReject.disabled = true;
      btnReject.style.opacity = '0.5';
      btnReject.innerHTML = 'Discarded';
    }
  }

  // Bind Approve and Reject Button Clicks
  btnApprove.addEventListener('click', async () => {
    if (!currentActiveFile || !projectSelect.value) return;

    const fileData = attemptsFixes[currentActiveFile];
    if (!fileData) return;

    btnApprove.disabled = true;
    btnApprove.innerHTML = '<span class="spinner"></span> Applying...';
    btnReject.disabled = true;

    logLine(`Applying approved patch to: ${currentActiveFile}...`, 'container');

    try {
      const response = await fetch('/api/project/apply-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: projectSelect.value,
          filePath: currentActiveFile,
          code: fileData.fixedCode
        })
      });
      const result = await response.json();

      if (response.ok && result.success) {
        logLine(result.message, 'success');
        patchesStatus[currentActiveFile] = 'applied';
        updateApprovalBarUI(currentActiveFile);

        // Refresh project backups
        loadBackups(projectSelect.value);
      } else {
        logLine(`Failed to apply patch: ${result.error}`, 'error');
        btnApprove.disabled = false;
        btnApprove.innerHTML = '✓ Approve & Apply';
        btnReject.disabled = false;
      }
    } catch (err) {
      logLine(`Network error while applying patch: ${err.message}`, 'error');
      btnApprove.disabled = false;
      btnApprove.innerHTML = '✓ Approve & Apply';
      btnReject.disabled = false;
    }
  });

  btnReject.addEventListener('click', () => {
    if (!currentActiveFile) return;
    if (confirm(`Are you sure you want to discard proposed changes to ${currentActiveFile}?`)) {
      logLine(`Discarded proposed patch for: ${currentActiveFile}`, 'info');
      patchesStatus[currentActiveFile] = 'discarded';
      updateApprovalBarUI(currentActiveFile);
    }
  });

  // 6. Create and manage tabs for each fix attempt
  function addAttemptTab(attempt, originalCode, fixedCode) {
    attemptsFixes[attempt] = { originalCode, fixedCode };
    
    const tab = document.createElement('div');
    tab.className = 'diff-tab';
    tab.textContent = isNaN(attempt) ? attempt : `Attempt ${attempt}`;
    tab.dataset.attempt = attempt;
    
    tab.addEventListener('click', () => {
      // Toggle active classes
      document.querySelectorAll('.diff-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Render selection
      displayDiff(originalCode, fixedCode, attempt);
    });
    
    diffTabsContainer.appendChild(tab);
    
    // Auto-click the newly added tab
    tab.click();
  }

  function clearDiffs() {
    attemptsFixes = {};
    patchesStatus = {};
    currentActiveFile = null;
    diffTabsContainer.innerHTML = '';
    approvalBar.classList.add('hidden');
    
    if (diffEditor) {
      const currentModel = diffEditor.getModel();
      if (currentModel) {
        if (currentModel.original) currentModel.original.dispose();
        if (currentModel.modified) currentModel.modified.dispose();
      }
      diffEditor.setModel(null);
    }
    
    diffContent.classList.add('hidden');
    diffPlaceholder.classList.remove('hidden');
    fixExplanation.textContent = '';
    fixExplanationContainer.classList.add('hidden');
  }

  function setDiffLoadingState() {
    diffPlaceholder.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 1rem; padding: 2rem;">
        <span class="spinner" style="width: 2.5rem; height: 2.5rem; border-width: 3px; border-top-color: var(--primary-color);"></span>
        <div style="color: var(--primary-color); font-weight: 600; font-size: 1.1rem; animation: pulse 1.5s infinite; text-transform: uppercase; letter-spacing: 0.5px;">
          Gemini is analyzing & debugging...
        </div>
        <p style="color: var(--text-secondary); font-size: 0.85rem; max-width: 320px; text-align: center; margin: 0; line-height: 1.5;">
          Reviewing codebase structures and applying requested changes. This process takes a moment.
        </p>
      </div>
    `;
  }

  function restoreDiffPlaceholder() {
    diffPlaceholder.innerHTML = `
      <span style="font-size: 2.5rem; margin-bottom: 1rem;">🔍</span>
      Select a project, provide instructions, and click "Go" to run direct codebase debugging.
    `;
  }

  // 1.2 Fetch and render project file structure for interactive explorer
  async function loadFileExplorer(project) {
    const treeContainer = document.getElementById('file-explorer-tree');
    if (!project) {
      treeContainer.innerHTML = '<div style="color: var(--text-secondary); text-align: center; font-style: italic; padding: 1rem 0.5rem;">No project selected.</div>';
      return;
    }

    try {
      const response = await fetch(`/api/project/files?project=${encodeURIComponent(project)}`);
      const fileTree = await response.json();

      treeContainer.innerHTML = '';

      if (!fileTree || fileTree.length === 0) {
        treeContainer.innerHTML = '<div style="color: var(--text-secondary); text-align: center; font-style: italic; padding: 1rem 0.5rem;">No files found.</div>';
        return;
      }

      const renderNode = (node, depth = 0, parentContainer = treeContainer) => {
        const item = document.createElement('div');
        item.style.paddingLeft = `${depth * 12 + 6}px`;
        item.style.cursor = 'pointer';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '0.35rem';
        item.style.padding = '0.25rem 0.4rem';
        item.style.borderRadius = '6px';
        item.style.fontSize = '0.75rem';
        item.style.transition = 'all 0.2s ease';
        item.className = 'tree-item';

        if (node.type === 'directory') {
          item.classList.add('tree-dir');
          
          const arrow = document.createElement('span');
          arrow.innerHTML = '▼';
          arrow.className = 'tree-arrow';
          arrow.style.fontSize = '0.65rem';
          arrow.style.transition = 'transform 0.2s';
          arrow.style.color = 'var(--text-secondary)';
          item.appendChild(arrow);
          
          const folderIcon = document.createElement('span');
          folderIcon.innerHTML = '📁';
          item.appendChild(folderIcon);
          
          const nameSpan = document.createElement('span');
          nameSpan.innerHTML = node.name;
          nameSpan.style.color = '#cbd5e1';
          nameSpan.style.fontWeight = '500';
          item.appendChild(nameSpan);
          
          parentContainer.appendChild(item);
          
          if (node.children && node.children.length > 0) {
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-child-container';
            childContainer.style.transition = 'all 0.2s ease';
            parentContainer.appendChild(childContainer);
            
            node.children.forEach(child => renderNode(child, depth + 1, childContainer));
            
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              const isCollapsed = childContainer.style.display === 'none';
              childContainer.style.display = isCollapsed ? 'block' : 'none';
              arrow.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
              folderIcon.innerHTML = isCollapsed ? '📂' : '📁';
            });
          }
        } else {
          item.classList.add('tree-file');
          
          const ext = node.name.split('.').pop().toLowerCase();
          let icon = '📄';
          if (ext === 'js' || ext === 'jsx') icon = '🟨';
          else if (ext === 'py') icon = '🐍';
          else if (ext === 'json') icon = '⚙️';
          else if (ext === 'html') icon = '🌐';
          else if (ext === 'css') icon = '🎨';
          else if (ext === 'md') icon = '📝';
          else if (ext === 'zip') icon = '📦';
          
          const fileIcon = document.createElement('span');
          fileIcon.innerHTML = icon;
          item.appendChild(fileIcon);
          
          const nameSpan = document.createElement('span');
          nameSpan.innerHTML = node.name;
          nameSpan.style.color = '#f1f5f9';
          item.appendChild(nameSpan);
          
          parentContainer.appendChild(item);
          
          item.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              document.querySelectorAll('#file-explorer-tree .tree-file').forEach(d => d.classList.remove('active'));
              item.classList.add('active');
              
              const contentRes = await fetch(`/api/project/file-content?project=${encodeURIComponent(project)}&filePath=${encodeURIComponent(node.path)}`);
              const contentData = await contentRes.json();
              if (contentRes.ok) {
                patchesStatus[node.path] = 'explorer';
                displayDiff(contentData.content, contentData.content, node.path);
                addAttemptTab(node.path, contentData.content, contentData.content);
              } else {
                logLine(`Failed to load file content: ${contentData.error}`, 'error');
              }
            } catch (err) {
              logLine(`Error loading file: ${err.message}`, 'error');
            }
          });
        }
      };

      fileTree.forEach(node => renderNode(node));

    } catch (err) {
      console.error('Error loading file explorer:', err);
    }
  }

  // Collapsible Advanced Settings Event Listeners
  const btnToggleAdvanced = document.getElementById('btn-toggle-advanced');
  const advancedSettingsPanel = document.getElementById('advanced-settings-panel');
  const advancedArrow = document.getElementById('advanced-arrow');
  const llmModelSelect = document.getElementById('llm-model-select');
  const llmTemperature = document.getElementById('llm-temperature');
  const tempVal = document.getElementById('temp-val');
  const executionModeSelect = document.getElementById('execution-mode');

  btnToggleAdvanced.addEventListener('click', () => {
    const isHidden = advancedSettingsPanel.classList.toggle('hidden');
    advancedArrow.textContent = isHidden ? '▶' : '▼';
  });

  llmTemperature.addEventListener('input', () => {
    tempVal.textContent = llmTemperature.value;
  });

  // 7. Connect to SSE endpoint and handle live updates
  btnStart.addEventListener('click', () => {
    const project = projectSelect.value;
    const prompt = healInstructionsInput.value.trim();
    const mode = executionModeSelect.value;
    const model = llmModelSelect.value;
    const temp = llmTemperature.value;
    
    if (!project) {
      alert('Please select a project first!');
      return;
    }

    // Reset UI state
    btnStart.disabled = true;
    projectSelect.disabled = true;
    healInstructionsInput.disabled = true;
    btnStart.innerHTML = '<span class="spinner"></span> Running...';
    
    clearDiffs();
    setDiffLoadingState();
    terminal.innerHTML = '';
    
    // Reset and initialize timeline stepper
    resetStepper();
    updateStepperState('step-clone', 'active');
    
    agentState.textContent = 'THINKING';
    agentState.className = 'status-value running';
    currentAttempt.textContent = mode === 'docker' ? '0 / 3' : '1 / 1';
    containerStatus.textContent = mode === 'docker' ? 'Initializing...' : 'Active (Direct)';
    
    logLine(`Initiating self-healing stream (${mode} mode) for project ${project}...`, 'start');

    // Create SSE connection with all parameters
    const queryUrl = `/api/heal?project=${encodeURIComponent(project)}&prompt=${encodeURIComponent(prompt)}&mode=${encodeURIComponent(mode)}&model=${encodeURIComponent(model)}&temperature=${encodeURIComponent(temp)}`;
    eventSource = new EventSource(queryUrl);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'start':
          logLine(data.message, 'start');
          updateStepperState('step-clone', 'completed');
          updateStepperState('step-inspect', 'active');
          break;
          
        case 'container_starting':
          logLine(data.message, 'container');
          containerStatus.textContent = 'Starting Container...';
          updateStepperState('step-clone', 'completed');
          updateStepperState('step-inspect', 'active');
          break;
          
        case 'container_started':
          logLine(data.message, 'container');
          containerStatus.textContent = 'Running Tests...';
          updateStepperState('step-inspect', 'active');
          break;
          
        case 'attempt_start':
          logLine(data.message, 'info');
          break;
          
        case 'test_running':
          logLine(data.message, 'info');
          containerStatus.textContent = 'Running tests...';
          updateStepperState('step-inspect', 'active');
          break;
          
        case 'test_completed':
          logLine(data.message, 'info');
          updateStepperState('step-inspect', 'completed');
          updateStepperState('step-diagnose', 'active');
          break;
          
        case 'llm_starting':
          logLine(data.message, 'llm');
          containerStatus.textContent = 'Gemini debugging...';
          updateStepperState('step-inspect', 'completed');
          updateStepperState('step-diagnose', 'active');
          break;
          
        case 'llm_fixed':
          logLine(data.message, 'success');
          if (mode === 'docker') {
            currentAttempt.textContent = `${data.payload.attempt} / 3`;
            patchesStatus[data.payload.attempt] = 'applied'; // docker changes are applied directly
          }
          updateStepperState('step-diagnose', 'completed');
          updateStepperState('step-verify', 'active');
          // Add tab for this file's diff
          addAttemptTab(data.payload.attempt, data.payload.originalCode, data.payload.fixedCode);
          break;
          
        case 'llm_explanation':
          fixExplanation.textContent = data.payload.explanation;
          fixExplanationContainer.classList.remove('hidden');
          break;

        case 'done':
          logLine(`Finished! Result success status: ${data.payload.success}`, data.payload.success ? 'success' : 'failed');
          if (data.payload.success) {
            updateStepperState('step-verify', 'completed');
            updateStepperState('step-patch', 'completed');
          } else {
            updateStepperState('step-verify', 'failed');
            updateStepperState('step-patch', 'failed');
          }
          completeSession(data.payload.success ? 'SUCCESS' : 'FAILED');
          break;
          
        case 'error':
          logLine(`Error event: ${data.message}`, 'error');
          document.querySelectorAll('.step-item[data-status="active"]').forEach(el => updateStepperState(el.id, 'failed'));
          completeSession('FAILED');
          break;
          
        default:
          logLine(data.message, 'info');
      }
    };

    eventSource.onerror = (err) => {
      logLine('SSE Connection closed or encountered an error.', 'error');
      completeSession('FAILED');
    };
  });

  function completeSession(finalState) {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    
    // Update State
    agentState.textContent = finalState;
    agentState.className = `status-value ${finalState.toLowerCase()}`;
    containerStatus.textContent = 'Finished';

    // Re-enable inputs
    btnStart.disabled = false;
    projectSelect.disabled = false;
    healInstructionsInput.disabled = false;
    btnStart.innerHTML = '⚡ Go';

    if (diffContent.classList.contains('hidden')) {
      restoreDiffPlaceholder();
    }

    // Refresh backups and file tree
    loadBackups(projectSelect.value);
    loadFileExplorer(projectSelect.value);
  }

  // Logout handler
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('healer_logged_in');
      window.location.href = '/login';
    });
  }

  // Load project list initially
  loadProjects();
});
