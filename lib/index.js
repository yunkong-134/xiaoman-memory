// xiaoman-memory — 只做记忆。
//
// 四件事：
//   1. 每轮拿这句话去库里找，最多交两条旧事（只要标题，不给判断）
//   2. 新会话先给一次最近的近况
//   3. 库条数掉了、库太久没补、库还是空的，提前说一句
//   4. 每天挖一次候选元素
//
// 不写库：写哪条、写什么，是人的事。不调模型、不联网、不建向量。
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, existsSync } from 'node:fs'
import { 记忆目录, 文件, 状态目录, 备好目录, 读配置 } from './paths.js'
import { 联想, 记一功, 补元素 } from './回想.js'
import { 体检, 体检一句 } from './体检.js'
import { 解释 } from './解释.js'
import { 长元素 } from './长元素.js'

export const name = 'xiaoman-memory'
export const inject = ['systemPrompt', 'agents', 'tools']

let 配置 = 读配置()

function diag(msg) {
  if (!配置.log) return
  try {
    mkdirSync(状态目录, { recursive: true })
    try {
      if (statSync(文件.日志).size > 1024 * 1024) {
        writeFileSync(文件.日志, readFileSync(文件.日志, 'utf8').slice(-300 * 1024), 'utf8')
      }
    } catch (e) { /* 第一次写，没有这个文件 */ }
    appendFileSync(文件.日志, new Date().toISOString() + '  ' + msg + '\n')
  } catch (e) { /* 诊断失败不挡主流程 */ }
}

function 读(文件路径) {
  try { return readFileSync(文件路径, 'utf8') } catch (e) { return '' }
}

// 标题后面挂半句事。只取第一句，长了截断——注入不是读全文的地方。
// 按 mtime 缓存：每轮都读一遍整个事件库，几千条会拖慢。
let 半句缓存 = { mtime: 0, 表: null }
function 半句表() {
  try {
    const st = statSync(文件.库)
    if (半句缓存.表 && 半句缓存.mtime === st.mtimeMs) return 半句缓存.表
    const 文 = 读(文件.库)
    const 表 = new Map()
    for (const b of 文.split(/^### /m).slice(1)) {
      const 头 = b.split('\n')[0].trim()
      const id = 头.split(/\s+/)[0]
      const m = b.match(/(?:^|\n)〔事〕\s*([^\n]+)/)
      if (!id || !m) continue
      let 句 = m[1].trim()
      const 断 = 句.search(/[。！？]/)
      if (断 > 0) 句 = 句.slice(0, 断)
      if (句.length > 28) 句 = 句.slice(0, 28) + '…'
      表.set(id, 句)
    }
    半句缓存 = { mtime: st.mtimeMs, 表 }
    return 表
  } catch (e) {
    return 半句缓存.表 || new Map()
  }
}

function 半句(id) {
  try { return 半句表().get(id) || '' } catch (e) { return '' }
}

function 条数(文) {
  return (String(文).match(/^### /gm) || []).length
}

// 最近几天的事：标题行里要有 10-28 这种日期，没有日期的条目不进来。
// 这是给人看的提醒，不是搜索——要不要提，交给模型。
function 近况一句() {
  const 文 = 读(文件.库)
  if (!文) return ''
  const 今 = new Date()
  const 条 = []
  for (const p of 文.split(/^### /m).slice(-80)) {
    const sp = p.split('\n')[0].trim().split(/\s+/)
    const 日词 = sp.find((x) => /^(?:\d{4}-)?\d{1,2}-\d{1,2}$/.test(x))
    if (!日词) continue
    const 段 = 日词.split('-').map(Number)
    let d
    if (段.length === 3) {
      d = new Date(段[0], 段[1] - 1, 段[2])
    } else {
      d = new Date(今.getFullYear(), 段[0] - 1, 段[1])
      let 试 = 0
      while (d > 今 && 试 < 2) { d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()); 试++ }
    }
    const 差 = Math.round((今 - d) / 86400000)
    if (差 < 0 || 差 > Number(配置.recentDays)) continue
    条.push({ 差, 题: sp.filter((x) => x !== 日词).slice(1).join(' ') })
  }
  if (!条.length) return ''
  条.sort((x, y) => x.差 - y.差)
  return '最近' + 配置.recentDays + '天库里记了：' + 条.slice(0, 5).map((x) => x.题).join('；') + '。要不要提，你定。'
}

// 库只该变多。条数掉了、文件没了，就说明被盖了或者盘没挂上，先把话说在前面。
function 库体检() {
  const 文 = 读(文件.库)
  const 现在 = 条数(文)
  let 旧 = 0
  try { 旧 = Number(JSON.parse(读(文件.体检)).n) || 0 } catch (e) { /* 第一次，没有水位 */ }
  let 话 = ''
  if (!existsSync(文件.库) && 旧 > 0) {
    话 = '⚠ 记忆库文件不见了（上次 ' + 旧 + ' 条）。先别往里写，先去找备份。'
  } else if (旧 > 0 && 现在 < 旧) {
    话 = '⚠ 记忆库从 ' + 旧 + ' 条变成 ' + 现在 + ' 条。可能是被整个文件夹盖掉了。先别往里写，先去找备份。'
  }
  if (现在 !== 旧 || !话) {
    try {
      mkdirSync(状态目录, { recursive: true })
      writeFileSync(文件.体检, JSON.stringify({ n: 现在, at: Date.now() }), 'utf8')
    } catch (e) { /* 写不进水位不影响这一句 */ }
  }
  if (话) diag(话)
  return 话
}

function 停库一句() {
  try {
    const 小时 = (Date.now() - statSync(文件.库).mtimeMs) / 3600000
    if (小时 <= Number(配置.staleHours)) return ''
    return '库停在 ' + Math.floor(小时) + ' 小时前，该补了。'
  } catch (e) { return '' }
}

// ---------------------------------------------------------------------------
// 宿主接缝：从会话里拿最后一句他说的话。
// 这几段是跟着这台机器上的 dsh 摸出来的，换个版本可能得改。
// ---------------------------------------------------------------------------
function 会话id(session) {
  if (!session) return ''
  try {
    if (session.header && typeof session.header.id === 'string' && session.header.id) return session.header.id
  } catch (e) { /* 下一种 */ }
  for (const k of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
    try {
      const v = session[k]
      if (typeof v === 'string' && v) return v
    } catch (e) { /* 下一种 */ }
  }
  return ''
}

let 宿主 = null

function 事件里(session) {
  if (!session) return []
  try {
    if (typeof session.snapshotEvents === 'function') {
      const r = session.snapshotEvents()
      if (r && r.length) return r
    }
  } catch (e) { /* 下一种 */ }
  try {
    if (Array.isArray(session.events)) return session.events
  } catch (e) { /* 下一种 */ }
  try {
    if (typeof session.events === 'function') {
      const r = session.events()
      if (r) return r
    }
  } catch (e) { /* 下一种 */ }
  try {
    const sid = 会话id(session)
    if (宿主 && 宿主.sessions && sid) {
      const s = 宿主.sessions.get(sid)
      if (s && typeof s.snapshotEvents === 'function') return s.snapshotEvents() || []
      if (s && Array.isArray(s.events)) return s.events
      if (s && typeof s.events === 'function') return s.events() || []
    }
  } catch (e) { /* 拿不到就当没有 */ }
  return []
}

function 取文本(p) {
  if (!p) return ''
  if (typeof p === 'string') return p
  const c = p.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const t = c.map((x) => {
      if (!x) return ''
      if (typeof x === 'string') return x
      if (typeof x.text === 'string') return x.text
      if (x.type === 'text' && typeof x.value === 'string') return x.value
      return ''
    }).join('')
    if (t) return t
  }
  if (typeof p.text === 'string' && p.text) return p.text
  if (Array.isArray(p.parts)) {
    const t = p.parts.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('')
    if (t) return t
  }
  if (p.message) {
    const t = 取文本(p.message)
    if (t) return t
  }
  if (typeof p.value === 'string' && p.value) return p.value
  if (typeof p.output === 'string' && p.output) return p.output
  return ''
}

function 最后用户话(session) {
  const ev = 事件里(session)
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i]
    if ((e && (e.type || e.kind)) !== 'user/message') continue
    const p = e.payload !== undefined ? e.payload : e.data
    const src = p && p.source && p.source.kind ? String(p.source.kind) : ''
    // 宿主注进来的上下文不是他说的
    if (src && src !== 'user') continue
    const txt = 取文本(p).trim()
    if (txt) return txt
  }
  return ''
}

// ---------------------------------------------------------------------------
// 挂载
// ---------------------------------------------------------------------------

// 工具参数：插件这边写成 { name: {type, required, description} }，
// 宿主那边要的是标准 JSON Schema，这里转一次。
function 兜底参数(p) {
  if (!p || typeof p !== 'object') return { type: 'object', properties: {}, additionalProperties: false }
  if (p.type === 'object' || p.type === 'array') return p
  const properties = {}
  const required = []
  for (const [k, v] of Object.entries(p)) {
    if (!v || typeof v !== 'object') continue
    const { required: r, ...rest } = v
    properties[k] = rest
    if (r === true) required.push(k)
  }
  const out = { type: 'object', properties, additionalProperties: false }
  if (required.length) out.required = required
  return out
}

const 定义工具 = (o) => ({ ...o, parameters: 兜底参数(o.parameters) })

export function apply(ctx) {
  配置 = 读配置()
  备好目录()
  宿主 = ctx
  diag('apply：库在 ' + 记忆目录)

  // 装完先体检一次：格式坏了不会报错，回想只是悄悄看不见那条。
  try {
    const r = 体检()
    diag('体检：' + r.统计.事件 + ' 条事，' + r.统计.元素 + ' 个元素，' + (r.问题.length ? r.问题.length + ' 处问题' : '没发现问题'))
    if (r.问题.length) diag('体检问题：' + r.问题.join('；'))
  } catch (e) { diag('体检失败：' + (e && e.message)) }

  // 两个工具：一个查格式，一个查"为什么没想起来"。
  try {
    if (ctx.tools && typeof ctx.tools.register === 'function') {
      const 卸查 = ctx.tools.register(定义工具({
        name: 'memory_check',
        description: '查记忆库的格式：哪条少了〔元〕〔事〕、哪个元素行坏了、理解库标题有没有日期。只读。',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: { ok: { type: 'boolean' }, 行: { type: 'array', items: { type: 'string' } } },
          },
          render(_a, v) {
            const 行 = (v && Array.isArray(v.行)) ? v.行 : []
            return [{ type: 'text', text: 行.length ? 行.join('\n') : '（没查到）' }]
          },
        },
        async execute() {
          try {
            const r = 体检()
            const 行 = ['事件 ' + r.统计.事件 + ' 条，元素 ' + r.统计.元素 + ' 个，理解 ' + r.统计.理解 + ' 块']
            if (r.问题.length) 行.push('有问题：', ...r.问题.map((x) => '  - ' + x))
            else 行.push('没发现格式错。')
            if (r.提醒.length) 行.push('提醒：', ...r.提醒.map((x) => '  - ' + x))
            diag('memory_check：' + (r.问题.length ? r.问题.length + ' 处问题' : '干净'))
            return { ok: true, 行 }
          } catch (e) {
            return { ok: false, 行: ['查不了：' + String((e && e.message) || e)] }
          }
        },
      }))
      ctx.on && ctx.on('dispose', () => { try { if (typeof 卸查 === 'function') 卸查() } catch (e) {} })
      diag('工具挂上：memory_check')

      const 卸释 = ctx.tools.register(定义工具({
        name: 'memory_explain',
        description: '解释一次回想：这句话点到了哪些元素、交出来哪几条；给编号还能说清那条为什么没被交出来（没点到、沉底、还是分不够）。只读。',
        parameters: {
          问: { type: 'string', required: true, description: '要试的那句话，原样写' },
          期望: { type: 'string', description: '可选：你希望被想起的事的编号，比如 E012' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: { ok: { type: 'boolean' }, 行: { type: 'array', items: { type: 'string' } } },
          },
          render(_a, v) {
            const 行 = (v && Array.isArray(v.行)) ? v.行 : []
            return [{ type: 'text', text: 行.length ? 行.join('\n') : '（没结果）' }]
          },
        },
        async execute(args) {
          try {
            const 问 = String((args && (args.问 || args.q)) || '').trim()
            if (!问) return { ok: false, 行: ['没给句子'] }
            const 期望 = String((args && (args.期望 || args.id)) || '').trim()
            const r = 解释(问, 期望)
            diag('memory_explain：' + 问.slice(0, 30) + (期望 ? ' @' + 期望 : ''))
            return { ok: true, 行: r.判定 }
          } catch (e) {
            return { ok: false, 行: ['解释不了：' + String((e && e.message) || e)] }
          }
        },
      }))
      ctx.on && ctx.on('dispose', () => { try { if (typeof 卸释 === 'function') 卸释() } catch (e) {} })
      diag('工具挂上：memory_explain')

      // 全忆只收原话：一字不改，不总结。写哪句、算不算原话，人说了算。
      const 卸档 = ctx.tools.register(定义工具({
        name: 'memory_archive',
        description: '把一句原话追加进全忆（当天一个文件）。原样写，不改写、不总结。事件库里的〔源〕指到这里。',
        parameters: {
          话: { type: 'string', required: true, description: '原话，一字不改地抄' },
          谁: { type: 'string', description: '他 或 我，默认 他' },
          日: { type: 'string', description: '可选 YYYY-MM-DD，默认今天' },
          时: { type: 'string', description: '可选 HH:MM:SS，默认现在' },
        },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, 行: { type: 'array', items: { type: 'string' } } } },
          render(_a, v) {
            const 行 = (v && Array.isArray(v.行)) ? v.行 : []
            return [{ type: 'text', text: 行.join('\n') }]
          },
        },
        async execute(args) {
          try {
            const 话 = String((args && (args.话 || args.text)) || '').trim()
            if (!话) return { ok: false, 行: ['没给原话'] }
            const 谁 = String((args && args.谁) || '他').trim() === '我' ? '我' : '他'
            const 今 = new Date()
            const 日 = /^\d{4}-\d{2}-\d{2}$/.test(String((args && args.日) || ''))
              ? String(args.日)
              : 今.getFullYear() + '-' + String(今.getMonth() + 1).padStart(2, '0') + '-' + String(今.getDate()).padStart(2, '0')
            const 时 = /^\d{1,2}:\d{2}(:\d{2})?$/.test(String((args && args.时) || ''))
              ? String(args.时)
              : [今.getHours(), 今.getMinutes(), 今.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
            mkdirSync(文件.全忆目录, { recursive: true })
            const 路径 = 文件.全忆目录 + '/' + 日 + '.md'
            const 有文件 = existsSync(路径)
            const 行 = 时 + ' ' + 谁 + '  ' + 话
            appendFileSync(路径, (有文件 ? '' : '# ' + 日 + '\n\n') + 行 + '\n', 'utf8')
            diag('memory_archive：' + 日 + ' ' + 时 + ' ' + 谁)
            return { ok: true, 行: ['已记进全忆：' + 日 + '.md ' + 时 + ' ' + 谁 + '\n' + 话] }
          } catch (e) {
            return { ok: false, 行: ['写不进去：' + String((e && e.message) || e)] }
          }
        },
      }))
      ctx.on && ctx.on('dispose', () => { try { if (typeof 卸档 === 'function') 卸档() } catch (e) {} })
      diag('工具挂上：memory_archive')
    } else {
      diag('宿主没有 ctx.tools，两个工具没挂上')
    }
  } catch (e) { diag('挂工具失败：' + (e && e.message)) }

  const injected = new Set()
  const 说明提过 = new Set()
  const 空库提过 = new Set()
  const 停库提过 = new Set()
  let lastLen = -1

  function 列会话() {
    try {
      if (ctx.agents && typeof ctx.agents.roots === 'function') {
        const r = ctx.agents.roots()
        if (r && r.length) return r
      }
    } catch (e) { /* 退回 list */ }
    try { return (ctx.agents && ctx.agents.list && ctx.agents.list()) || [] } catch (e) { return [] }
  }

  function 注入文本(agent, sid) {
    const 条 = []
    try {
      const 体检 = 库体检()
      if (体检) 条.push(体检)
    } catch (e) { diag('库体检失败：' + (e && e.message)) }

    try {
      const 格 = 体检一句()
      if (格) 条.push(格)
    } catch (e) { diag('体检注入失败：' + (e && e.message)) }

    // 每个会话只提一次：有哪两个工具、想让它记住该怎么说。
    try {
      if (!说明提过.has(sid)) {
        说明提过.add(sid)
        条.push('记忆的两个工具：memory_check 查库的格式，memory_explain 查一次回想为什么这样。想让我记住一件事，说「记一下：……」，我会照格式起一条，你再改。')
      }
    } catch (e) { /* 提不了就不提 */ }

    try {
      const 现在 = 条数(读(文件.库))
      if (现在 === 0 && !空库提过.has(sid)) {
        空库提过.add(sid)
        条.push('记忆库还是空的。要记事的时候，照 ' + 文件.库 + ' 顶上写的格式写一条，写完就是它的第一条。')
      }
    } catch (e) { /* 空库判断失败不算事 */ }

    try {
      const 停 = 停库一句()
      const 段 = Math.floor((Date.now() - (statSync(文件.库).mtimeMs || 0)) / 86400000)
      if (停 && !停库提过.has(sid + ':' + 段)) {
        停库提过.add(sid + ':' + 段)
        条.push(停)
      }
    } catch (e) { /* 没有库文件就没有这一句 */ }

    try {
      const 近 = 近况一句()
      if (近) 条.push(近)
    } catch (e) { diag('近况失败：' + (e && e.message)) }

    try {
      const q = 最后用户话(agent && agent.session)
      const 旧 = q ? 联想(q, Number(配置.top) || 2) : []
      if (旧.length) {
        记一功(旧.map((x) => x.id))
        const 补 = 补元素(q, 旧)
        diag('回想命中 q=「' + String(q).slice(0, 40) + '」 → ' + 旧.map((x) => x.title).join(' / ') + (补 ? '｜补元素 ' + 补 + ' 条' : ''))
        const 半 = (x) => {
          const s = 半句(x.id)
          return s ? '——' + s : ''
        }
        条.push('相关旧事：' + 旧.map((x) => '「' + x.title + '」' + 半(x) + (x.via ? '（顺着「' + x.via + '」想到的）' : '')).join(''))
      }
    } catch (e) { diag('回想失败：' + (e && e.message)) }

    if (!条.length) return ''
    const 全 = 条.join('\n')
    diag('注入：' + 全.replace(/\n/g, ' ').slice(0, 160))
    return 全
  }

  function 挂注入(agent, sid) {
    try {
      if (!agent.ctx || !agent.ctx.systemPrompt || typeof agent.ctx.systemPrompt.context !== 'function') {
        diag('这个会话没有 systemPrompt.context，跳过 ' + sid)
        return
      }
      agent.ctx.systemPrompt.context({
        name: 'xiaoman-memory',
        order: 890,
        text: () => {
          try { return 注入文本(agent, sid) } catch (e) { diag('注入失败：' + (e && e.message)); return '' }
        },
      })
      diag('已挂注入 ' + sid)
    } catch (e) { diag('挂注入失败：' + (e && e.message)) }
  }

  // 每天挖一次候选元素；关机错过就下次开机补，当天只跑一次。
  function 每日长元素() {
    const 今 = new Date().toISOString().slice(0, 10)
    let 记号 = ''
    try { 记号 = 读(文件.长元素记号) } catch (e) { /* 没有 */ }
    if (记号 && 记号.slice(0, 10) === 今) return
    try {
      mkdirSync(状态目录, { recursive: true })
      writeFileSync(文件.长元素记号, new Date().toISOString(), 'utf8')
    } catch (e) { return }
    try {
      const r = 长元素()
      diag('长元素：' + r.n + ' 个候选｜' + (r.顶级 || []).slice(0, 5).join('、'))
    } catch (e) { diag('长元素失败：' + (e && e.message)) }
  }

  function tick() {
    try { 每日长元素() } catch (e) { diag('长元素触发失败：' + (e && e.message)) }
    let list = []
    try { list = 列会话() } catch (e) { diag('取会话失败：' + (e && e.message)); return }
    if (list.length !== lastLen) {
      diag('会话数 ' + list.length + (list.length ? '，首个 ' + 会话id(list[0] && list[0].session) : ''))
      lastLen = list.length
    }
    for (const agent of list) {
      const sid = 会话id(agent && agent.session)
      if (!sid || injected.has(sid)) continue
      injected.add(sid)
      挂注入(agent, sid)
    }
  }

  tick()
  try {
    const timer = setInterval(() => { try { tick() } catch (e) { diag('tick 异常：' + (e && e.message)) } }, 4000)
    if (timer && typeof timer.unref === 'function') timer.unref()
  } catch (e) { diag('setInterval 失败：' + (e && e.message)) }
}

export const __测试 = { 条数, 近况一句, 库体检 }
