'use strict';

/**
 * LibreOffice 无头转换服务。
 * 关键点：
 *  - 检测顺序：注册表 → 固定安装路径 → PATH
 *  - 每次转换独立临时目录 + 独立隔离 profile（file:/// URL）
 *  - spawn 使用参数数组，中文/空格/UNC 路径均安全
 *  - finally 中 taskkill 进程树并删除临时目录
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { CONVERT_TIMEOUT_MS, ERR } = require('../shared/constants');
const { serviceError } = require('./service-error');

const FIXED_PATHS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
];

const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
];

const FILTERS = Object.freeze({
  docx: 'docx:MS Word 2007 XML',
  xlsx: 'xlsx:Calc MS Excel 2007 XML'
});

/** 检测缓存，避免每次转换都跑一遍注册表查询。 */
let cachedDetection = null;

/** 本模块产出的持久化转换结果文件前缀，便于启动时清理陈旧文件。 */
const OUTPUT_PREFIX = 'docdiff-converted-';

/**
 * 从注册表卸载项中收集 LibreOffice 安装路径。
 * @returns {string[]} 候选 soffice.exe 路径
 */
function registryCandidates() {
  const candidates = [];
  if (process.platform !== 'win32') return candidates;

  for (const key of REGISTRY_KEYS) {
    let output = '';
    try {
      output = execFileSync('reg', ['query', key, '/s'], {
        encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch (err) {
      continue;
    }
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*(InstallLocation|DisplayIcon)\s+REG_SZ\s+(.+)$/i);
      if (!match) continue;
      let value = match[2].trim().replace(/^"|"$/g, '');
      if (/libreoffice/i.test(value) === false) continue;
      if (path.extname(value).toLowerCase() === '.exe') {
        candidates.push(value);
        const programDir = path.dirname(value);
        candidates.push(path.join(programDir, 'soffice.exe'));
      } else {
        candidates.push(path.join(value, 'program', 'soffice.exe'));
      }
    }
  }
  return candidates;
}

/** 从 PATH 中查找 soffice。 */
function pathCandidates() {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const target = process.platform === 'win32' ? 'soffice.exe' : 'soffice';
  try {
    const output = execFileSync(command, [target], {
      encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

/** 运行 soffice --version 取版本号。 */
function readVersion(sofficePath) {
  // Windows 下 soffice.exe 是 GUI 子系统进程，--version 不会写 stdout；
  // 同目录的 soffice.com 才是控制台入口，优先使用它取版本号。
  const candidates = [sofficePath];
  if (process.platform === 'win32' && path.extname(sofficePath).toLowerCase() === '.exe') {
    candidates.unshift(path.join(path.dirname(sofficePath), 'soffice.com'));
  }
  for (const candidate of candidates) {
    try {
      const output = execFileSync(candidate, ['--version'], {
        encoding: 'utf8', timeout: 6000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
      });
      const match = String(output).match(/LibreOffice\s+([0-9][0-9.]*)/i);
      if (match) return match[1];
      const firstLine = String(output).split(/\r?\n/)[0].trim();
      if (firstLine) return firstLine;
    } catch (err) {
      // 尝试下一个候选
    }
  }
  console.warn('[converter] 无法读取 LibreOffice 版本号。');
  return '未知版本';
}

/**
 * 检测 LibreOffice。返回对象而非抛错，便于渲染进程展示「未安装」状态。
 * @returns {{installed:boolean,path?:string,version?:string}}
 */
function detect() {
  if (cachedDetection) return Object.assign({}, cachedDetection);

  const candidates = []
    .concat(registryCandidates())
    .concat(FIXED_PATHS)
    .concat(pathCandidates());

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());
    try {
      if (!fs.statSync(candidate).isFile()) continue;
    } catch (err) {
      continue;
    }
    const version = readVersion(candidate);
    cachedDetection = { installed: true, path: candidate, version: version };
    return Object.assign({}, cachedDetection);
  }

  cachedDetection = { installed: false };
  cleanupStaleOutputs();
  return Object.assign({}, cachedDetection);
}

/** 清理由本模块产出、超过 1 小时的陈旧结果文件。 */
function cleanupStaleOutputs() {
  const now = Date.now();
  let entries = [];
  try {
    entries = fs.readdirSync(os.tmpdir(), { withFileTypes: true });
  } catch (err) {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.indexOf(OUTPUT_PREFIX) !== 0) continue;
    const full = path.join(os.tmpdir(), entry.name);
    try {
      if (now - fs.statSync(full).mtimeMs > 60 * 60 * 1000) fs.unlinkSync(full);
    } catch (err) {
      // 清理失败不影响主流程
    }
  }
}

/** 强制结束进程树（Windows 下 taskkill /T /F）。 */
function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true, timeout: 5000, stdio: 'ignore'
      });
    } catch (err) {
      console.warn('[converter] taskkill 失败：', err.message);
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (err) {
      // 进程可能已退出
    }
  }
}

/**
 * 将 LibreOffice 输出文件转存到稳定临时路径，随后原工作目录会被删除。
 * @param {string} sourcePath 工作目录中的输出文件
 * @param {string} targetFormat 目标扩展名
 * @returns {string} 稳定临时路径
 */
function persistOutput(sourcePath, targetFormat) {
  const unique = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const destination = path.join(os.tmpdir(), OUTPUT_PREFIX + unique + '.' + targetFormat);
  fs.copyFileSync(sourcePath, destination);
  return destination;
}

/**
 * 在工作目录中寻找唯一输出文件。
 * LibreOffice 可能改写中文文件名，因此按扩展名扫描而非按原名拼接。
 */
function findOutput(outDir, targetFormat) {
  let entries = [];
  try {
    entries = fs.readdirSync(outDir, { withFileTypes: true });
  } catch (err) {
    throw serviceError(ERR.CONVERT_NO_OUTPUT, '无法读取转换结果目录：' + err.message, err);
  }
  const matched = entries.filter(function (entry) {
    return entry.isFile() && entry.name.toLowerCase().endsWith('.' + targetFormat);
  }).map(function (entry) { return path.join(outDir, entry.name); });

  if (matched.length === 0) {
    throw serviceError(ERR.CONVERT_NO_OUTPUT, 'LibreOffice 未生成任何 ' + targetFormat.toUpperCase() + ' 输出文件。');
  }
  return matched[0];
}

/**
 * 执行转换。
 * @param {string} inputPath 输入文件路径（可 UNC）
 * @param {'docx'|'xlsx'} targetFormat 目标格式
 * @param {string|number} jobId 任务标识，用于进度事件关联
 * @param {Function} onProgress 进度回调 (payload)=>void
 * @returns {Promise<{outputPath:string}>}
 */
async function convert(inputPath, targetFormat, jobId, onProgress) {
  const format = String(targetFormat || '').toLowerCase();
  const filter = FILTERS[format];
  if (!filter) {
    throw serviceError(ERR.CONVERT_FAILED, '不支持的转换目标格式：' + targetFormat);
  }

  if (!inputPath || typeof inputPath !== 'string') {
    throw serviceError(ERR.FILE_NOT_FOUND, '未提供待转换文件路径。');
  }
  try {
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch (err) {
    throw serviceError(ERR.FILE_NOT_FOUND, '待转换文件不存在或不可读：' + inputPath, err);
  }

  const detection = detect();
  if (!detection.installed) {
    throw serviceError(ERR.LO_MISSING, '未检测到 LibreOffice。请先安装 LibreOffice（https://www.libreoffice.org/）后重试。');
  }

  const emit = function (phase, percent, message) {
    if (typeof onProgress === 'function') {
      onProgress({ jobId: jobId, phase: phase, percent: percent, message: message });
    }
  };

  emit('start', 10, '正在启动 LibreOffice 转换服务…');

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docdiff-'));
  const profile = pathToFileURL(path.join(outDir, 'profile')).href;
  const args = [
    '--headless',
    '--norestore',
    '--nolockcheck',
    '--nodefault',
    '--nofirststartwizard',
    '-env:UserInstallation=' + profile,
    '--convert-to', filter,
    '--outdir', outDir,
    inputPath
  ];

  let child = null;
  let timedOut = false;
  let finished = false;
  let stderrText = '';
  let outputPath = null;

  try {
    emit('spawning', 30, '正在读取并转换文档…');
    child = spawn(detection.path, args, { windowsHide: true });

    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', function (chunk) {
        stderrText += String(chunk);
        if (stderrText.length > 4000) stderrText = stderrText.slice(-4000);
      });
    }

    await new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        timedOut = true;
        emit('error', 100, '转换超时（超过 60 秒），已中止。');
        killProcessTree(child.pid);
      }, CONVERT_TIMEOUT_MS);

      child.on('error', function (err) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(serviceError(ERR.CONVERT_FAILED, '启动 LibreOffice 失败：' + err.message, err));
      });

      child.on('close', function (code) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (timedOut) {
          reject(serviceError(ERR.CONVERT_TIMEOUT, '转换超时（超过 60 秒）。'));
        } else if (code !== 0) {
          reject(serviceError(ERR.CONVERT_FAILED,
            'LibreOffice 转换失败（退出码 ' + code + '）。' + (stderrText ? ' 详情：' + stderrText.trim() : '')));
        } else {
          resolve();
        }
      });
    });

    emit('finalizing', 70, '正在整理转换结果…');
    const rawOutput = findOutput(outDir, format);
    outputPath = persistOutput(rawOutput, format);
    emit('done', 100, '转换完成。');

    return { outputPath: outputPath };
  } finally {
    // 仅在进程仍存活时结束进程树，避免对已回收 PID 重复 taskkill。
    if (child && child.pid && child.exitCode === null && child.signalCode === null) {
      killProcessTree(child.pid);
    }
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('[converter] 清理临时目录失败：' + outDir, err.message);
    }
  }
}

module.exports = { detect, convert, registryCandidates, pathCandidates, findOutput, OUTPUT_PREFIX };
