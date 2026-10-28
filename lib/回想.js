// 回想：按当前这句话去事件库里找前两条。只读文件，不调模型。
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { 文件, 记忆库目录 } from './paths.js'

const 库 = 文件.库
const 表 = 文件.表
const 多义 = 文件.多义
const 别名表 = 文件.别名
const 候选文件 = 文件.候选

let cache = { mtime: 0, events: [], alias: {}, df: {} }

function 读(文件) {
  try {
    return readFileSync(文件, 'utf8')
  } catch (e) {
    return ''
  }
}

function 子序列命中(p, q, gap = 2) {
  for (let i = 0; i < q.length; i++) {
    if (q[i] !== p[0]) continue
    let j = i
    let k = 0
    while (j < q.length && k < p.length) {
      if (q[j] === p[k]) k++
      j++
      if (j - i > p.length + gap) break
    }
    if (k === p.length) return true
  }
  return false
}

function 等级(短语, q) {
  if (q.includes(短语)) return 3
  if (短语.length >= 3 && 子序列命中(短语, q)) return 2
  for (const 头 of ['对话', '会话', '记忆', '情绪', '照片']) {
    if (短语.endsWith(头) && q.includes(头)) return 1
  }
  return 0
}


function 读多义() {
  let 文 = ''
  try {
    文 = readFileSync(多义, 'utf8')
  } catch (e) {
    return {}
  }
  const 图 = {}
  let 当前 = ''
  for (const 行 of 文.split('\n')) {
    const 头 = 行.match(/^\s{0,4}([^\s→]{1,4})\s*→\s*(.+)$/)
    if (头) {
      当前 = 头[1]
      图[当前] = []
      const 尾 = 头[2].match(/^(.+?)（线索：(.+?)）/)
      if (尾) 图[当前].push({ 义: 尾[1].trim(), 线索: 尾[2].split(/[、,，]/).map((x) => x.trim()).filter(Boolean) })
      continue
    }
    const 续 = 行.match(/^\s{6,}(.+?)（线索：(.+?)）/)
    if (续 && 当前 && 图[当前]) 图[当前].push({ 义: 续[1].trim(), 线索: 续[2].split(/[、,，]/).map((x) => x.trim()).filter(Boolean) })
  }
  return 图
}

/** 多义词消歧：返回该词面允许留下的义；返回 null 表示整条丢掉。 */
function 消歧(词面, q, 图) {
  const 义s = 图[词面]
  if (!义s || 义s.length < 2) return null
  let 最佳 = null
  let 最分 = 0
  for (const { 义, 线索 } of 义s) {
    const 分 = 线索.filter((c) => q.includes(c)).length
    if (分 > 最分) { 最分 = 分; 最佳 = 义 }
  }
  return 最分 > 0 ? 最佳 : false
}


const 形状词 = {
  低: /难受|烦|累|撑|崩|失望|怕|生气|委屈|不想|恋旧|撑不住/,
  高: /通了|成功|好使|搞定|做成|对了|成了|装上/,
  卡: /不懂|卡住|卡了|为什么|没懂|搞不清|不明白|想不通/,
  要人靠近: /孤独|一个人|陪我|找我|说话|夜里|凌晨|睡|聊天|撑不住/,
  要结论: /为什么|到底|是不是|对不对|能不能|该不该|哪个对/,
  要做事: /改|修|装|做|写|删|标|补|跑/,
}

function 拆形状(q) {
  const 状 = 形状词.低.test(q) ? '低' : 形状词.高.test(q) ? '高' : 形状词.卡.test(q) ? '卡' : ''
  const 缺 = 形状词.要人靠近.test(q) ? '要人靠近' : 形状词.要结论.test(q) ? '要结论' : 形状词.要做事.test(q) ? '要做事' : ''
  return { 状, 缺 }
}

function 形状对得上(a, b) {
  if (!a || !b) return 0
  let n = 0
  if (a.状 && b.状 && a.状 === b.状) n++
  if (a.缺 && b.缺 && a.缺 === b.缺) n++
  return n
}

function 装库() {
  let m = 0
  try {
    m = statSync(库).mtimeMs
  } catch (e) {
    return cache
  }
  try {
    m = Math.max(m, statSync(别名表).mtimeMs)
  } catch (e) {}
  try {
    m = Math.max(m, statSync(候选文件).mtimeMs)
  } catch (e) {}
  if (m === cache.mtime && cache.events.length) return cache

  const 表文 = 读(表)
  const alias = {}
  for (const line of 表文.split('\n')) {
    const mm = line.match(/^\s*〔元〕(.+?)｜.*?｜别名[：:](.*?)｜/)
    if (!mm) continue
    const 词 = new Set([mm[1].trim()])
    for (const w of mm[2].split(/[、,，/\s]+/)) if (w.trim()) 词.add(w.trim())
    alias[mm[1].trim()] = 词
  }
  // 手加的别名存在单独一个文件里：元素表会被 _rebuild.py 重写，那里面写的会被冲掉
  try {
    const 补 = JSON.parse(读(别名表))
    for (const k of Object.keys(补)) {
      if (!alias[k]) alias[k] = new Set([k])
      alias[k].add(k)
      for (const w of 补[k]) if (String(w).trim()) alias[k].add(String(w).trim())
    }
  } catch (e) {}

  const 文 = 读(库)
  const events = []
  const parts = 文.split(/^### /m).slice(1)
  for (const p of parts) {
    const nl = p.indexOf('\n')
    const head = (nl < 0 ? p : p.slice(0, nl)).trim()
    const body = nl < 0 ? '' : p.slice(nl)
    const mm = body.match(/〔元〕(.*)/)
    if (!mm) continue
    const mf = body.match(/〔形〕(.+)/)
    const mq = body.match(/〔情〕\s*(-?[\d.]+)/)
    const sp = head.split(/\s+/)
    events.push({
      id: sp[0],
      title: sp.slice(1).join(' ') || head,
      元: mm[1].split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
      形: mf ? mf[1].trim() : '',
      情: mq ? Number(mq[1]) || 0 : 0,
    })
  }

  const df = {}
  // 候选元素：库里自己长出来的词（长元素.js 挖的），先当临时元用，不进元素表。
  // 没写进〔元〕也能把话接上，这就是"不用手加也认得"的那部分。
  try {
    const 包 = JSON.parse(读(候选文件))
    const 挂 = new Map()
    for (const [词, r] of Object.entries(包.词 || {})) {
      if (!词 || 词.length < 2 || (r.n || 0) < 3) continue
      if (!alias[词]) alias[词] = new Set([词])
      for (const id of r.ids || []) {
        if (!挂.has(id)) 挂.set(id, [])
        挂.get(id).push(词)
      }
    }
    for (const e of events) {
      const 加 = 挂.get(e.id)
      if (!加) continue
      for (const w of 加.slice(0, 10)) if (!e.元.includes(w)) e.元.push(w)
    }
  } catch (e) {}
  for (const e of events) for (const k of new Set(e.元)) df[k] = (df[k] || 0) + 1

  cache = { mtime: m, events, alias, df }
  return cache
}

function 权重(df, k) {
  const n = df[k] || 0
  if (n <= 2) return 1
  if (n <= 5) return 0.8
  if (n <= 10) return 0.6
  if (n <= 20) return 0.4
  return 0.25
}

function 日期号(id) {
  const m = String(id || '').match(/^(\d{1,2})-(\d{1,2})/)
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0
}

/** 返回最多两条旧事的标题；一条都没对上时返回空数组。 */
const 权文件 = 文件.权重
const 半衰天 = 21
let 权缓存 = null
let 权时间 = 0
function 读权重() {
  try {
    const st = statSync(权文件)
    if (权缓存 && st.mtimeMs === 权时间) return 权缓存
    权缓存 = JSON.parse(readFileSync(权文件, 'utf8'))
    权时间 = st.mtimeMs
    return 权缓存
  } catch { return {} }
}
export function 记一功(ids) {
  try {
    const w = 读权重()
    const 情表 = {}
    try { for (const e of 装库().events) 情表[e.id] = Number(e.情) || 0 } catch {}
    for (const it of ids || []) {
      const id = typeof it === 'string' ? it : String((it && it.id) || '')
      if (!id) continue
      let 情 = (it && typeof it === 'object' && typeof it.情 === 'number') ? it.情 : (情表[id] || 0)
      情 = Math.max(-1, Math.min(1, Number(情) || 0))
      const 现在 = 权值(id, w)
      // 越往上越难加：刚起步一次加 0.2，快满时加不动；情绪重的事这一下加得更多
      const 增量 = 0.2 * Math.max(0, 1 - (现在 - 1) / 4) * (0.5 + Math.abs(情))
      w[id] = { w: Math.min(5, 现在 + 增量), t: Date.now() }
    }
    mkdirSync(记忆库目录, { recursive: true })
    writeFileSync(权文件, JSON.stringify(w, null, 1), 'utf8')
    权缓存 = w
    权时间 = statSync(权文件).mtimeMs
  } catch {}
}
function 权值(id, w, 情 = 0) {
  const r = w[id]
  if (r && typeof r === 'object') {
    const d = (Date.now() - Number(r.t || Date.now())) / 86400000
    return 1 + (Number(r.w || 1) - 1) * Math.pow(0.5, d / 半衰天)
  }
  if (typeof r === 'number') return Math.max(1, r)
  const m = String(id || '').match(/^(\d{1,2})-(\d{1,2})/)
  if (!m) return 1
  const 今 = new Date()
  const 日 = new Date(今.getFullYear(), Number(m[1]) - 1, Number(m[2]))
  const 天 = Math.max(0, (今 - 日) / 86400000)
  // 出生权重：情绪重的事生下来就重，轻的从 1 起；两条都随时间回落到 1（平常线）
  const 底 = 0.35 + 0.65 * Math.min(1, Math.abs(Number(情) || 0))
  return 1 + 底 * Math.pow(0.5, 天 / 半衰天)
}


// 处境层：关键词对不上时，靠"这句话在什么处境里"补分。第二档，永远排在字面命中之后。
const 处境表 = [
  { 名: '作息', re: /睡|熬夜|早起|失眠|困|几点/, w: 0.45 },
  { 名: '会话', re: /会话|上下文|窗口|重开|压缩|记得住|忘/, w: 0.45 },
  { 名: '故障', re: /崩|报错|起不来|白屏|装不上|不生效|打不开/, w: 0.5 },
  { 名: '钱', re: /钱|元|花|账单|token|流量/, w: 0.5 },
  { 名: '想不出', re: /不知道|想不出|没想好|怎么办|拿不准/, w: 0.3 },
  { 名: '情绪外露', re: /撑不住|难受|烦|累|难过|不想动|空/, w: 0.5 },
  { 名: '诗', re: /诗|韵|这句|写得/, w: 0.45 },
  { 名: '看到的', re: /照片|月亮|湖|天|图|看/, w: 0.3 },
]

export function 回想(q, top = 2, 要id = false) {
  try {
    const text = String(q || '').trim()
    if (text.length < 4) return []
    const { events, alias, df } = 装库()
    if (!events.length) return []

    const 多义图 = 读多义()
    const direct = {}
    for (const [名, 词s] of Object.entries(alias)) {
      let best = 0
      for (const w of 词s) {
        const lv = 等级(w, text)
        if (!lv) continue
        if (多义图[w]) {
          const 留 = 消歧(w, text, 多义图)
          if (留 === false) continue // 是多义词但判不出来：整条丢掉
          if (留 !== 名) continue // 投给别的义了，这个词不算这个元素
        }
        best = Math.max(best, lv + (lv === 3 ? 0.1 * w.length : 0))
      }
      if (best) direct[名] = best
    }
    const 目 = 拆形状(text)
    const keys = Object.keys(direct)

    const 权表 = 读权重()
    // 形状频次：同一个形状挂得越多，越不值钱
    const 形频 = Object.create(null)
    for (const e of events) {
      if (!e.形) continue
      const p = e.形.split(/[／/]/).map((x) => x.trim())
      for (let i = 1; i < 3; i++) {
        if (!p[i]) continue
        const k = i + ':' + p[i]
        形频[k] = (形频[k] || 0) + 1
      }
    }

    const 分 = []
    for (const e of events) {
      let d = 0
      for (const k of e.元) {
        if (!direct[k]) continue
        d += direct[k] * 权重(df, k)
        // 命中的词本身出现在标题里，比只挂在标签上更硬
        for (const w of alias[k] || []) {
          if (text.includes(w) && e.title.includes(w)) { d += 0.1 * Math.min(w.length, 3); break }
        }
      }
      const 字面 = d
      let 形状分 = 0
      if (e.形) {
        const p = e.形.split(/[／/]/).map((x) => x.trim())
        const qv = [目.状 || '', 目.缺 || '']
        let hit = 0
        let sc = 0
        for (let i = 0; i < 2; i++) {
          if (!qv[i] || qv[i] !== (p[i + 1] || '')) continue
          hit++
          // 形状也要看稀罕：一半的事都长这样，它就不该算证据
          sc += 1 / Math.sqrt(形频[(i + 1) + ':' + qv[i]] || 1)
        }
        if (hit === 2) 形状分 = 0.4 * sc
      }
      const 全文 = String(e.title || '') + ' ' + String(e.事 || e.body || '')
      let 处境分 = 0
      for (const c of 处境表) if (c.re.test(text) && c.re.test(全文)) 处境分 += c.w
      d = 字面 + 形状分 + 处境分
      // 门槛：字面一个都没对上时，宁可空手也别凑。凑出来的更像回事，也更害人。
      // 只有两扇门：字面对上，或者形状两头都合。处境自己不能单独把人领进来，
      // 它的正则在"随便问一句"上太容易中，放它单独进门就会凑。
      if (字面 === 0 && 形状分 === 0) continue
      if (d > 0) 分.push({ d: d * 权值(e.id, 权表, e.情), e })
    }
    分.sort((a, b) => (b.d - a.d) || (日期号(b.e.id) - 日期号(a.e.id)))
    return 分.slice(0, top).map((x) => (要id ? { id: x.e.id, title: x.e.title, 情: x.e.情 } : x.e.title))
  } catch (e) {
    return []
  }
}

// 联想：先照你这句挑一条，再顺着这条挂的元素往外走一步。两次就停。
// 挑哪根元素往外走：先用这条事上最少见的那根（越少见，走得越有信息量）。
export function 联想(q, 上限 = 2) {
  const 首 = 回想(q, 3, true)
  if (!首.length) return []
  const { events, df } = 装库()
  const 起 = 首[0]
  const 中 = events.find((e) => e.id === 起.id)
  if (!中) return [起]
  const 用过的 = new Set(首.map((x) => x.id))
  const 候选 = (中.元 || [])
    .filter((k) => (df[k] || 0) >= 2 && (df[k] || 0) <= 12)
    .sort((a, b) => (df[a] || 0) - (df[b] || 0))
  for (const k of 候选) {
    const 下 = events.find((e) => e.id !== 中.id && !用过的.has(e.id) && (e.元 || []).includes(k))
    if (下) return [起, { id: 下.id, title: 下.title, 情: 下.情, via: k }].slice(0, 上限)
  }
  return [起]
}

// 被想起来了就加一点权重；同一件事再翻出来，带起的东西越少——那部分留给用它的插件自己算。

// 补元素：回忆命中旧事的时候，把这句话里出现、而那条事还没有的元素补上去。
// 只在条目末尾加一行〔补 日期〕，原来的〔事〕〔判〕〔元〕一个字不动——
// 这是"多年后突然明白之前某件事"，不是改写当时的记录。
// 泛元素（挂十条以上）不补，补了也不区分；同一条同一天同一个词只补一次。
const 补账 = 文件.补

export function 补元素(q, 旧, 日 = null) {
  try {
    if (!q || !旧 || !旧.length) return 0
    const c = 装库()
    const 话 = String(q)
    const 命中 = []
    for (const [词, 集] of Object.entries(c.alias)) {
      if (词.length < 2) continue
      if ((c.df[词] || 0) > 10) continue
      let 中 = false
      for (const w of 集) {
        if (w.length >= 2 && 话.includes(w)) { 中 = true; break }
      }
      if (中) 命中.push(词)
    }
    if (!命中.length) return 0
    const 今天 = 日 || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    let 账 = {}
    try { 账 = JSON.parse(读(补账)) } catch (e) {}
    const 文 = 读(库)
    const 块 = 文.split(/^### /m)
    let 改 = 0
    for (let i = 1; i < 块.length; i++) {
      const nl = 块[i].indexOf('\n')
      const head = (nl < 0 ? 块[i] : 块[i].slice(0, nl)).trim()
      const id = head.split(/\s+/)[0]
      if (!旧.some((x) => x.id === id)) continue
      const 元行 = (块[i].match(/〔元〕(.*)/) || ['', ''])[1]
      const 已有 = new Set(元行.split(/[、,，]/).map((s) => s.trim()).filter(Boolean))
      // 同一条同一天只补一次：补过就不再动它，明天想起来还能再补
      if ((账[id] || []).some((x) => x.日 === 今天)) continue
      // 只补这条事自己正文里就有、当时没标成元素的词。
      // 当前这句话里出现只是"这次谈到了"；正文里有，才是当时漏标——那才叫多年后突然明白。
      const 要 = 命中.filter((w) => !已有.has(w) && 块[i].includes(w)).slice(0, 2)
      if (!要.length) continue
      块[i] = 块[i].replace(/\s*$/, '') + '\n〔补 ' + 今天 + '〕' + 要.join('、') + '\n\n'
      账[id] = (账[id] || []).concat([{ 日: 今天, 词: 要 }])
      改++
    }
    if (改) {
      let out = 块[0]
      for (let i = 1; i < 块.length; i++) out += '### ' + 块[i]
      mkdirSync(记忆库目录, { recursive: true })
      writeFileSync(库, out, 'utf8')
      writeFileSync(补账, JSON.stringify(账, null, 1), 'utf8')
    }
    return 改
  } catch (e) {
    return 0
  }
}
