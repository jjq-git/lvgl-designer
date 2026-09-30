import { useState, useSyncExternalStore } from 'react';
import {
  getAppDialogSnapshot,
  resolveAppDialog,
  subscribeAppDialog,
  type AppDialogRequest,
} from '../services/appDialogs';
import { useDialogFocus } from './useDialogFocus';

export function AppDialogHost(): JSX.Element | null {
  const dialog = useSyncExternalStore(
    subscribeAppDialog,
    getAppDialogSnapshot,
    getAppDialogSnapshot,
  );
  return dialog ? <AppDialogSurface key={dialog.id} dialog={dialog} /> : null;
}

function AppDialogSurface({ dialog }: { dialog: AppDialogRequest }): JSX.Element {
  const [value, setValue] = useState(dialog.defaultValue ?? '');
  const cancel = (): void => resolveAppDialog(dialog.kind === 'confirm' ? false : null);
  const dialogRef = useDialogFocus<HTMLDivElement>(cancel);
  const submit = (): void => resolveAppDialog(dialog.kind === 'confirm' ? true : value);

  return (
    <div className="app-dialog-mask" onPointerDown={(event) => event.target === event.currentTarget && cancel()}>
      <div
        ref={dialogRef}
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`app-dialog-title-${dialog.id}`}
        tabIndex={-1}
      >
        <h2 id={`app-dialog-title-${dialog.id}`}>{dialog.title}</h2>
        {dialog.message && <p>{dialog.message}</p>}
        {dialog.kind === 'prompt' && (
          <label className="app-dialog-field">
            <span>{dialog.label ?? '名称'}</span>
            <input
              className="ed-text"
              type={dialog.inputType ?? 'text'}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submit();
              }}
            />
          </label>
        )}
        <div className="app-dialog-actions">
          <button type="button" className="btn" onClick={cancel}>取消</button>
          <button
            type="button"
            className={`btn ${dialog.danger ? 'danger' : 'primary'}`}
            onClick={submit}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
