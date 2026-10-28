// 本地测：不起 DSH，拿假会话把插件跑一遍。
// 用法：node test.mjs empty   或   node test.mjs hit
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mode = process.argv[2] || 'empty'
const dir = join(process.cwd(), '.test', 'memory-' + mode + '-' + process.pid)
process.env.DSH_MEMORY_DIR = dir

const { 备好目录, 文件 } = await import('./lib/paths.js')
const 回想 = await import('./lib/回想.js')
const 长 = await import('./lib/长元素.js')
const 插件 = await import('./lib/index.js')

let 失败 = 0
const ok = (名, 过, 补 = '') => {
  if (过) console.log('ok   ' + 名)
  else { 失败++; console.log('FAIL ' + 名 + (补 ? '  ← ' + 补 : '')) }
}

function 假会话(id, 话) {
  const 盒 = { 取: null }
  const agent = {
    session: {
      id,
      snapshotEvents: () => [{ type: 'user/message', payload: { content: 话, source: { kind: 'user' } } }],
    },
    ctx: {
      systemPrompt: {
        context: (o) => { 盒.取 = o.text },
      },
    },
  }
  return { agent, 读: () => (盒.取 ? 盒.取() : '') }
}

备好目录()
ok('模板铺好', existsSync(文件.库) && existsSync(文件.表) && existsSync(文件.别名))
ok('库是空的', (readFileSync(文件.库, 'utf8').match(/^### /gm) || []).length === 0)
ok('空库回想为空手', 回想.联想('备份脚本坏了怎么修').length === 0)

if (mode === 'empty') {
  const a = 假会话('s1', '备份脚本坏了怎么修')
  插件.apply({ agents: { roots: () => [a.agent] }, systemPrompt: {} })
  const 注入 = a.读()
  ok('空库会提一句', 注入.includes('还是空的'), 注入)
  ok('空库不乱认旧事', !注入.includes('相关旧事'), 注入)
  console.log('\n注入文本：\n' + 注入)
}

if (mode === 'hit') {
  writeFileSync(文件.表, [
    '〔元〕备份｜器物｜别名：备份脚本、backup｜整份拷贝',
    '〔元〕脚本｜器物｜别名：.ps1｜写来干活的',
    '〔元〕随身包｜器物｜别名：便携包｜拷了就能走的那份',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(文件.库, [
    '# 事件库',
    '',
    '### 10-28 备份脚本跑到一半就断',
    '〔事〕23:50 那次备份只拷了工作区顶层，剩下的没跑完。',
    '〔判〕2026-10-28 定时任务被宿主收走了，脚本本身没坏。',
    '〔源〕他 23:55 说的；备份.ps1 第 12 行',
    '〔元〕备份、脚本',
    '',
    '### 10-27 随身包在真盘上跑通',
    '〔事〕拷到 D 盘，双击装小满，库一条没少。',
    '〔判〕2026-10-27 路径改写那步是关键。',
    '〔源〕他 13:40 说的话',
    '〔元〕随身包',
    '',
    '### 10-26 视频做到六十秒',
    '〔事〕草样四跑满六十秒，缺音轨。',
    '〔判〕2026-10-26 节奏表能控住时长。',
    '〔源〕视频草样4.mp4',
    '〔元〕视频',
    '',
  ].join('\n'), 'utf8')

  const 中 = 回想.联想('备份脚本又坏了怎么办')
  ok('按元素找得到旧事', 中.length > 0 && 中[0].title.includes('备份'), JSON.stringify(中))
  ok('两跳最多两条', 中.length <= 2, JSON.stringify(中))

  const a = 假会话('s2', '备份脚本又坏了怎么办')
  插件.apply({ agents: { roots: () => [a.agent] }, systemPrompt: {} })
  const 注入 = a.读()
  ok('注入里有旧事', 注入.includes('相关旧事'), 注入)
  ok('注入里没有判断', !注入.includes('定时任务被宿主收走了'), 注入)

  const 候选 = 长.长元素()
  ok('长元素写了候选文件', existsSync(文件.候选), JSON.stringify(候选))

  rmSync(文件.库)
  const b = 假会话('s3', '备份还在吗')
  插件.apply({ agents: { roots: () => [b.agent] }, systemPrompt: {} })
  const 注入2 = b.读()
  ok('库不见了会喊', 注入2.includes('不见了'), 注入2)
  console.log('\n注入文本：\n' + 注入)
}

console.log(失败 ? '\n失败 ' + 失败 + ' 项' : '\n全过')
process.exit(失败 ? 1 : 0)
