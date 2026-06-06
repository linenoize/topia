/**
 * Detect agora-memory MCP registration and optional agora-code CLI.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function readMcpConfigs(projectRoot) {
  const paths = [
    path.join(projectRoot, '.cursor', 'mcp.json'),
    path.join(projectRoot, '.mcp.json'),
    path.join(os.homedir(), '.cursor', 'mcp.json'),
  ];
  const texts = [];
  for (const configPath of paths) {
    if (!fs.existsSync(configPath)) continue;
    try {
      texts.push(fs.readFileSync(configPath, 'utf-8'));
    } catch { /* ignore */ }
  }
  return texts.join('\n');
}

function isAgoraMemoryRegistered(projectRoot) {
  const raw = readMcpConfigs(projectRoot);
  return /agora[-_]?code|"agora-memory"/i.test(raw);
}

function isAgoraCommitLearnEnabled(projectRoot) {
  if (process.env.TOPIA_AGORA_COMMIT_LEARN === '1') return true;
  const flag = path.join(projectRoot, '.topia', 'agora-commit-learn.flag');
  return fs.existsSync(flag);
}

function agoraCodeOnPath() {
  const winCmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(winCmd, ['agora-code'], { encoding: 'utf-8' });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

module.exports = {
  readMcpConfigs,
  isAgoraMemoryRegistered,
  isAgoraCommitLearnEnabled,
  agoraCodeOnPath,
};
