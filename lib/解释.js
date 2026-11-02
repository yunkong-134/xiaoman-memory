// 解释：为什么这次没想起那条事。
//
// 回想是黑箱：它只交标题，不给理由。所以「明明记过，它怎么没想起来」
// 只能靠人复现——这正是要修的那件事。
//
// 这个模块不动回想，只把它做过的事摊开：
//   这句话点到了哪些元素、想到的前几条是谁、
//   你期待的那条有没有被点到、有没有沉底、分数够不够。
import { readFileSync, statSync } from 'node:fs'
import { 文件 } from './paths.js'
import { 回想, 找元素, 权值, 沉线 } from './回想.js'

function 读(p) {
  try { return readFileSync(p, 'utf8') } catch (e) { return '' }
}

function 读权重() {
  try { return JSON.parse(readFileSync(文件.权重, 'utf8')) || {} } catch (e) { return {} }
}

function 找块(期望) {
  const 文 = 读(文件.库)
  const 块 = 文.split(/^### /m).slice(1)
  for (const b of 块) {
    const 头 = b.split('\n')[0].trim()
    if (!期望) return null
    if (头.startsWith(期望 + ' ') || 头 === 期望) {
      const 元 = (b.match(/(?:^|\n)〔元〕(.*)/) || [])[1] || ''
      const 情 = Number((b.match(/(?:^|\n)〔情〕\s*(-?[\d.]+)/) || [])[1] || 0)
      return { 头, 元: 元.split(/[、,，]/).map((x) => x.trim()).filter(Boolean), 情 }
    }
  }
  return null
}

export function 解释(q, 期望 = '') {
  const 话 = String(q || '').trim()
  const 元素 = 找元素(话, 5)
  const 前 = 回想(话, 10, true).map((x) => ({ id: x.id, 题: x.title }))
  const 判定 = []

  if (!元素.length) {
    // 没有元素命中也不一定空手：包里的回想还会按标题字面撞，
    // 所以这里要看实际交出来没有，别把话说死。
    判定.push(前.length
      ? '这句话一个元素都没点到，只靠标题里的字面撞上了几条。'
      : '这句话一个元素都没点到——库里没有哪个词能对上它，回想只能空手。')
  } else {
    判定.push('点到的元素：' + 元素.map((x) => x.名 + '(挂' + x.df + '条, 分' + x.分 + ')').join('、'))
  }

  if (!前.length) {
    判定.push('这次一条都没交出来：可能元素没挂事，也可能挂了但都被沉底挡住了。')
  } else {
    判定.push('实际交出来的前几条：' + 前.slice(0, 5).map((x) => x.id + ' ' + x.题).join(' / '))
  }

  if (期望) {
    const b = 找块(期望)
    if (!b) {
      判定.push('没找到 ' + 期望 + ' 这条事——编号写错了？或者它根本不在这份库里。')
    } else {
      const w = 读权重()
      const 权 = 权值(期望, w, b.情, b.头)
      const 交集 = b.元.filter((k) => 元素.some((e) => e.名 === k))
      const 排第 = 前.findIndex((x) => x.id === 期望) + 1
      if (排第) {
        判定.push(期望 + ' 其实已经交出来了，排第 ' + 排第 + '。'
          + (交集.length ? '（靠元素 ' + 交集.join('、') + '）' : '（没靠元素，是靠日子或标题字面撞上的）'))
      } else if (!交集.length) {
        判定.push(期望 + ' 挂的元素是 [' + b.元.join('、') + ']，这句话一个都没点到，日期也没对上，所以它进不了候选。')
      } else if (权 <= 沉线) {
        判定.push(期望 + ' 点到了 [' + 交集.join('、') + ']，但它沉底了（权重 ' + 权.toFixed(2) + ' ≤ ' + 沉线 + '）。')
      } else {
        判定.push(期望 + ' 点到了 [' + 交集.join('、') + ']，权重 ' + 权.toFixed(2) + '，但分数不够，没进前十。')
      }
    }
  }

  return { 问: 话, 元素, 前, 判定 }
}
