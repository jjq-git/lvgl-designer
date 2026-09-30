import { describe, expect, it } from 'vitest';
import {
  getAppDialogSnapshot,
  requestConfirmation,
  requestText,
  resolveAppDialog,
} from './appDialogs';

describe('appDialogs', () => {
  it('serializes dialog requests and resolves them in order', async () => {
    const confirmation = requestConfirmation({ title: '确认删除', danger: true });
    const prompt = requestText({ title: '重命名', defaultValue: '旧名称' });

    expect(getAppDialogSnapshot()).toMatchObject({ kind: 'confirm', title: '确认删除' });
    resolveAppDialog(true);
    await expect(confirmation).resolves.toBe(true);

    expect(getAppDialogSnapshot()).toMatchObject({
      kind: 'prompt',
      title: '重命名',
      defaultValue: '旧名称',
    });
    resolveAppDialog('新名称');
    await expect(prompt).resolves.toBe('新名称');
    expect(getAppDialogSnapshot()).toBeNull();
  });

  it('preserves prompt cancellation', async () => {
    const prompt = requestText({ title: '输入名称' });
    resolveAppDialog(null);
    await expect(prompt).resolves.toBeNull();
  });
});
