/**
 * aiSession:一轮 AI 对话 = 组消息 → jsonMode 调用 → 解析 → applyAiOps 校验
 * → 失败则把错误列表作为追加 user 消息重试(默认 ≤2 轮修复)→ 返回结果。
 *
 * 集成方拿到 recipe 后:
 *   useProjectStore.getState().mutateV2('AI:' + result.reply, result.recipe)
 * 即整批 ops 一条 undo 历史;画布经 reloadPipeline 热重载。
 */
import type { LvProject, WidgetNode } from '@lvd/schema';
import { migrateV1ToV2, type UiProject } from '@lvd/schema/v2';
import { defaultAiClient, type AiClient, type DsMessage } from './deepseekClient.js';
import { parseAiReply, type AiOp } from './opsSchema.js';
import { applyAiOps, type AiOpError, type AiOpWarning } from './applyOps.js';
import { buildSystemPrompt } from './promptBuilder.js';

export const DEFAULT_AI_MODEL = 'deepseek-chat';
/** 修复回合上限(不含首轮):错误喂回模型重试的次数 */
export const DEFAULT_MAX_REPAIR_ROUNDS = 2;

export interface RunAiTurnArgs {
  project: LvProject;
  /** Canonical edit target. Legacy callers may omit it during migration. */
  uiProject?: UiProject;
  activeScreenId: string;
  selectedNode?: WidgetNode | null;
  /** 用户本轮输入 */
  userText: string;
  /** 之前回合的对话(user/assistant 交替),不含 system */
  history?: DsMessage[];
  /** 缺省用真实 deepseekClient;测试注入 mock */
  client?: AiClient;
  model?: string;
  temperature?: number;
  maxRepairRounds?: number;
  signal?: AbortSignal;
  /**
   * 文本增量回调(UI 打字机效果)。当前实现非流式:仅在本轮校验通过时
   * 以最终 reply 调一次;后续换 chatStream 时语义不变。
   */
  onDelta?: (delta: string) => void;
}

export interface AiTurnResult {
  /** 模型给用户的说明(失败时为最后一轮的 reply 或空串) */
  reply: string;
  /** 校验通过才有;undefined = 纯聊天或修复失败 */
  recipe?: (draft: UiProject) => void;
  /** 成功进入 recipe 的操作数(recipe 为空时 0) */
  opsApplied: number;
  /** 历史标签摘要(reply 截断),集成方可用作 mutate label */
  summary?: string;
  /** 最后一轮模型给出的 ops(未必通过校验) */
  rawOps: AiOp[];
  /** 实际调用模型的次数(1 = 一把过) */
  attempts: number;
  /** 修复回合耗尽后仍剩的错误(成功时为空) */
  errors: AiOpError[];
  warnings: AiOpWarning[];
  /** 本轮新增的对话消息(user + 各轮 assistant/修复 user),供集成方续 history */
  newMessages: DsMessage[];
}

function repairMessage(kind: '解析' | '校验', problems: string[]): string {
  return [
    `你上一条输出未通过${kind},问题如下:`,
    ...problems.map((p, i) => `${i + 1}. ${p}`),
    '请重新输出完整、修正后的 JSON(格式 {"reply":…,"ops":[…]}),不要输出其它内容。',
  ].join('\n');
}

/**
 * 跑一轮 AI 对话(含 ≤maxRepairRounds 轮自动修复)。
 * 网络/HTTP 错误(AiKeyMissingError/AiHttpError/Abort)原样抛出,由 UI 处理。
 */
export async function runAiTurn(args: RunAiTurnArgs): Promise<AiTurnResult> {
  const {
    project, activeScreenId, selectedNode, userText, onDelta,
    client = defaultAiClient,
    model = DEFAULT_AI_MODEL,
    temperature,
    maxRepairRounds = DEFAULT_MAX_REPAIR_ROUNDS,
    signal,
  } = args;

  const system = buildSystemPrompt(project, activeScreenId, selectedNode);
  const newMessages: DsMessage[] = [{ role: 'user', content: userText }];
  const messages: DsMessage[] = [
    { role: 'system', content: system },
    ...(args.history ?? []),
    ...newMessages,
  ];

  let attempts = 0;
  let lastReply = '';
  let lastOps: AiOp[] = [];
  let lastErrors: AiOpError[] = [];
  let lastWarnings: AiOpWarning[] = [];

  for (let round = 0; round <= maxRepairRounds; round++) {
    attempts++;
    const resp = await client.chatComplete({ model, messages, jsonMode: true, temperature, signal });

    const push = (m: DsMessage): void => {
      messages.push(m);
      newMessages.push(m);
    };
    push({ role: 'assistant', content: resp.content });

    const parsed = parseAiReply(resp.content);
    if (!parsed.data) {
      lastErrors = parsed.errors.map((m) => ({ opIndex: -1, path: '$', code: 'parse', message: m }));
      if (round < maxRepairRounds) push({ role: 'user', content: repairMessage('解析', parsed.errors) });
      continue;
    }

    lastReply = parsed.data.reply;
    lastOps = parsed.data.ops;
    const uiProject = args.uiProject ?? migrateV1ToV2(project).uiProject;
    const applied = applyAiOps(uiProject, parsed.data.ops, activeScreenId);
    lastWarnings = applied.warnings;
    if (applied.errors.length === 0) {
      if (lastReply) onDelta?.(lastReply);
      return {
        reply: lastReply,
        recipe: applied.recipe,
        opsApplied: applied.recipe ? lastOps.length : 0,
        summary: lastReply.trim().slice(0, 24) || undefined,
        rawOps: lastOps,
        attempts,
        errors: [],
        warnings: applied.warnings,
        newMessages,
      };
    }
    lastErrors = applied.errors;
    if (round < maxRepairRounds) {
      push({
        role: 'user',
        content: repairMessage('校验', applied.errors.map((e) => `${e.path}[${e.code}]${e.message}`)),
      });
    }
  }

  return {
    reply: lastReply,
    recipe: undefined,
    opsApplied: 0,
    summary: undefined,
    rawOps: lastOps,
    attempts,
    errors: lastErrors,
    warnings: lastWarnings,
    newMessages,
  };
}
