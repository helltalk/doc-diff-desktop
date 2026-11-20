'use strict';

/** 帮助弹窗：由原生菜单「帮助」与渲染层「帮助」按钮共用。 */

const { BrowserWindow, dialog } = require('electron');
const { HELP_TITLE, HELP_TEXT, ABOUT_TITLE, ABOUT_TEXT } = require('../shared/help-text');

/**
 * 显示帮助或关于对话框。
 * @param {'help'|'about'} kind
 * @returns {Promise<null>}
 */
async function show(kind) {
  const isAbout = kind === 'about';
  const parent = BrowserWindow.getFocusedWindow ? BrowserWindow.getFocusedWindow() : null;
  await dialog.showMessageBox(parent || null, {
    type: 'info',
    title: isAbout ? ABOUT_TITLE : HELP_TITLE,
    message: isAbout ? ABOUT_TITLE : HELP_TITLE,
    detail: isAbout ? ABOUT_TEXT : HELP_TEXT,
    buttons: ['知道了'],
    defaultId: 0,
    noLink: true,
    width: 620,
    normalizeAccessKeys: true
  });
  return null;
}

module.exports = { show };
