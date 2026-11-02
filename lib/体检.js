// 体检：只读，把格式坏的地方列出来。
//
// 为什么要有这个：写坏的地方不会报错，回想只是悄悄看不见那条。
// 一条〔元〕写漏了，那条事就永远查不到，而且没人会知道。
//
// 检查项：
//   标题  ### <id> <年-月-日> <标题>   或旧的 ### <id> <月-日> <标题>
//   每条要有〔事〕、〔元〕；〔情〕必须在 -3..3
//   元素表每行要符合 "〔元〕名｜类｜别名：…｜条数 N｜"
//   理解库每块标题带日期
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { 文件 } from './paths.js'

function 读(p) {
  try { return readFileSync(p, 'utf8') } catch (e) { return '' }
}

export function 体检() {
  const 问题 = []
  const 提醒 = []

  // ---- 事件库 ----
  const 库文 = 读(文件.库)
  const 块 = []
  const re = /^### (.+)$/gm
  let m
  const 位置 = []
  while ((m = re.exec(库文))) 位置.push({ 头: m[1].trim(), 起: m.index })
  for (let i = 0; i < 位置.length; i++) {
    const 起 = 位置[i].起
    const 终 = i + 1 < 位置.length ? 位置[i + 1].起 : 库文.length
    块.push({ 头: 位置[i].头, 体: 库文.slice(起, 终) })
  }

  const 见过 = new Set()
  const 无元 = []
  const 无事 = []
  const 坏情 = []
  let 缺年份 = 0
  for (const { 头, 体 } of 块) {
    const h = 头.match(/^(E\d+|\d{1,2}-\d{1,2})\s+((?:\d{4}-)?\d{1,2}-\d{1,2})\s+(.+)$/)
    if (!h) {
      问题.push('标题不像样：' + 头.slice(0, 50))
      continue
    }
    const id = h[1]
    if (见过.has(id)) 问题.push(id + ' 编号重复')
    见过.add(id)
    if (!/^\d{4}-/.test(h[2])) 缺年份 += 1

    const 元 = (体.match(/(?:^|\n)〔元〕(.*)/) || [])[1] || ''
    if (!元.trim()) 无元.push(id)
    else if (/某物（无名）|某物\(无名\)/.test(元)) 问题.push(id + ' 的〔元〕里夹着注释碎片')

    if (!/(?:^|\n)〔事〕\S/.test(体)) 无事.push(id)

    const 情 = (体.match(/(?:^|\n)〔情〕\s*(-?[\d.]+)/) || [])[1]
    if (情 !== undefined && Math.abs(Number(情)) > 3) 坏情.push(id + '=' + 情)
  }
  if (无元.length) 问题.push('没有〔元〕的条目：' + 无元.join('、'))
  if (无事.length) 问题.push('没有〔事〕的条目：' + 无事.join('、'))
  if (坏情.length) 问题.push('〔情〕超出 -3..3：' + 坏情.join('、'))
  if (缺年份) 提醒.push(缺年份 + ' 条标题没带年份（旧条目，不回头改）')

  // ---- 元素表 ----
  const 表文 = 读(文件.表)
  const 行 = 表文.split('\n').filter((l) => l.trim().startsWith('〔元〕'))
  const 坏行 = 行.filter((l) => !/^\s*〔元〕[^｜]+｜[^｜]*｜别名[：:].*｜条数 \d+｜/.test(l))
  if (坏行.length) 问题.push('元素表 ' + 坏行.length + ' 行格式不对，例如：' + 坏行[0].trim().slice(0, 40))
  const 名 = {}
  for (const l of 行) {
    const k = (l.match(/^\s*〔元〕([^｜]+)｜/) || [])[1]
    if (!k) continue
    const t = k.trim()
    名[t] = (名[t] || 0) + 1
  }
  const 重名 = Object.keys(名).filter((k) => 名[k] > 1)
  if (重名.length) 问题.push('元素表里重名的：' + 重名.join('、'))

  // ---- 待收的词：事件里出现过、元素表里没有 ----
  // 元素的增长就靠这一步：先列出来，人确认了再写进表。
  const 表里的 = new Set(行.map((l) => (l.match(/^\s*〔元〕([^｜]+)｜/) || [])[1]).filter(Boolean).map((x) => x.trim()))
  const 词频 = {}
  for (const { 体 } of 块) {
    const 元 = (体.match(/(?:^|\n)〔元〕(.*)/) || [])[1] || ''
    for (const w of 元.split(/[、,，]/)) {
      const x = w.trim()
      if (!x || 表里的.has(x)) continue
      词频[x] = (词频[x] || 0) + 1
    }
  }
  const 待收 = Object.keys(词频).sort((a, b) => 词频[b] - 词频[a])
  if (待收.length) 提醒.push('事件里出现、表里没有的词 ' + 待收.length + ' 个（挑着收）：' + 待收.slice(0, 20).join('、'))

  // ---- 全忆：原话那层 ----
  // 格式坏了不会报错，只是以后顺着〔源〕走回去时找不到东西。
  try {
    if (existsSync(文件.全忆目录)) {
      const 天们 = readdirSync(文件.全忆目录).filter((f) => /\.md$/.test(f) && f !== '说明.md')
      let 坏行 = 0
      let 坏名 = 0
      let 总行 = 0
      for (const f of 天们) {
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) { 坏名 += 1; continue }
        const 文 = 读(文件.全忆目录 + '/' + f)
        for (const line of 文.split('\n')) {
          const s = line.trim()
          if (!s || s.startsWith('#')) continue
          总行 += 1
          if (!/^\d{1,2}:\d{2}(:\d{2})?\s+(他|我)\s*\s+\S/.test(s)) 坏行 += 1
        }
      }
      if (坏名) 问题.push(坏名 + ' 个全忆文件名不是 YYYY-MM-DD.md')
      if (坏行) 问题.push('全忆里有 ' + 坏行 + ' 行格式不对（要 "时:分:秒 他/我 原话"）')
      if (天们.length) 提醒.push('全忆 ' + 天们.length + ' 天、' + 总行 + ' 行')
    }
  } catch (e) { /* 没有全忆目录就算了 */ }

  // ---- 理解库（有就查，没有不算错：旧版没有这一层）----
  const 理文 = 读(文件.理解)
  const 块头 = (理文.match(/^## .+$/gm) || [])
  const 坏头 = 块头.filter((h) => !/\（\d{4}-\d{2}-\d{2}\）$/.test(h.trim()))
  if (块头.length && 坏头.length) 提醒.push('理解库 ' + 坏头.length + ' 块标题没带日期')

  return {
    问题,
    提醒,
    统计: { 事件: 块.length, 元素: 行.length, 理解: 块头.length },
  }
}

export function 体检一句() {
  const r = 体检()
  if (!r.问题.length) return ''
  const 头 = r.问题.slice(0, 3).join('；')
  const 多 = r.问题.length > 3 ? '（还有 ' + (r.问题.length - 3) + ' 处）' : ''
  return '记忆库有 ' + r.问题.length + ' 处格式不对：' + 头 + 多 + '。没修的条目回想看不见，跑 memory_check 看全表。'
}
