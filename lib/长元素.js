// 长元素：库里的字自己长出来的候选元素。只读事件库，写一个候选文件，不碰元素表。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { 文件, 记忆库目录 } from './paths.js'

const 库 = 文件.库
const 表 = 文件.表
const 别名表 = 文件.别名
const 出 = 文件.候选

// 这些词到处都是，长出来也没用
const 停 = new Set([
  '我们', '你们', '他们', '自己', '现在', '时候', '一个', '一下', '这个', '那个', '什么', '怎么',
  '可以', '就是', '不是', '没有', '因为', '所以', '但是', '而且', '然后', '已经', '还是', '这样',
  '那样', '知道', '觉得', '应该', '可能', '真的', '一直', '很多', '东西', '事情', '问题', '地方',
  '感觉', '一点', '不会', '不能', '不用', '起来', '出来', '下来', '上来', '过来', '回去', '以后',
  '之前', '之后', '的话', '其实', '开始', '最后', '第一', '第二', '一次', '一种', '有点儿', '有点',
  '要么', '或者', '如果', '虽然', '不过', '只是', '还有', '另外', '同时', '于是', '比较', '非常',
  '特别', '更加', '稍微', '大概', '好像', '似乎', '当然', '确实', '居然', '果然', '赶紧', '马上',
  '立刻', '刚刚', '刚才', '后来', '从前', '将来', '今天', '明天', '昨天', '早上', '晚上', '中午',
  // 10-27 第二遍：挖出来的废话，一个个记下来，下一轮别再冒
  '或许', '一条', '一句', '为什么', '有什么', '关于', '看到', '想到', '看看', '记得', '回答', '个人',
  '新对', '补一', '层意', '我会', '你要', '他说', '她说', '我要', '你想', '以及', '那么', '这么',
  '不过', '其实', '开始', '最后', '之后', '之前', '以后', '现在', '地方', '东西', '事情', '问题',
  '感觉', '知道', '应该', '可能', '真的', '非常', '特别', '比较', '稍微', '大概', '好像', '当然',
  '确实', '居然', '果然', '赶紧', '马上', '立刻', '刚刚', '后来', '从前', '将来', '今天', '明天',
])

function 读(文件) {
  try {
    return readFileSync(文件, 'utf8')
  } catch (e) {
    return ''
  }
}

function 去掉标点(s) {
  return String(s || '')
    .replace(/｜/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：、“”‘’（）《》〈〉…—\-.!?,;:"'()\[\]{}0-9A-Za-z_/\\|+*=<>~`@#$%^&]+/g, ' ')
}

function 拆事(文) {
  const out = []
  for (const p of 文.split(/^### /m).slice(1)) {
    const nl = p.indexOf('\n')
    const head = (nl < 0 ? p : p.slice(0, nl)).trim()
    const body = nl < 0 ? '' : p.slice(nl)
    const id = head.split(/\s+/)[0]
    const 事 = (body.match(/〔事〕(.*)/) || [])[1] || ''
    if (id) out.push({ id, 文: 去掉标点(head.split(/\s+/).slice(1).join(' ') + ' ' + 事.slice(0, 240)) })
  }
  return out
}

/** 已有元素与别名，候选里出现过的就别再提。 */
function 已有词() {
  const s = new Set()
  for (const line of 读(表).split('\n')) {
    const mm = line.match(/^\s*〔元〕(.+?)｜.*?｜别名[：:](.*?)｜/)
    if (!mm) continue
    s.add(mm[1].trim())
    for (const w of mm[2].split(/[、,，/\s]+/)) if (w.trim()) s.add(w.trim())
  }
  try {
    const 补 = JSON.parse(读(别名表))
    for (const k of Object.keys(补)) {
      if (k.startsWith('_')) continue
      s.add(k)
      for (const w of 补[k] || []) if (String(w).trim()) s.add(String(w).trim())
    }
  } catch (e) {}
  return s
}

export function 长元素() {
  const 事们 = 拆事(读(库))
  if (!事们.length) return { n: 0, 顶级: [] }
  const 见过 = 已有词()
  const df = new Map() // 词 -> { n, ids }
  for (const e of 事们) {
    const 本件 = new Set()
    const 段 = e.文.split(' ')
    for (const w of 段) {
      const t = w.trim()
      if (t.length < 2) continue
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i + n <= t.length; i++) {
          const g = t.slice(i, i + n)
          if (停.has(g) || 见过.has(g) || 本件.has(g)) continue
          if (/[的了是在和就不都很也吗呢吧啊哦嗯]/.test(g)) continue
          // 代词、指名道姓的开头都不是元素：元素要能换一件事还认得出来
          if (/[我你他她它们这那就也很太更最都还又再]/.test(g)) continue
          if (/[说做是要会有想去来过的着们吧呢吗]/.test(g[g.length - 1])) continue
          if (!/^[\u4e00-\u9fa5]+$/.test(g)) continue
          本件.add(g)
          const r = df.get(g) || { n: 0, ids: [] }
          r.n++
          if (r.ids.length < 6) r.ids.push(e.id)
          df.set(g, r)
        }
      }
    }
  }
  const 候选 = []
  for (const [词, r] of df) {
    if (r.n < 3 || r.n > 60) continue
    // 长词优先：同样条数，三字比两字更具体
    候选.push({ 词, n: r.n, ids: r.ids, 分: r.n * (词.length === 3 ? 1.35 : 1) })
  }
  // 被更长的词包含的短词压一压，避免"回读"和"回读条"一起冒
  候选.sort((a, b) => b.分 - a.分)
  const 留 = []
  for (const c of 候选) {
    if (留.some((x) => x.词.includes(c.词) || c.词.includes(x.词))) continue
    留.push(c)
    if (留.length >= 80) break
  }
  const 包 = { t: new Date().toISOString(), 共事件: 事们.length, 词: {} }
  for (const c of 留) 包.词[c.词] = { n: c.n, ids: c.ids }
  try {
    mkdirSync(记忆库目录, { recursive: true })
    writeFileSync(出, JSON.stringify(包, null, 1), 'utf8')
  } catch (e) {}
  return { n: 留.length, 顶级: 留.slice(0, 12).map((c) => c.词 + '(' + c.n + ')') }
}
