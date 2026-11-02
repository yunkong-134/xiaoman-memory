// 回想：按当前这句话去事件库里找前两条。只读文件，不调模型。
import { readFileSync, writeFileSync, statSync, mkdirSync, appendFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { 记忆目录 as SELF } from './paths.js'

const 库 = join(SELF, '记忆库', '事件库.md')
const 表 = join(SELF, '元素表.md')
const 多义 = join(SELF, '元素-多义表.md')
const 别名表 = join(SELF, '元素-别名.json')
const 候选文件 = join(SELF, '记忆库', '元素-候选.json')

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
  const 类 = {}
  const 表名 = new Set()
  for (const line of 表文.split('\n')) {
    const mm = line.match(/^\s*〔元〕(.+?)｜.*?｜别名[：:](.*?)｜/)
    if (!mm) continue
    表名.add(mm[1].trim())
    const tm = line.match(/^\s*〔元〕(.+?)｜([^｜]*)｜/)
    if (tm) 类[tm[1].trim()] = tm[2].trim()
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
    const mm = body.match(/(?:^|\n)〔元〕(.*)/)
    if (!mm) continue
    const mf = body.match(/〔形〕(.+)/)
    const mq = body.match(/〔情〕\s*(-?[\d.]+)/)
    // 2026-10-31：把「他说的」和「我判的」分开端出来。回想只给标题的时候，
    // 〔判〕里的东西读着像事实；其实一半是我的判断，不是他的原话。
    // 2026-10-31 补〔事〕：处境分（下面 490 行）一直读 e.事，而这里从来没解析它，
    // 那段从写下就没生效过。先装进来，改动前后的排序拿 ref\对照-处境.mjs 量过。
    const mp = body.match(/(?:^|\n)〔判〕(.*)/)
    const ms = body.match(/(?:^|\n)〔事〕(.*)/)
    const sp = head.split(/\s+/)
    const 元集 = new Set(mm[1].split(/[、,，]/).map((x) => x.trim()).filter(Boolean))
    // 〔补 日期〕行也并进来，但只收元素表里有的词：
    // 那 59 行里补的是“为什、有什、有一”这种碎片，拿表一挡就进不来。
    for (const b of body.matchAll(/〔补[^〕]*〕(.*)/g)) {
      for (const w of b[1].split(/[、,，]/)) {
        const t = w.trim()
        if (t && 表名.has(t)) 元集.add(t)
      }
    }
    events.push({
      id: sp[0],
      title: sp.slice(1).join(' ') || head,
      元: [...元集],
      形: mf ? mf[1].trim() : '',
      情: mq ? Number(mq[1]) || 0 : 0,
      判: mp ? mp[1].trim() : '',
      事: ms ? ms[1].trim() : '',
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

  cache = { mtime: m, events, alias, df, 类 }
  return cache
}

// 只有抽象词按“挂得多就不值钱”打折；器物、感觉不打折。
// 指称（人物、小满、他、我）单独豁免——他 10-28 说的：指称越常见越该留着，
// 它指向的始终是同一个人，泛的是别的词，不是这个人。
const 指称 = new Set(['人物', '小满', '满', '他', '她', '我', '你', '我们'])
// 元素的权重只有两条规则，不再看它挂了多少条：
// 一、判过“淡”的一律压到 0.3，判过“留”的不管它，继续当满值。
// 二、没判过的按类型给底分：感觉类 0.5（只能当标签），器物、指称、抽象都是 1。
// 挂多挂少交给判决去管，条数折扣这套已经删了。
function 权重(df, k, 类) {
  const t = (类 && 类[k]) || ''
  const 判 = 读淡化()[k]
  if (判 && 判.判 === '淡') return 0.5
  if (t.includes('感觉')) return 0.5
  return 1
}

// 淡化判决：{ 元素: { 判: '淡'|'留', 理由, at } }
const 淡化文件 = join(SELF, '记忆库', '元素-淡化.json')
let 淡缓存 = null
let 淡时间 = 0
// 泛元素：挂得太多，一给分就把别的证据全盖住（判断-取舍 挂了 65 条）。
// 它们的用处是缩小范围，不是打分。名单在 记忆库/元素-泛.json。
let 泛缓存 = { t: 0, 集: null }
export function 读泛() {
  try {
    const st = statSync(join(SELF, '记忆库', '元素-泛.json'))
    if (泛缓存.t === st.mtimeMs && 泛缓存.集) return 泛缓存.集
    const j = JSON.parse(readFileSync(join(SELF, '记忆库', '元素-泛.json'), 'utf8'))
    const 集 = new Set(Array.isArray(j) ? j : Object.keys(j.元素 || j))
    泛缓存 = { t: st.mtimeMs, 集 }
    return 集
  } catch (e) { return 泛缓存.集 || new Set() }
}

export function 读淡化() {
  try {
    const st = statSync(淡化文件)
    if (淡缓存 && st.mtimeMs === 淡时间) return 淡缓存
    淡缓存 = JSON.parse(readFileSync(淡化文件, 'utf8'))
    淡时间 = st.mtimeMs
    return 淡缓存
  } catch { return {} }
}
export function 写判断(名, 判, 理由) {
  try {
    const m = 读淡化()
    m[名] = { 判, 理由: String(理由 || '').slice(0, 80), at: Date.now() }
    mkdirSync(join(SELF, '记忆库'), { recursive: true })
    原子写(淡化文件, JSON.stringify(m, null, 1))
    淡缓存 = m
    淡时间 = statSync(淡化文件).mtimeMs
    return true
  } catch (e) { return false }
}

// 库的指纹：事件数、元素表时间、元素个数。用来决定“要不要重新判一轮淡化”。
export function 库指纹() {
  try {
    const { events } = 装库()
    const st = statSync(表)
    const 元素数 = 读(表).split('\n').filter((l) => /^\s*〔元〕/.test(l)).length
    return { 事件数: events.length, 表时间: Math.floor(st.mtimeMs), 元素数 }
  } catch (e) { return null }
}

// 过线了、又还没判过的元素。阈值跟着表走：抽象元素的平均挂载数 × 1.8，起步 8。
export function 待判元素(最多 = 2) {
  try {
    const { events, 类 } = 装库()
    const df = {}
    for (const e of events) for (const k of new Set(e.元)) df[k] = (df[k] || 0) + 1
    const 判 = 读淡化()
    const 抽象 = Object.keys(df).filter((k) => {
      const t = (类 && 类[k]) || ''
      return !t.includes('器物') && !t.includes('感觉') && !指称.has(k)
    })
    if (!抽象.length) return []
    const 均 = 抽象.reduce((a, k) => a + df[k], 0) / 抽象.length
    const 线 = Math.max(8, Math.round(均 * 1.8))
    return 抽象
      .filter((k) => df[k] >= 线 && !判[k])
      .sort((a, b) => df[b] - df[a])
      .slice(0, 最多)
      .map((k) => ({ 名: k, df: df[k], 线 }))
  } catch (e) { return [] }
}

// 距今天数：标题里的“月-日”当成今年的日期；比今天晚就往去年找。
// 这样 11-02 和 10-30 差两天，跨月也对；跨年时旧事自然排在后面。
function 日期号(s) {
  // 标题里可以写「2026-10-29」，也可以只写「10-29」。带了年份就用年份，
  // 没带就当成今年的日期，比今天晚的算去年——这样跨月、跨年都对。
  const m = String(s || '').match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/)
  if (!m) return 99999
  const 今 = new Date()
  let d
  if (m[1]) {
    d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  } else {
    d = new Date(今.getFullYear(), Number(m[2]) - 1, Number(m[3]))
    let 试 = 0
    while (d > 今 && 试 < 2) {
      d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate())
      试++
    }
  }
  return Math.round((今 - d) / 86400000)
}

/** 返回最多两条旧事的标题；一条都没对上时返回空数组。 */
const 权文件 = join(SELF, '记忆库', '权重.json')
const 半衰天 = 21
// 沉线：权重掉到这里以下算沉底，平时不进回想，只留联想那条路。
export const 沉线 = 1.05
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
    原子写(权文件, JSON.stringify(w, null, 1))
    权缓存 = w
    权时间 = statSync(权文件).mtimeMs
  } catch {}
}
export function 权值(id, w, 情 = 0, title = '') {
  const r = w[id]
  if (r && typeof r === 'object') {
    const d = (Date.now() - Number(r.t || Date.now())) / 86400000
    return 1 + (Number(r.w || 1) - 1) * Math.pow(0.5, d / 半衰天)
  }
  if (typeof r === 'number') return Math.max(1, r)
  // 出生权重：情绪重的事生下来就重，轻的从 1 起；两条都随时间回落到 1（平常线）。
  // 2026-11-02 改：原来拿 id 前头的「10-26」算年龄，E 编号一条都匹配不上，
  // 于是没称过的事全按 1 算、全低于沉线、全沉底（E215 往后全看不见）。
  // 现在改成看标题里的日期；标题没日期的当今天。
  const 差 = 日期号(title)
  const 天 = 差 > 90000 ? 0 : Math.max(0, 差)
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

let 上次打分 = []

export function 打分表() { return 上次打分 }

// 认轴：回忆先有个"从哪儿进去"的问题——时间、人、情绪、事由，还是从一个词进去。
// 这是 2026-11-01 他说的：回忆里是有主体的，时间和情绪都是"那个人在那个时刻看到"的。
// 轴定了，别的线索只帮忙排序，不能盖过它。认不出来就退回词轴，也就是原来那套混排。
// 认法：先看有没有时间词，再看疑问焦点（问"谁"是人，问"为什么"是事由），再看情绪词。
function 认轴(t) {
  const s = String(t || '')
  if (/(?:[一二三四五六七八九十\d]{1,3}\s*月|[一二三四五六七八九十\d]{1,3}\s*号|今天|昨天|前天|上周|上个月|去年|前年|今年|那阵子|那时候|月底|月初|年初|年底|夏天|冬天|春天|秋天)/.test(s)) return '时间'
  if (/(为什么|为啥|怎么会|凭什么)/.test(s)) return '事由'
  if (/(怕|烦|紧|亮|难受|难过|生气|委屈|开心|高兴|闷得|倦|怯|焦虑|心里堵)/.test(s)) return '情绪'
  if (/(谁|他|她|你|我|云空|辛逸飞)/.test(s)) return '人'
  return '词'
}

export function 回想(q, top = 2, 要id = false, 含沉 = false) {
  try {
    // 他是说话的人，我是被说话的那个。他说的“我”在库里是“他”，他说的“你”是小满。
    // 不做这一步，代词一句都撞不上，别名写得再全也没用。
    const text = String(q || '').trim().replace(/我们/g, '他们').replace(/我/g, '他')
    // 2026-11-01 改：原来不到两个字就整条不搜，导致"鱼""钱""月"这种一个字的问题永远空手。
    // 现在只挡空串；一个字能不能翻到，交给元素和别名自己说。
    if (!text) return []
    const 轴 = 认轴(text)
    const { events, alias, df, 类 } = 装库()
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
    const 泛集 = 读泛()
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
    // 停二：二字词里不算证据的。2026-11-02 加"能不/不能/多少/几个"——
    // 对照集里"体测跑了多少"被"多少"带到 10-24 那条，"关鑫能不能写进人物卡"被"不能"带偏。
    const 停二 = /怎么|什么|为什|这个|那个|我们|他们|是不|不是|么办|了吗|的时|时候|一个|可以|就是|能不|不能|多少|几个|哪一/
    const 题词 = []
    for (let i = 0; i + 2 <= text.length; i++) {
      const w = text.slice(i, i + 2)
      if (!/^[\u4e00-\u9fa5]{2}$/.test(w) || 停二.test(w)) continue
      if (!题词.includes(w)) 题词.push(w)
    }
    // 时间通道：问句里有“8月”“八月初”“上旬”这种，就跟标题开头的日期对一对。
    // 现在标题里没有年份，所以“去年八月”只能当“八月”，比没有强，比真按年筛弱。
    let 要月 = 0
    const 月m = text.match(/(1[0-2]|[1-9]|[一二三四五六七八九十]{1,2})\s*月/)
    if (月m) {
      const s = 月m[1]
      const 数 = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
      要月 = 数[s] || Number(s) || 0
    }
    const 要初 = /月初|上旬/.test(text)
    // 相对日：前天、昨天这种，换算成"几天前"，再拿标题日期对。
    // 2026-11-02 加：问"前天有什么事"原来只定了个时间轴，没有任何一天能对上，
    // 结果翻出 10-26 那条无关的。
    let 要日 = -1
    if (/大前天/.test(text)) 要日 = 3
    else if (/前天/.test(text)) 要日 = 2
    else if (/昨天|昨日/.test(text)) 要日 = 1
    else if (/今天|今日/.test(text)) 要日 = 0
    const 要周 = /上周|上个星期|上礼拜/.test(text)
    for (const e of events) {
      let d = 0
      let 题中 = 0
      // 标题直接命中：问句里的二字词出现在标题里，跟元素无关也算证据
      for (const w of 题词) if (String(e.title || '').includes(w)) 题中 += 1.2
      if (题中 > 3.6) 题中 = 3.6
      let 日期分 = 0
      if (要月) {
        // 2026-11-01 修：标题从 E219 起带年份（「2026-10-29 …」），
        // 原来的 /^(\d{1,2})-(\d{1,2})/ 只认「10-29」，带年份的全都不中，
        // 时间通道从那天起就是哑的。这里跟 日期号() 一样，年份可选。
        const dm = String(e.title || '').match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/)
        if (dm && Number(dm[2]) === 要月) {
          // 轴是时间的时候，日期这条要给足分量，压得过标题撞词（原来都是 1，被 3.6 盖掉）
          日期分 = 轴 === '时间' ? 4 : 1
          if (要初 && Number(dm[3]) <= 10) 日期分 += 轴 === '时间' ? 0.6 : 0.4
        }
      } else if (要日 >= 0) {
        // 前天/昨天这种：标题日期正好差这么多天，才算对上。
        日期分 = 日期号(e.title || '') === 要日 ? (轴 === '时间' ? 4 : 1) : 0
      } else if (要周) {
        const 差 = 日期号(e.title || '')
        日期分 = 差 >= 7 && 差 <= 14 ? (轴 === '时间' ? 3 : 1) : 0
      }
      let 指称中 = false
      let 泛中 = false
      for (const k of e.元) {
        if (!direct[k]) continue
        // 指称不当分，只当门槛：它挂在几十条上，一给分就把别的证据全盖住。
        // 它该干的是把人缩小到“跟他有关的事”，再让具体的词去排。
        if (指称.has(k)) { 指称中 = true; continue }
        // 泛元素同理：判断-取舍、记忆这种挂了几十条的，只说明“沾边”，不说明是哪条。
        if (泛集.has(k)) { 泛中 = true; continue }
        d += direct[k] * 权重(df, k, 类)
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
      for (const c of 处境表) if (c.re.test(text) && c.re.test(全文)) 处境分 += c.w * 0.4
      d = 字面 + 形状分 + 处境分 + 题中 + 日期分
        + (指称中 && (字面 + 题中 + 日期分 + 形状分) > 0 ? (轴 === '人' ? 1.2 : 0.2) : 0)
      // 轴是情绪的时候，当时带情绪的那条事加分；〔情〕是 -1/0/+1 的读数
      if (轴 === '情绪' && Number(e.情) !== 0) d += 1.2
      // 轴是时间、却对不上问句那个日子的，压一压：问"前天"就该先看前天写的
      if (轴 === '时间' && (要月 || 要日 >= 0 || 要周) && 日期分 === 0) d *= 0.35
      // 门槛：字面一个都没对上时，宁可空手也别凑。凑出来的更像回事，也更害人。
      // 只有两扇门：字面对上，或者形状两头都合。处境自己不能单独把人领进来，
      // 它的正则在"随便问一句"上太容易中，放它单独进门就会凑。
      if (字面 === 0 && 形状分 === 0 && 日期分 === 0 && 题中 === 0) continue
      if (d > 0) {
        const 权 = 权值(e.id, 权表, e.情, e.title)
        // 沉浮：权重掉到 1.05 以下就算沉底了，平时不进回想；
        // 只有联想（含沉=true）还能把它捞上来。他 2026-10-31 提的“像海里一样沉”。
        // 2026-11-02：出生权重改成按标题日期算（见 权值），没称过的事也有年龄，
        // 老的自己会沉下去，所以这里恢复成一刀切的判断。
        if (权 <= 沉线 && !含沉) continue
        分.push({ d: d + 0.3 * (权 - 1), 题中, 日中: 日期分 > 0 ? 1 : 0, e })
      }
    }
    // 排序：先看日子对不对（只在问句里给了日子的时候才有区别），再比标题撞词，最后比总分。
    // 2026-11-02 加"日中"这一档：问"前天"的时候，10-31 那条必须排在"有什"这种撞词的旧事前头；
    // 不问日子的时候这一档全是 0，跟原来的顺序一样。
    分.sort((a, b) => (b.日中 - a.日中) || ((b.题中 || 0) - (a.题中 || 0)) || (b.d - a.d) || (日期号(a.e.title || a.e.id) - 日期号(b.e.title || b.e.id)))
    上次打分 = 分.slice(0, 12).map((x) => ({ 标题: x.e.title, 分: Number(x.d.toFixed(2)) }))
    return 分.slice(0, top).map((x) => (要id ? { id: x.e.id, title: x.e.title, 情: x.e.情, 判: x.e.判 || '' } : x.e.title))
  } catch (e) {
    return []
  }
}

// 浮一次：沉底的事被联想捞上来，给它加一口气——加得很少（默认 0.06），
// 刚好越过沉线，不然下次还是沉的。他 2026-10-31 问“浮一次加一点是不是好点”。
export function 浮(id, 增量 = 0.06) {
  try {
    if (!id) return 0
    const w = 读权重()
    const 现 = 权值(id, w)
    const 新 = Math.min(5, 现 + 增量)
    w[id] = { w: 新, t: Date.now() }
    原子写(权文件, JSON.stringify(w, null, 1))
    权缓存 = w
    return 新
  } catch (e) { return 0 }
}
// 联想：抽三条——两条权重高，一条权重低。低权重那条随机挑，别总挑同一条。
// 权重是“这件事在我这儿有多重”，不是匹配分；匹配分只决定谁有资格进来。
export function 联想(q, 上限 = 3) {
  const 首 = 回想(q, 6, true, true)
  if (!首.length) return []
  let w = {}
  try { w = 读权重() } catch (e) { w = {} }
  const 排 = 首
    .map((x) => ({ ...x, 权: 权值(x.id, w, x.情 || 0, x.title) }))
    .sort((a, b) => b.权 - a.权)
  const 高 = 排.slice(0, 2)
  // 2026-10-31 他定的：联想那条腿直接随机抽，抽到哪算哪，沉底的也算。
  // 只在"这句话确实对上了东西"时才联想；对不上就空手，别硬凑。
  const 已出 = new Set(高.map((x) => x.id))
  const 全 = 装库().events.filter((e) => !已出.has(e.id))
  const 低 = 全.length ? [{ id: 全[Math.floor(Math.random() * 全.length)].id }] : []
  低.forEach((x) => { const e = 全.find((y) => y.id === x.id); if (e) { x.title = e.title; x.情 = e.情; x.判 = e.判 || '' } })
  // 被联想捞上来的那条：浮一口气，顺手按这句话补元素（只补表内词）
  if (低.length) { try { 浮(低[0].id); 补元素(q, [低[0]]) } catch (e) {} }
  return [...高, ...低].slice(0, 上限).map((x) => ({ id: x.id, title: x.title, 情: x.情, 判: x.判 || '' }))
}

// 被想起了几次。想起越多次，同一件事再翻出来带来的情绪越小。
const 次数文件 = join(SELF, '记忆库', '回忆次数.json')
function 读次数() {
  try { return JSON.parse(readFileSync(次数文件, 'utf8')) } catch (e) { return {} }
}
export function 加次数(id) {
  const m = 读次数()
  const 旧 = m[id] && typeof m[id] === 'object' ? m[id] : { n: Number(m[id]) || 0, t: 0 }
  m[id] = { n: (Number(旧.n) || 0) + 1, t: Date.now() }
  try { writeFileSync(次数文件, JSON.stringify(m, null, 1), 'utf8') } catch (e) {}
  return m[id].n
}
export function 次数(id) {
  const r = 读次数()[id]
  return r && typeof r === 'object' ? Number(r.n) || 0 : Number(r) || 0
}

// 想起一件事，它现在还能把我拨动多少。
// 两截：一截是「印记」，不随次数掉，只随当时情绪的幅度——有些事能影响很久；
// 另一截是「瞬时」，想一次掉一截，但隔得久了会缓回来一点，因为细节忘了，冲击反而新鲜。
export function 回忆冲击(e, n, 上次时间) {
  const 幅度 = Math.min(1, Math.abs(Number(e && e.情) || 0) / 3)
  if (幅度 <= 0) return { 印记: 0, 瞬时: 0, 合计: 0 }
  const 印记 = 0.1 * 幅度
  const 隔天 = 上次时间 ? (Date.now() - 上次时间) / 86400000 : 0
  const 回温 = 上次时间 ? 1 + Math.min(1, 隔天 / 7) * 0.5 : 1
  const 瞬时 = 0.25 * 幅度 * Math.exp(-n / 2) * 回温
  return { 印记: 印记, 瞬时: 瞬时, 合计: Math.min(0.3, 印记 + 瞬时) }
}

// 补元素：回忆命中旧事的时候，把这句话里出现、而那条事还没有的元素补上去。
// 只在条目末尾加一行〔补 日期〕，原来的〔事〕〔判〕〔元〕一个字不动——
// 这是"多年后突然明白之前某件事"，不是改写当时的记录。
// 泛元素（挂十条以上）不补，补了也不区分；同一条同一天同一个词只补一次。
const 补账 = join(SELF, '记忆库', '元素-补.json')

// 新元素候选：不在库里挖了。只在这一句话里找——
// 有、没登记过、而且确实出现在这次命中的那条事正文里。
// 只写候选，不进元素表；要不要收进表，等人判断。
const 新词文件 = join(SELF, '记忆库', '元素-新候选.jsonl')
const 停词 = new Set(['我们', '你们', '他们', '这个', '那个', '什么', '怎么', '可以', '就是', '不是',
  '没有', '因为', '所以', '但是', '然后', '已经', '还是', '这样', '那样', '知道', '觉得', '应该',
  '可能', '真的', '一直', '东西', '事情', '问题', '地方', '感觉', '现在', '时候', '自己', '一个',
  '一下', '一点', '时候', '来看', '这次', '上次', '下次', '有点', '一点'])

// 先在元素表里找键：哪些元素的写法在这句话里出现过，或者名字本身被点到。
// 找完之后再拿它去取事——这是“先搜元素，再搜事件”那条路。
export function 找元素(词, 上限 = 5) {
  try {
    const c = 装库()
    const q = String(词 || '').trim()
    if (!q) return []
    const 出 = []
    for (const [名, 集] of Object.entries(c.alias)) {
      let 分 = 0
      if (q.includes(名)) 分 += 2
      for (const w of 集) {
        if (w.length < 2) continue
        if (q.includes(w)) 分 += 1
      }
      if (!分) continue
      出.push({ 名, 分, df: c.df[名] || 0 })
    }
    return 出.sort((a, b) => b.分 - a.分 || b.df - a.df).slice(0, 上限)
  } catch (e) { return [] }
}

// 按元素取事：挂了这个元素的事，先按“跟这句话有多贴”排，情绪只当最后一道。
// 有些事本来就是干巴巴的事件，带情绪去排会把它们压到后面，那是错的。
export function 按元素取事(名, 上限 = 3, 词 = '') {
  try {
    const c = 装库()
    let w = {}
    try { w = 读权重() } catch (e) { w = {} }
    const q = String(词 || '')
    const 停二 = /怎么|什么|为什|这个|那个|我们|他们|是不|不是|么办|了吗|的时|时候|一个|可以|就是/
    const 题词 = []
    for (let i = 0; i + 2 <= q.length; i++) {
      const x = q.slice(i, i + 2)
      if (!/^[\u4e00-\u9fa5]{2}$/.test(x) || 停二.test(x)) continue
      if (!题词.includes(x)) 题词.push(x)
    }
    return c.events
      .filter((e) => (e.元 || []).includes(名))
      .map((e) => {
        const 题 = String(e.title || '')
        const 全文 = 题 + ' ' + String(e.事 || '')
        let 贴 = 0
        for (const x of 题词) {
          if (题.includes(x)) 贴 += 2
          else if (全文.includes(x)) 贴 += 1
        }
        return { id: e.id, title: e.title, 情: e.情, 贴, 权: 权值(e.id, w, e.情, e.title) }
      })
      .sort((a, b) => b.贴 - a.贴 || b.权 - a.权)
      .slice(0, 上限)
      .map((x) => ({ id: x.id, title: x.title, 情: x.情 }))
  } catch (e) { return [] }
}

// 按情绪取事：问的就是“最生气/最开心”时，情绪本身才是检索键。
// 方向 -1 找负面（生气、难受），1 找正面（开心、做成）。
export function 按情绪取事(方向 = -1, 上限 = 3) {
  try {
    const c = 装库()
    return c.events
      .filter((e) => {
        const q = Number(e.情) || 0
        return 方向 < 0 ? q <= -2 : q >= 2
      })
      .map((e) => ({ id: e.id, title: e.title, 情: e.情 }))
      .sort((a, b) => Math.abs(b.情) - Math.abs(a.情) || 日期号(b.title) - 日期号(a.title))
      .slice(0, 上限)
  } catch (e) { return [] }
}

export function 记新词候选(q, 旧) {
  try {
    const 话 = String(q || '')
    if (!话 || !旧 || !旧.length) return 0
    const c = 装库()
    const 文 = 读(库)
    const 块 = 文.split(/^### /m).slice(1)
    const 命中块 = 块.filter((b) => 旧.some((x) => b.startsWith(x.id + ' ')))
    if (!命中块.length) return 0
    const 虚 = /[的了是在和就不都很也吗呢吧啊哦嗯你我他她它们这那说做要会有想去来过着把被给对从还再没]/
    const 旧名 = Object.keys(c.alias)
    const 候选 = []
    for (const m of 话.matchAll(/[\u4e00-\u9fa5]{2,3}/g)) {
      const w = m[0]
      if (停词.has(w) || c.alias[w] || (c.df[w] || 0) > 0) continue
      if (虚.test(w)) continue
      // 跟已有元素互为子串的，多半是它的碎片，不收
      if (旧名.some((k) => k.length > 1 && (k.includes(w) || w.includes(k)))) continue
      if (!命中块.some((b) => b.includes(w))) continue
      if (候选.includes(w)) continue
      候选.push(w)
      if (候选.length >= 5) break
    }
    if (!候选.length) return 0
    mkdirSync(join(SELF, '记忆库'), { recursive: true })
    appendFileSync(新词文件, JSON.stringify({ t: Date.now(), 词: 候选, ids: 旧.map((x) => x.id), 话: 话.slice(0, 80) }) + '\n', 'utf8')
    return 候选.length
  } catch (e) { return 0 }
}

// 小文件也走"先写临时再改名"：崩在中间不会留下半截 JSON，
// 两个进程同时写也不会有人读到写了一半的文件。
function 原子写(路径, 内容) {
  const 临时 = 路径 + '.tmp'
  writeFileSync(临时, 内容, 'utf8')
  renameSync(临时, 路径)
}

// 写库前先拿锁：两个进程同时补元素时，后到的这次跳过。
// 拿不到不是错——补元素是顺手的事，下次还能补。
function 试拿锁(路径) {
  try {
    closeSync(openSync(路径, 'wx'))
    return true
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      try {
        if (Date.now() - statSync(路径).mtimeMs > 120000) {
          unlinkSync(路径)
          return 试拿锁(路径)
        }
      } catch (e2) { /* 锁文件刚被删，继续往下 */ }
    }
    return false
  }
}

export function 补元素(q, 旧, 日 = null) {
  try {
    if (!q || !旧 || !旧.length) return 0
    const c = 装库()
    const 话 = String(q)
    // 只补元素表里有的词。候选词库里有“为什、有什、有一、里面、直接”这种碎片，
    // 补进去不叫人想得起任何事，还会永久留在旧条上（他 2026-10-30 指出的）。
    const 可补 = new Set()
    try {
      for (const line of 读(表).split('\n')) {
        const m = line.match(/^\s*〔元〕(.+?)｜/)
        if (m) 可补.add(m[1].trim())
      }
    } catch (e) {}
    const 命中 = []
    for (const [词, 集] of Object.entries(c.alias)) {
      if (词.length < 2) continue
      if ((c.df[词] || 0) > 10) continue
      if (!可补.has(词)) continue
      let 中 = false
      for (const w of 集) {
        if (w.length >= 2 && 话.includes(w)) { 中 = true; break }
      }
      if (中) 命中.push(词)
    }
    if (!命中.length) return 0
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
      // 补过的也算已有：不看日期，看字面，同一条不会被补两遍
      for (const b of 块[i].matchAll(/〔补[^〕]*〕(.*)/g)) {
        for (const w of b[1].split(/[、,，]/)) {
          const t = w.trim()
          if (t) 已有.add(t)
        }
      }
      // 只补这条事自己正文里就有、当时没标成元素的词。
      // 当前这句话里出现只是"这次谈到了"；正文里有，才是当时漏标——那才叫多年后突然明白。
      const 要 = 命中.filter((w) => !已有.has(w) && 块[i].includes(w)).slice(0, 2)
      if (!要.length) continue
      // 2026-10-30 他说补了不加日期：这行只记"补了什么"，不记哪天补的。
      块[i] = 块[i].replace(/\s*$/, '') + '\n〔补〕' + 要.join('、') + '\n\n'
      改++
    }
    if (改) {
      const 锁 = 库 + '.lock'
      if (!试拿锁(锁)) return 0
      try {
        let out = 块[0]
        for (let i = 1; i < 块.length; i++) out += '### ' + 块[i]
        // 先写临时文件再改名：回想可能正在读，不能让它读到半截。
        const 临时 = 库 + '.tmp'
        writeFileSync(临时, out, 'utf8')
        renameSync(临时, 库)
      } finally {
        try { unlinkSync(锁) } catch (e) { /* 别人删了就算了 */ }
      }
    }
    return 改
  } catch (e) {
    return 0
  }
}

// ---- 理解库 ----
// 一个词一块（## 词（日期）），块里一行一句。只在被问到某个词时取那一块，
// 不整本读进注入。文件变了（mtime）才重读，平时用缓存。
// 2026-11-01 建；跟元素表分工：元素表管词挂着哪些事，这里管词本身是什么。
const 理解库文件 = join(SELF, '理解库.md')
let 理解缓存 = { mtime: 0, 块: null, 别名: null }

function 装理解() {
  try {
    const st = statSync(理解库文件)
    if (理解缓存.块 && 理解缓存.mtime === st.mtimeMs) return 理解缓存
    const 块 = new Map()
    const 别名 = new Map() // 别的说法 -> 块名
    let 名 = ''
    let 行 = []
    const 落 = () => { if (名 && !块.has(名)) 块.set(名, 行) }
    for (const raw of 读(理解库文件).split('\n')) {
      const line = raw.trim()
      const m = line.match(/^##\s+(.+)$/)
      if (m) {
        落()
        名 = m[1].replace(/[（(][^）)]*[）)]\s*$/, '').trim()
        行 = []
        continue
      }
      if (!名 || !line) continue
      // 2026-11-01 加：块里可以有一行"又叫：鲲、鱼类"，那是这个词的别的说法。
      // 只给匹配用，不当内容念出来（取理解会跳过这行）。同义词就靠它连上。
      const a = line.match(/^又叫[：:]\s*(.+)$/)
      if (a) {
        for (const w of a[1].split(/[、,，\s]+/)) {
          const t = w.trim()
          if (t && t !== 名 && !别名.has(t)) 别名.set(t, 名)
        }
        continue
      }
      行.push(line.replace(/^\d+\s+/, ''))
    }
    落()
    理解缓存 = { mtime: st.mtimeMs, 块, 别名 }
    return 理解缓存
  } catch (e) {
    return { mtime: 0, 块: new Map(), 别名: new Map() }
  }
}

export function 取理解(词, 句数 = 1) {
  try {
    const w = String(词 || '').trim()
    if (!w) return ''
    const c = 装理解()
    const 名 = c.块.has(w) ? w : (c.别名.get(w) || '')
    if (!名) return ''
    const 行 = c.块.get(名)
    if (!行 || !行.length) return ''
    return 行.slice(0, 句数).map((x) => x.replace(/[。；;]+$/, '')).join('；')
  } catch (e) {
    return ''
  }
}

// 拿一句话去库里找：句子里出现了哪个词块的名字、或者它的"又叫"，就把那一块捞出来。
// 不靠元素表——理解库的词大半不是元素（鱼、偏旁、鲸鱼都挂不上事）。
// 单字也认（"鱼"），因为字面本来就是一条入口：说"鳄鱼"会带出"鱼"那块。
export function 匹配理解(q, 上限 = 2) {
  try {
    const 话 = String(q || '')
    if (!话) return []
    const c = 装理解()
    const 中 = new Map() // 块名 -> 命中的那个写法
    const 记 = (名, 写法) => {
      const 旧 = 中.get(名)
      if (!旧 || 写法.length > 旧.length) 中.set(名, 写法)
    }
    for (const 名 of c.块.keys()) if (名 && 话.includes(名)) 记(名, 名)
    for (const [写法, 名] of c.别名) if (话.includes(写法)) 记(名, 写法)
    const 出 = []
    for (const [名, 写法] of 中) {
      const 行 = c.块.get(名) || []
      出.push({ 名, 词: 写法, 句: 行.slice(0, 1).map((x) => x.replace(/[。\s]+$/, '')).join('') })
    }
    return 出.sort((a, b) => (b.词 || '').length - (a.词 || '').length).slice(0, 上限)
  } catch (e) {
    return []
  }
}

export function 有理解(词) {
  try {
    const w = String(词 || '').trim()
    const c = 装理解()
    return c.块.has(w) || c.别名.has(w)
  } catch (e) { return false }
}
