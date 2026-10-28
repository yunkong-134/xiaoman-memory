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
import { 长元素 } from './长元素.js'

export const name = 'xiaoman-memory'
export const inject = ['systemPrompt', 'agents']

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

function 条数(文) {
  return (String(文).match(/^### /gm) || []).length
}

// 最近几天的事：标题行里要有 10-28 这种日期，没有日期的条目不进来。
// 这是给人看的提醒，不是搜索——要不要提，交给模型。
function 近况一句() {
  const 文 = 读(文件.库)
  if (!文) return ''
  const 今 = new Date()
  const 今号 = (今.getMonth() + 1) * 100 + 今.getDate()
  const 条 = []
  for (const p of 文.split(/^### /m).slice(-80)) {
    const sp = p.split('\n')[0].trim().split(/\s+/)
    const 日词 = sp.find((x) => /^\d{1,2}-\d{1,2}$/.test(x))
    if (!日词) continue
    const [mm, dd] = 日词.split('-').map(Number)
    const 差 = 今号 - (mm * 100 + dd)
    if (差 < 0 || 差 > Number(配置.recentDays)) continue
    条.push(sp.filter((x) => x !== 日词).join(' '))
  }
  if (!条.length) return ''
  return '最近' + 配置.recentDays + '天库里记了：' + 条.slice(-5).join('；') + '。要不要提，你定。'
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
export function apply(ctx) {
  配置 = 读配置()
  备好目录()
  宿主 = ctx
  diag('apply：库在 ' + 记忆目录)

  const injected = new Set()
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
        条.push('相关旧事：' + 旧.map((x) => '「' + x.title + '」' + (x.via ? '（顺着「' + x.via + '」想到的）' : '')).join(''))
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
