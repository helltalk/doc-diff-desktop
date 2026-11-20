'use strict';

/** 主进程服务层统一错误构造：附带可在 IPC 层直接透传的 code 字段。 */
function serviceError(code, message, cause) {
  const error = new Error(String(message || '操作失败'));
  error.code = code;
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

module.exports = { serviceError };
