import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keep keyboard focus inside a modal and restore it to the opener on close. */
export function useDialogFocus<T extends HTMLElement>(
  onClose: () => void,
  canClose = true,
): RefObject<T> {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  closeRef.current = onClose;
  canCloseRef.current = canClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((element) => element.getClientRects().length > 0);
    (focusable()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      const modalDialogs = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')];
      if (modalDialogs.at(-1) !== dialog) return;
      if (event.key === 'Escape' && canCloseRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return dialogRef;
}
