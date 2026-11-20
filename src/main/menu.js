'use strict';

/** 应用菜单：全部使用中文标签，并提供「帮助」入口。 */

const { Menu } = require('electron');
const help = require('./help');

/** 生成菜单模板（导出便于单元测试）。 */
function buildTemplate() {
  return [
    {
      label: '文件',
      submenu: [
        { label: '打印…', role: 'print', accelerator: 'Ctrl+P' },
        { type: 'separator' },
        { label: '退出', role: 'quit', accelerator: 'Alt+F4' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo', accelerator: 'Ctrl+Z' },
        { label: '重做', role: 'redo', accelerator: 'Ctrl+Y' },
        { type: 'separator' },
        { label: '剪切', role: 'cut', accelerator: 'Ctrl+X' },
        { label: '复制', role: 'copy', accelerator: 'Ctrl+C' },
        { label: '粘贴', role: 'paste', accelerator: 'Ctrl+V' },
        { label: '全选', role: 'selectAll', accelerator: 'Ctrl+A' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload', accelerator: 'Ctrl+R' },
        { label: '实际大小', role: 'resetZoom', accelerator: 'Ctrl+0' },
        { label: '放大', role: 'zoomIn', accelerator: 'Ctrl+=' },
        { label: '缩小', role: 'zoomOut', accelerator: 'Ctrl+-' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen', accelerator: 'F11' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize', accelerator: 'Ctrl+M' },
        { label: '关闭', role: 'close', accelerator: 'Ctrl+W' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用说明', accelerator: 'F1', click: function () { help.show('help'); } },
        { label: '关于', click: function () { help.show('about'); } }
      ]
    }
  ];
}

/** 安装中文应用菜单。 */
function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
}

module.exports = { buildTemplate, installApplicationMenu };
