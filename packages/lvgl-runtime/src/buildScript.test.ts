/**
 * runtime/build.sh 的参数处理与失败路径测试。
 *
 * 为什么值得测:旧版脚本把 emsdk 路径写死到单台机器,且失败被 `2>/dev/null` 吞掉,
 * 换台机器的表现是「emcmake 报一个看不懂的错」。新版把每条失败路径都做成显式退出,
 * 本文件锁住这些行为 —— 它们全部**不需要 emsdk / cmake**,所以离线机器也能跑。
 *
 * 真正的编译结果无法在这里验证(需要 emsdk),那部分由 D3/D4 实机验证覆盖,
 * 见 docs/lvgl-version-baseline.md §5。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('../../../runtime/build.sh', import.meta.url));

// Windows 自带的 system32/bash.exe 是 WSL 入口，不会自动识别传入的 Windows
// 绝对路径；优先使用 Git Bash，并把临时目录转换为它能识别的 /x/... 形式。
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const bashCommand = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';
const bashPath = (path: string): string => {
  if (bashCommand === 'bash') return path;
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  return match === null ? path : `/${match[1]!.toLowerCase()}/${match[2]!.replaceAll('\\', '/')}`;
};

/** git-bash / WSL / Linux 都有 bash;纯 Windows CI 上没有就跳过,不制造假红灯 */
const hasBash = spawnSync(bashCommand, ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0;

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 造一个假的 LVGL 源码树:脚本只看 lvgl.h 是否存在 + lv_version.h 里的三个宏 */
function fakeLvgl(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lvd-lvgl-'));
  tmpDirs.push(dir);
  const [maj, min, pat] = version.split('.');
  writeFileSync(join(dir, 'lvgl.h'), '/* fake */\n');
  writeFileSync(join(dir, 'lv_version.h'),
    `#define LVGL_VERSION_MAJOR ${maj}\n#define LVGL_VERSION_MINOR ${min}\n#define LVGL_VERSION_PATCH ${pat}\n`);
  return dir;
}

interface Run { code: number; out: string; err: string }

function run(args: string[], env: Record<string, string> = {}): Run {
  const normalizedEnv = { ...env };
  if (normalizedEnv.LVGL_DIR !== undefined) normalizedEnv.LVGL_DIR = bashPath(normalizedEnv.LVGL_DIR);
  const r = spawnSync(bashCommand, [bashPath(scriptPath), ...args], {
    encoding: 'utf8',
    // 清掉可能存在的真 emsdk,让测试结果与开发机状态无关
    env: { ...process.env, EMSDK_DIR: '/nonexistent-emsdk', ...normalizedEnv },
  });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

describe.skipIf(!hasBash)('runtime/build.sh 参数处理', () => {
  it('--help 打印用法并成功退出', () => {
    const r = run(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('--check');
    expect(r.out).toContain('EMSDK_DIR');
  });

  it('未知参数 → 退出码 2 且提示可用参数(不是静默忽略)', () => {
    const r = run(['--frobnicate']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('未知参数');
  });
});

describe.skipIf(!hasBash)('runtime/build.sh 版本断言', () => {
  it('LVGL 版本与 LVGL_TAG 一致 → --check 通过并回显 commit/哈希', () => {
    const r = run(['--check'], { LVGL_DIR: fakeLvgl('9.5.0'), LVGL_TAG: 'v9.5.0' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('--check 通过');
    expect(r.out).toContain('LVGL 9.5.0');
    expect(r.out).toMatch(/lv_conf\.h\s+sha256:[0-9a-f]{64}/);
  });

  it('版本不符 → 失败,且给出可执行的修复指引(旧脚本会静默编错版本)', () => {
    const r = run(['--check'], { LVGL_DIR: fakeLvgl('9.4.0'), LVGL_TAG: 'v9.5.0' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('LVGL 版本不符');
    expect(r.err).toContain('实为 9.4.0');
    expect(r.err).toContain('期望 9.5.0');
    expect(r.err).toContain('rm -rf');
  });

  it('LVGL_TAG 可覆盖 —— 迁移期要能构建 9.4 读旧工程', () => {
    const r = run(['--check'], { LVGL_DIR: fakeLvgl('9.4.0'), LVGL_TAG: 'v9.4.0' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('LVGL 9.4.0');
  });

  it('LVGL 源码缺失时 --check 显式失败,并说明去掉 --check 会自动 clone', () => {
    const r = run(['--check'], { LVGL_DIR: join(tmpdir(), 'lvd-definitely-absent') });
    expect(r.code).toBe(1);
    expect(r.err).toContain('缺 LVGL 源码');
    expect(r.err).toContain('clone');
  });
});

describe.skipIf(!hasBash)('runtime/build.sh emsdk 处理', () => {
  it('--check 模式下没有 emsdk 不算失败 —— 它只校验版本与配置', () => {
    const r = run(['--check'], { LVGL_DIR: fakeLvgl('9.5.0'), LVGL_TAG: 'v9.5.0' });
    expect(r.code).toBe(0);
    // 本机若恰好装了 emcc,这行不会出现;两种情况都不该失败
    if (!r.out.includes('emcc') || r.out.includes('unavailable')) {
      expect(r.out).toMatch(/本机无 emcc|emcc/);
    }
  });

  it('脚本里不再出现写死的单机 emsdk 路径', () => {
    const src = readFileSync(scriptPath, 'utf8');
    expect(src).not.toContain('/home/rie/emsdk');
    // 失败必须显式,不能再被 2>/dev/null 吞掉后继续
    expect(src).toContain('EMSDK_DIR=/你的/emsdk');
  });

  it('LVGL 路径已参数化,CMakeLists 不再写死 ../vendor/lvgl', () => {
    const cmake = readFileSync(fileURLToPath(new URL('../../../runtime/CMakeLists.txt', import.meta.url)), 'utf8');
    expect(cmake).toContain('LVD_LVGL_DIR');
    expect(cmake).toContain('add_subdirectory(${LVD_LVGL_DIR} lvgl_build)');
  });
});
