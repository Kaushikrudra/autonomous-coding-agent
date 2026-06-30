document.addEventListener('DOMContentLoaded', () => {
  const taskInput = document.getElementById('task-input');
  const btnGenerate = document.getElementById('btn-generate');
  const btnCopy = document.getElementById('btn-copy');
  const btnRun = document.getElementById('btn-run');
  const btnDownload = document.getElementById('btn-download');
  
  const resultPlaceholder = document.getElementById('result-placeholder');
  const resultContent = document.getElementById('result-content');
  
  const languageBadge = document.getElementById('language-badge');
  const codeExplanation = document.getElementById('code-explanation');
  const codeOutput = document.getElementById('code-output');

  const tabBtnCode = document.getElementById('tab-btn-code');
  const tabBtnPreview = document.getElementById('tab-btn-preview');
  const codeViewContainer = document.getElementById('code-view-container');
  const previewViewContainer = document.getElementById('preview-view-container');
  const playgroundIframe = document.getElementById('playground-iframe');
  const playgroundConsole = document.getElementById('playground-console');
 
  const languagePills = document.querySelectorAll('#language-pills .lang-pill');
  let selectedLanguage = 'javascript';

  // Add click listener to pills
  languagePills.forEach(pill => {
    pill.addEventListener('click', () => {
      languagePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedLanguage = pill.dataset.value;
    });
  });

  // Helper to resolve file extensions
  function getExtension(lang) {
    switch (lang.toLowerCase()) {
      case 'javascript':
      case 'js':
        return 'js';
      case 'python':
      case 'py':
        return 'py';
      case 'cpp':
      case 'c++':
        return 'cpp';
      case 'java':
        return 'java';
      case 'go':
        return 'go';
      case 'rust':
      case 'rs':
        return 'rs';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      default:
        return 'txt';
    }
  }

  // 1. Generate Code click handler
  btnGenerate.addEventListener('click', async () => {
    const task = taskInput.value.trim();
    const language = selectedLanguage;

    if (!task) {
      alert('Please describe the code you want to generate first!');
      return;
    }

    // Set loading state
    btnGenerate.disabled = true;
    btnGenerate.innerHTML = '<span class="spinner"></span> Generating Code...';
    
    // Hide previous result and show placeholder
    resultContent.classList.add('hidden');
    languageBadge.classList.add('hidden');
    const playgroundTabs = document.getElementById('playground-tabs');
    if (playgroundTabs) playgroundTabs.classList.add('hidden');
    resultPlaceholder.innerHTML = '<span style="font-size: 2.5rem; margin-bottom: 1rem; animation: pulse 1s infinite;">🤖</span> Thinking and generating code...';
    resultPlaceholder.classList.remove('hidden');

    try {
      const response = await fetch('/api/generate-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ task, language })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Show result content
        codeExplanation.textContent = result.explanation;
        codeOutput.textContent = result.code;
        
        // Show and configure language badge
        languageBadge.textContent = result.language;
        languageBadge.classList.remove('hidden');

        // Toggle visibility
        resultPlaceholder.classList.add('hidden');
        resultContent.classList.remove('hidden');
        if (playgroundTabs) {
          playgroundTabs.classList.remove('hidden');
          const tabBtnCode = document.getElementById('tab-btn-code');
          if (tabBtnCode) tabBtnCode.click();
        }
      } else {
        showError(result.error || 'Failed to generate code from Gemini.');
      }
    } catch (err) {
      showError(`Connection error: ${err.message}`);
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.innerHTML = '✨ Generate Code';
    }
  });

  // 2. Copy Code to Clipboard handler
  btnCopy.addEventListener('click', () => {
    const codeText = codeOutput.textContent;
    if (!codeText) return;

    navigator.clipboard.writeText(codeText)
      .then(() => {
        const originalText = btnCopy.innerHTML;
        btnCopy.innerHTML = '✓ Copied!';
        btnCopy.style.background = 'var(--success-color)';
        
        setTimeout(() => {
          btnCopy.innerHTML = originalText;
          btnCopy.style.background = '';
        }, 2000);
      })
      .catch(err => {
        alert(`Failed to copy code: ${err.message}`);
      });
  });

  // 3. Download Code file
  btnDownload.addEventListener('click', () => {
    const codeText = codeOutput.textContent;
    if (!codeText) return;

    const ext = getExtension(selectedLanguage);
    const blob = new Blob([codeText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `generated_code.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // 4. Live Run Code in Sandbox
  function runSandboxCode() {
    const codeText = codeOutput.textContent;
    if (!codeText) return;

    const lang = selectedLanguage.toLowerCase();
    
    if (lang === 'html' || lang === 'css') {
      playgroundConsole.style.display = 'none';
      playgroundIframe.style.display = 'block';
      
      const iframeDoc = playgroundIframe.contentDocument || playgroundIframe.contentWindow.document;
      iframeDoc.open();
      if (lang === 'css') {
        iframeDoc.write(`<html><head><style>${codeText}</style></head><body style="font-family: sans-serif; padding: 1.5rem; background: #f3f4f6; color: #111827;"><h3>CSS Live Preview Styling</h3><p>Your generated styling stylesheet has been loaded in this preview frame.</p></body></html>`);
      } else {
        iframeDoc.write(codeText);
      }
      iframeDoc.close();
    } else if (lang === 'javascript' || lang === 'js') {
      playgroundIframe.style.display = 'none';
      playgroundConsole.style.display = 'block';
      playgroundConsole.innerHTML = '';
      
      const logLines = [];
      const customLog = (...args) => {
        logLines.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '));
      };

      try {
        const runFn = new Function('console', codeText);
        runFn({ log: customLog, error: customLog, warn: customLog, info: customLog });
        
        playgroundConsole.innerHTML = logLines.length > 0 
          ? logLines.map(line => `<div class="terminal-line" style="color: #a7f3d0; margin-bottom: 0.25rem;">${line}</div>`).join('')
          : '<div class="terminal-line" style="color: var(--text-secondary); font-style: italic;">Script executed successfully with no output logs.</div>';
      } catch (err) {
        playgroundConsole.innerHTML = `<div class="terminal-line error" style="color: #f43f5e; font-weight: bold;">[Runtime Exception] ${err.message}</div>`;
      }
    } else {
      playgroundIframe.style.display = 'none';
      playgroundConsole.style.display = 'block';
      playgroundConsole.innerHTML = `
        <div class="terminal-line" style="color: #fbbf24; font-weight: bold; margin-bottom: 0.5rem;">
          ⚠️ Browser Sandbox Limit reached
        </div>
        <div class="terminal-line" style="color: var(--text-secondary);">
          Live browser execution is only supported for client languages (HTML, CSS, JavaScript).
        </div>
        <div class="terminal-line" style="color: var(--text-secondary); margin-top: 0.5rem;">
          To run ${selectedLanguage.toUpperCase()} code, please click the "Download" button to run the code locally.
        </div>
      `;
    }
  }

  // Hook run button to switch tab to preview
  btnRun.addEventListener('click', () => {
    if (tabBtnPreview) {
      tabBtnPreview.click();
    } else {
      runSandboxCode();
    }
  });

  // Tab switching logic
  if (tabBtnCode && tabBtnPreview) {
    tabBtnCode.addEventListener('click', () => {
      tabBtnCode.classList.add('active');
      tabBtnCode.style.background = 'var(--primary-color)';
      tabBtnCode.style.color = '#fff';
      
      tabBtnPreview.classList.remove('active');
      tabBtnPreview.style.background = 'transparent';
      tabBtnPreview.style.color = 'var(--text-secondary)';
      
      codeViewContainer.classList.remove('hidden');
      previewViewContainer.classList.add('hidden');
    });

    tabBtnPreview.addEventListener('click', () => {
      tabBtnPreview.classList.add('active');
      tabBtnPreview.style.background = 'var(--primary-color)';
      tabBtnPreview.style.color = '#fff';
      
      tabBtnCode.classList.remove('active');
      tabBtnCode.style.background = 'transparent';
      tabBtnCode.style.color = 'var(--text-secondary)';
      
      codeViewContainer.classList.add('hidden');
      previewViewContainer.classList.remove('hidden');
      
      runSandboxCode();
    });
  }

  // Helper to show errors
  function showError(msg) {
    resultContent.classList.add('hidden');
    const playgroundTabs = document.getElementById('playground-tabs');
    if (playgroundTabs) playgroundTabs.classList.add('hidden');
    resultPlaceholder.innerHTML = `
      <span style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--error-color);">❌</span>
      <span style="color: var(--error-color); font-weight: 600;">Error</span>
      <p style="margin-top: 0.5rem; max-width: 400px; font-size: 0.9rem;">${msg}</p>
    `;
    resultPlaceholder.classList.remove('hidden');
  }

  // Logout handler
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('healer_logged_in');
      window.location.href = '/login';
    });
  }
});
