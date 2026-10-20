/**
 * 技能清单随消息下发（对标 Claude Code 的 skill_listing 附件）。
 *
 * 提示缓存按前缀字节匹配，渲染顺序是 tools → system → messages：清单若写在 skill 工具描述或系统提示词里，
 * 装 / 删 / 改一个技能，下一轮整段历史都得重新写缓存。故工具描述与系统提示词只写固定说明，清单改为
 * **文字块附在消息里**下发：首次给完整清单，之后与已告知的不一致时只发增量（新增 / 描述更新 / 移除）。
 * 块随消息落盘，后续请求原样重放，已缓存的前缀一字不动。
 *
 * **已告知状态不另存，从历史折叠得出**（按序叠加每块的 listed / removed）：压缩把早先的块摘要掉、按轮删除
 * 或回滚删掉含块的那轮之后，折叠结果自然缺了这部分，下一次请求即把缺的补发——无需任何边车同步。
 * 每块在 TextPart.skills 上带结构化记录，折叠不解析文案；适配器只发 text，这个字段不会发给模型。
 */
import { createHash } from 'node:crypto'
import type { ContentPart, Message, SkillListingRecord, TextPart } from '../providers/types'
import { isAutoNudge, isCompactionSummary, isTaskNotification } from './compaction'

type SkillSummary = { name: string; description: string }

/** 描述摘要：描述变了即视为更新，需重新告知。 */
function digestOf(s: SkillSummary): string {
  return createHash('sha1').update(s.description).digest('hex').slice(0, 12)
}

/** 历史里已告知的技能：名称 → 描述摘要。 */
function announcedSkills(history: Message[]): Map<string, string> {
  const known = new Map<string, string>()
  for (const m of history) {
    if (m.role !== 'user' || typeof m.content === 'string') continue
    for (const p of m.content) {
      if (p.type !== 'text' || !p.skills) continue
      for (const s of p.skills.listed) known.set(s.name, s.digest)
      for (const n of p.skills.removed ?? []) known.delete(n)
    }
  }
  return known
}

function skillLine(s: SkillSummary): string {
  return `- ${s.name}${s.description ? `：${s.description}` : ''}`
}

/** 当前技能与历史里已告知的差异，生成一块清单；一致则返回 null。 */
export function skillListingPart(history: Message[], skills: SkillSummary[]): TextPart | null {
  // 同名（大小写不敏感）只留第一个，与 loadSkillInstructionsByName 的命中一致；否则同名两项轮流不一致，每步都会重发。
  const seen = new Set<string>()
  const current = skills.filter((s) => {
    const key = s.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const known = announcedSkills(history)
  const listed = current.filter((s) => known.get(s.name) !== digestOf(s))
  const names = new Set(current.map((s) => s.name))
  const removed = [...known.keys()].filter((n) => !names.has(n))
  if (!listed.length && !removed.length) return null

  const lines: string[] = []
  if (known.size === 0) {
    lines.push('【可用技能】以下技能可通过 skill 工具加载（传入其名称 name）；用户也可用「/技能名」显式触发：', ...listed.map(skillLine))
  } else {
    lines.push('【技能清单更新】')
    if (listed.length) lines.push('以下技能现已可用（新增或描述有更新），可通过 skill 工具加载：', ...listed.map(skillLine))
    if (removed.length) lines.push(`以下技能已不再可用，不要再调用：${removed.join('、')}`)
  }
  lines.push('（以上由系统自动附带，不是用户发来的消息；技能再有增减或更新时会另行告知，以最近的告知为准。）')

  const record: SkillListingRecord = {
    listed: listed.map((s) => ({ name: s.name, digest: digestOf(s) })),
    ...(removed.length ? { removed } : {})
  }
  return { type: 'text', text: lines.join('\n'), skills: record }
}

/**
 * 请求模型前调用：有差异就把清单块附到历史末条——它是这次请求才首次发出的那条 user 消息（用户提问 /
 * 工具结果），附上去不碰已缓存的前缀。已告知过则什么都不做，故重连重发时调用多少次都一样。
 * 末条是带标记的字符串消息（压缩摘要 / 自愈引导 / 后台通知）时不附：它们靠字符串前缀识别，改成块数组就
 * 认不出了——留给下一条消息（多为下一步的工具结果）。
 */
export function attachSkillListing(history: Message[], skills: SkillSummary[]): void {
  const i = history.length - 1
  const last = history[i]
  if (!last || last.role !== 'user') return
  if (isCompactionSummary(last) || isAutoNudge(last) || isTaskNotification(last)) return
  const part = skillListingPart(history, skills)
  if (!part) return
  let content: ContentPart[]
  if (typeof last.content === 'string') content = [part, { type: 'text', text: last.content }]
  // 工具结果消息：协议要求 tool_result 块在前，文字跟在后面（同后台任务通知）。
  else if (last.content.some((p) => p.type === 'tool_result')) content = [...last.content, part]
  // 用户提问：放最前，提问正文仍是最后一个 text 块（展示层只取它作气泡正文）。
  else content = [part, ...last.content]
  // 换新对象而不就地改：fork 的历史与主对话共享消息对象，按不可变对待。
  history[i] = { ...last, content }
}
