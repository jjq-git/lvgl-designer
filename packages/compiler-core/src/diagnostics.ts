/**
 * 诊断类型(normalize / preview / emitters 共用)。
 */
export interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;                 // 'E_DANGLING_SUBJECT' 等
  message: string;
  nodeId?: string;
}
