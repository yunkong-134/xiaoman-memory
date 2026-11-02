// 冒烟测试：不起 DSH，拿假上下文把插件跑一遍。
// 用法：node test.mjs
// 覆盖：装完铺模板、工具挂上、体检的源对账、待补理解、memory_archive 真写一行。
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 临时 = mkdtempSync(join(tmpdir(), 'xmm-test-'))
process.env.DSH_MEMORY_DIR = 临时

const 插件 = await import('./lib/index.js')
const P = await import('./lib/paths.js')
P.备好目录()

const 失败 = []
function 检查(名, 条件, 详情 = '') {
  if (条件) console.log('  ok  ' + 名)
  else { console.log('  ×   ' + 名 + (详情 ? '  ' + 详情 : '')); 失败.push(名) }
}

console.log('一、装完铺出来的东西')
for (const [名, 路径] of [
  ['事件库.md', P.文件.库],
  ['元素表.md', P.文件.表],
  ['第一条.md', P.文件.第一条],
  ['全忆/说明.md', join(P.文件.全忆目录, '说明.md')],
]) 检查(名, existsSync(路径))

console.log('二、工具挂上了')
const 工具 = {}
const ctx = { tools: { register: (d) => { 工具[d.name] = d; return () => {} } }, agents: { roots: () => [], list: () => [] }, on: () => {} }
插件.apply(ctx)
for (const 名 of ['memory_check', 'memory_explain', 'memory_archive']) 检查(名, Boolean(工具[名]))

console.log('三、体检')
writeFileSync(P.文件.库, [
  '### E001 2026-11-02 备份断了',
  '〔事〕备份只拷了顶层就断了。',
  '〔判〕2026-11-02 任务被收走。',
  '〔源〕全忆/2026-11-02.md 09:10:00',
  '〔元〕备份',
  '〔情〕-1',
  '',
  '### E002 2026-11-02 源指错的那条',
  '〔事〕这条的源指到不存在的日子。',
  '〔判〕2026-11-02 测试用。',
  '〔源〕全忆/2026-10-01.md 08:00:00',
  '〔元〕崩溃',
  '〔情〕0',
  '',
].join('\n'), 'utf8')
mkdirSync(P.文件.全忆目录, { recursive: true })
writeFileSync(join(P.文件.全忆目录, '2026-11-02.md'), '# 2026-11-02\n\n09:10:00 他  备份跑完没\n', 'utf8')
writeFileSync(P.文件.表, [
  '    〔元〕备份｜器物｜别名：存档｜条数 1｜',
  '    〔元〕崩溃｜抽象｜别名：报错｜条数 1｜',
  '',
].join('\n'), 'utf8')

const c = await 工具.memory_check.execute({})
const 报 = c.行.join('\n')
检查('源对账能报出缺的那天', 报.includes('那天的文件不在'))
检查('待补理解能列出没写的词', 报.includes('待补理解') || 报.includes('理解库里还没写'))
检查('引用统计有输出', 报.includes('被别的条目提过'))

console.log('四、memory_archive 真写一行')
await 工具.memory_archive.execute({ 话: '这个包跑得动吗', 谁: '他', 日: '2026-11-02', 时: '10:20:30' })
const 全忆 = readFileSync(join(P.文件.全忆目录, '2026-11-02.md'), 'utf8')
检查('原话进了当天文件', 全忆.includes('### 10:20:30 他') && 全忆.includes('这个包跑得动吗'))

console.log('五、memory_explain 能解释')
const e = await 工具.memory_explain.execute({ 问: '备份跑完了吗', 期望: 'E001' })
检查('有判定', (e.行 || []).length > 0)

rmSync(临时, { recursive: true, force: true })
if (失败.length) { console.log('\n挂了 ' + 失败.length + ' 项：' + 失败.join('、')); process.exit(1) }
console.log('\n全过。')
