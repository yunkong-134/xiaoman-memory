// 记忆放哪：环境变量 DSH_MEMORY_DIR 优先，没给就 ~/.dsh/memory。
// 全是纯文本，换机器拷这个文件夹就行。
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const 记忆目录 = process.env.DSH_MEMORY_DIR || join(homedir(), '.dsh', 'memory')
export const 记忆库目录 = join(记忆目录, '记忆库')
export const 状态目录 = join(记忆目录, '.state')
export const 资源目录 = join(dirname(dirname(fileURLToPath(import.meta.url))), 'assets')

export const 文件 = {
  库: join(记忆库目录, '事件库.md'),
  表: join(记忆目录, '元素表.md'),
  多义: join(记忆目录, '元素-多义表.md'),
  别名: join(记忆目录, '元素-别名.json'),
  理解: join(记忆目录, '理解库.md'),
  第一条: join(记忆目录, '第一条.md'),
  候选: join(记忆库目录, '元素-候选.json'),
  补: join(记忆库目录, '元素-补.json'),
  权重: join(记忆库目录, '权重.json'),
  泛: join(记忆库目录, '元素-泛.json'),
  淡化: join(记忆库目录, '元素-淡化.json'),
  待审: join(记忆库目录, '元素-待审.md'),
  全忆目录: join(记忆目录, '全忆'),
  体检: join(状态目录, '体检.json'),
  长元素记号: join(状态目录, '长元素.done'),
  日志: join(状态目录, 'diag.log'),
  配置: join(记忆目录, 'config.json'),
}

// 第一次装才铺模板。
// 目录在、库不在，多半是盘没挂上或者文件被移走，这时候补一份空的会把事故盖住，
// 所以只有库和元素表都不在（真·新目录）时才铺，其余情况让库体检自己喊。
export function 备好目录() {
  mkdirSync(记忆库目录, { recursive: true })
  mkdirSync(状态目录, { recursive: true })
  try { mkdirSync(文件.全忆目录, { recursive: true }) } catch (e) { /* 建不了就等下次 */ }
  const 全新 = !existsSync(文件.库) && !existsSync(文件.表)
  const 补 = []
  if (全新) 补.push(['事件库.md', 文件.库], ['元素表.md', 文件.表], ['元素-多义表.md', 文件.多义])
  else if (!existsSync(文件.表)) 补.push(['元素表.md', 文件.表])
  if (!existsSync(文件.多义)) 补.push(['元素-多义表.md', 文件.多义])
  for (const [名, 到] of 补) {
    try { copyFileSync(join(资源目录, 名), 到) } catch (e) { /* 模板缺了就不铺，回想会空手回来 */ }
  }
  // 第一条怎么写：每台机器放一份，写在记忆目录里，改起来方便，
  // 也省得人去翻包里的文档。
  try {
    if (!existsSync(文件.第一条)) copyFileSync(join(资源目录, '第一条.md'), 文件.第一条)
  } catch (e) { /* 模板缺了就算了 */ }
  // 全忆怎么用：一句话说明也铺过去，别让人去翻包
  try {
    const 说明 = join(文件.全忆目录, '说明.md')
    if (!existsSync(说明)) copyFileSync(join(资源目录, '全忆-说明.md'), 说明)
  } catch (e) { /* 同上 */ }
  try {
    if (!existsSync(文件.别名)) writeFileSync(文件.别名, '{}\n', 'utf8')
  } catch (e) { /* 同上 */ }
}

export function 读配置() {
  const 默认 = { recentDays: 2, staleHours: 20, top: 2, log: true }
  try {
    const o = JSON.parse(readFileSync(文件.配置, 'utf8'))
    return { ...默认, ...(o && typeof o === 'object' ? o : {}) }
  } catch (e) {
    return 默认
  }
}
