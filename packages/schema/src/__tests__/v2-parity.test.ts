/**
 * 对账测试:zod 模型(schemas.ts,结构层单一事实源)↔ 手写 interface(profiles/uiProject/...)。
 *
 * 为什么需要:JSON Schema 由 zod 生成,但业务代码用的是带注释的 interface。
 * 两者一旦漂移,校验通过的 JSON 在 TS 里可能仍是错的。下面的 Assignable 断言在
 * **typecheck 阶段**就会失败,不用等运行时。
 *
 * 外加 refs.ts 的行为测试:引用格式是跨对象一致性的地基,写错会一路错到构建 manifest。
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod/v4';
import type {
  zBuildTarget, zControllerProfile, zDisplayProfile, zFirmwareProfile, zInputProfile,
  zTrustedExtension, zUiProject,
} from '../v2/schemas.js';
import type {
  BuildTarget, ControllerProfile, DisplayProfile, FirmwareProfile, InputProfile,
} from '../v2/profiles.js';
import type { UiProject } from '../v2/uiProject.js';
import type { TrustedExtensionManifest } from '../v2/trustedExtension.js';
import {
  formatRef, formatThemeRef, isRefOfKind, parseRef, parseThemeRef, sameObject,
} from '../v2/refs.js';
import { deriveOrientation, effectiveVisibleRect } from '../v2/profiles.js';
import { resolveTheme } from '../v2/theme.js';

/* -------------------------------------------------- 编译期类型一致性断言 */

/** A 可赋给 B 时为 true;否则触发类型错误 */
type Assignable<A, B> = A extends B ? true : { error: 'not assignable'; a: A; b: B };
const assertAssignable = <A, B>(_ok: Assignable<A, B>): void => { /* 仅编译期 */ };

/* 双向可赋值:结构完全对齐的对象 */
assertAssignable<z.infer<typeof zDisplayProfile>, DisplayProfile>(true);
assertAssignable<DisplayProfile, z.infer<typeof zDisplayProfile>>(true);

assertAssignable<z.infer<typeof zInputProfile>, InputProfile>(true);
assertAssignable<InputProfile, z.infer<typeof zInputProfile>>(true);

assertAssignable<z.infer<typeof zFirmwareProfile>, FirmwareProfile>(true);
assertAssignable<FirmwareProfile, z.infer<typeof zFirmwareProfile>>(true);

assertAssignable<z.infer<typeof zTrustedExtension>, TrustedExtensionManifest>(true);
assertAssignable<TrustedExtensionManifest, z.infer<typeof zTrustedExtension>>(true);

/*
 * 单向可赋值(interface → zod):凡是 interface 侧用了**模板字面量类型**的对象。
 *
 *   BuildTarget.uiProjectRef        : `ui:${string}@${number}`      ← zod 推导只到 string
 *   ControllerProfile.frame.assetRef: `asset:${string}@sha256:...`  ← 同上
 *
 * 反向不成立是有意为之:引用格式的收窄靠运行时正则(schemas.ts 的 refPattern),
 * 不靠 z.infer。这里只保证「代码构造得出的对象一定能通过结构校验」,
 * 反过来「校验通过的字符串是合法引用」由 refs.ts 的 parseRef 在语义层负责。
 */
assertAssignable<BuildTarget, z.infer<typeof zBuildTarget>>(true);
assertAssignable<ControllerProfile, z.infer<typeof zControllerProfile>>(true);
assertAssignable<UiProject['meta'], z.infer<typeof zUiProject>['meta']>(true);

describe('类型一致性', () => {
  it('编译通过即代表 zod 模型与 interface 未漂移', () => {
    expect(true).toBe(true);
  });
});

/* ---------------------------------------------------------------- refs */

describe('引用格式', () => {
  it('解析 kind:slug@revision', () => {
    expect(parseRef('display:800x480-rgb565@12')).toEqual({
      kind: 'display', slug: '800x480-rgb565', revision: 12,
    });
  });

  it('拒绝缺 revision / 未知 kind / 非法 slug', () => {
    expect(parseRef('display:800x480')).toBeNull();
    expect(parseRef('gizmo:x@1')).toBeNull();
    expect(parseRef('display:-bad@1')).toBeNull();
    expect(parseRef('display:Upper@1')).toBeNull();
  });

  it('拒绝 revision 前导零 —— 否则 @01 与 @1 指同一对象却字面不等,不能当 Map key', () => {
    expect(parseRef('display:x@01')).toBeNull();
    expect(parseRef('display:x@0')).toBeNull();
  });

  it('formatRef 与 parseRef 互逆', () => {
    const r = formatRef('controller', 'ctrl-430-a', 3);
    expect(r).toBe('controller:ctrl-430-a@3');
    expect(parseRef(r)).toEqual({ kind: 'controller', slug: 'ctrl-430-a', revision: 3 });
  });

  it('isRefOfKind 区分类型', () => {
    expect(isRefOfKind('display:x@1', 'display')).toBe(true);
    expect(isRefOfKind('display:x@1', 'controller')).toBe(false);
  });

  it('themeRef 是 uiRef + fragment', () => {
    const t = formatThemeRef('ui:demo@1', 'customer-a-dark');
    expect(t).toBe('ui:demo@1#theme:customer-a-dark');
    expect(parseThemeRef(t)).toEqual({ ui: 'ui:demo@1', themeId: 'customer-a-dark' });
  });

  it('themeRef 的 ui 部分非法或 themeId 为空 → null', () => {
    expect(parseThemeRef('display:x@1#theme:a')).toBeNull();
    expect(parseThemeRef('ui:demo@1#theme:')).toBeNull();
    expect(parseThemeRef('ui:demo@1')).toBeNull();
  });

  it('sameObject 忽略 revision', () => {
    expect(sameObject('display:x@1', 'display:x@7')).toBe(true);
    expect(sameObject('display:x@1', 'display:y@1')).toBe(false);
    expect(sameObject('display:x@1', 'controller:x@1')).toBe(false);
  });
});

/* ------------------------------------------------------- DisplayProfile */

describe('DisplayProfile 派生值', () => {
  const base: DisplayProfile = {
    schemaVersion: 1, kind: 'display-profile', id: 'display:d', revision: 1,
    logicalSize: { width: 480, height: 960 }, shape: 'rect', colorFormat: 'RGB565',
  };

  it('orientation 考虑安装旋转,不是简单比 width > height(§4.2)', () => {
    expect(deriveOrientation(base)).toBe('portrait');
    expect(deriveOrientation({ ...base, installRotation: 90 })).toBe('landscape');
    expect(deriveOrientation({ ...base, installRotation: 180 })).toBe('portrait');
    expect(deriveOrientation({ ...base, logicalSize: { width: 480, height: 480 } })).toBe('square');
  });

  it('visibleRect 缺省即全屏', () => {
    expect(effectiveVisibleRect(base)).toEqual({ x: 0, y: 0, width: 480, height: 960 });
    const strip = { ...base, visibleRect: { x: 60, y: 0, width: 360, height: 960 } };
    expect(effectiveVisibleRect(strip)).toEqual({ x: 60, y: 0, width: 360, height: 960 });
  });
});

/* ---------------------------------------------------------------- Theme */

describe('resolveTheme', () => {
  const themes = [
    { id: 'base', tokens: [
      { id: 'color.bg', type: 'color' as const, value: '#000' },
      { id: 'color.fg', type: 'color' as const, value: '#888' },
    ] },
    { id: 'dark', extends: 'base', tokens: [{ id: 'color.fg', type: 'color' as const, value: '#fff' }] },
  ];

  it('子覆盖父,未覆盖的继承', () => {
    const m = resolveTheme(themes, 'dark');
    expect(m?.get('color.fg')?.value).toBe('#fff');
    expect(m?.get('color.bg')?.value).toBe('#000');
  });

  it('成环 / 父不存在 / theme 不存在 → null,不静默降级', () => {
    expect(resolveTheme([{ id: 'a', extends: 'b', tokens: [] }, { id: 'b', extends: 'a', tokens: [] }], 'a')).toBeNull();
    expect(resolveTheme([{ id: 'a', extends: 'ghost', tokens: [] }], 'a')).toBeNull();
    expect(resolveTheme(themes, 'nope')).toBeNull();
  });
});
