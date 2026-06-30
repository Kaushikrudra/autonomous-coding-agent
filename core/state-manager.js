const fs = require('fs');
const path = require('path');

class StateManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.attempts = 0;
    this.status = 'idle'; // idle, running, success, failed
    this.backupDir = path.join(this.projectPath, '.healer_backups');
  }

  start() {
    this.attempts = 0;
    this.status = 'running';
  }

  incrementAttempts() {
    this.attempts++;
  }

  /**
   * Creates a backup on the disk in .healer_backups
   * @param {string} relativeFilePath 
   */
  backupFile(relativeFilePath) {
    const absolutePath = path.resolve(this.projectPath, relativeFilePath);
    if (!fs.existsSync(absolutePath)) return;

    const content = fs.readFileSync(absolutePath, 'utf8');
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const timestamp = Date.now();
    const safeFileName = relativeFilePath.replace(/[^a-zA-Z0-9]/g, '_');
    const backupFileName = `${timestamp}_${safeFileName}.bak`;
    const backupFilePath = path.join(this.backupDir, backupFileName);

    // Save backup metadata and content
    fs.writeFileSync(backupFilePath, content, 'utf8');

    // Also write a meta JSON mapping timestamps to original files
    const metaPath = path.join(this.backupDir, 'meta.json');
    let meta = {};
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch (_) {}
    }
    meta[timestamp] = {
      relativeFilePath,
      backupFile: backupFileName,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    console.log(`Backed up current state of ${relativeFilePath} to ${backupFileName}`);
  }

  /**
   * Restores the last backed up version of a file.
   * @param {string} relativeFilePath 
   * @returns {boolean} Whether restoration succeeded
   */
  restoreLast(relativeFilePath) {
    const metaPath = path.join(this.backupDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return false;

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const entries = Object.entries(meta)
        .map(([ts, details]) => ({ timestamp: Number(ts), ...details }))
        .filter(e => e.relativeFilePath === relativeFilePath)
        .sort((a, b) => b.timestamp - a.timestamp);

      if (entries.length > 0) {
        const lastBackup = entries[0];
        const backupFilePath = path.join(this.backupDir, lastBackup.backupFile);
        if (fs.existsSync(backupFilePath)) {
          const content = fs.readFileSync(backupFilePath, 'utf8');
          const absolutePath = path.resolve(this.projectPath, relativeFilePath);
          fs.writeFileSync(absolutePath, content, 'utf8');
          console.log(`Restored ${relativeFilePath} from backup.`);
          return true;
        }
      }
    } catch (err) {
      console.error('Restore failed:', err);
    }
    return false;
  }
}

module.exports = StateManager;
