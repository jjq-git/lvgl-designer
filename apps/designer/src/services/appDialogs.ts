export type AppDialogRequest = {
  id: number;
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  label?: string;
  inputType?: 'text' | 'password';
  defaultValue?: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (value: boolean | string | null) => void;
};

type DialogOptions = Omit<AppDialogRequest, 'id' | 'kind' | 'resolve' | 'confirmLabel'> & {
  confirmLabel?: string;
};

let nextId = 1;
let current: AppDialogRequest | null = null;
const queue: AppDialogRequest[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function enqueue<T extends boolean | string | null>(
  kind: AppDialogRequest['kind'],
  options: DialogOptions,
): Promise<T> {
  return new Promise((resolve) => {
    queue.push({
      ...options,
      id: nextId++,
      kind,
      confirmLabel: options.confirmLabel ?? (kind === 'confirm' ? '确认' : '确定'),
      resolve: resolve as (value: boolean | string | null) => void,
    });
    if (!current) {
      current = queue.shift() ?? null;
      notify();
    }
  });
}

export function requestConfirmation(options: DialogOptions): Promise<boolean> {
  return enqueue<boolean>('confirm', options);
}

export function requestText(options: DialogOptions): Promise<string | null> {
  return enqueue<string | null>('prompt', options);
}

export function subscribeAppDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAppDialogSnapshot(): AppDialogRequest | null {
  return current;
}

export function resolveAppDialog(value: boolean | string | null): void {
  const request = current;
  if (!request) return;
  current = queue.shift() ?? null;
  request.resolve(value);
  notify();
}
