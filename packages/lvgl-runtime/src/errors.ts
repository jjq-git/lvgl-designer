import type { LogLine } from './types';

/** 桥调用失败/日志聚合错误。message 尾部附 lv 日志行。 */
export class LvglError extends Error {
  logLines: LogLine[];

  constructor(message: string, logLines: LogLine[] = []) {
    const tail = logLines.length
      ? '\n' + logLines.map((l) => `  [lv:${l.level}] ${l.msg}`).join('\n')
      : '';
    super(message + tail);
    this.name = 'LvglError';
    this.logLines = logLines;
  }
}
