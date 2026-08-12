import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { mockDiffFiles, mockFileTree, mockSessions } from '@dscode/shared'
import type { FileNode, Message, Session } from '@dscode/shared'

/** 模拟流式回复的语料 */
const mockReplies = [
  '收到。我先看一下相关代码的上下文，然后给出修改方案。\n\n计划如下：\n\n- 定位需要改动的模块，确认影响面\n- 以最小侵入的方式实现，保持现有行为不变\n- 完成后在右侧给出变更，供你逐条确认\n\n稍等片刻。',
  'Got it. Let me look at the surrounding code first, then propose a minimal change.\n\nMy plan:\n\n- Locate the modules involved and check the blast radius\n- Implement with the least intrusion, keeping existing behavior intact\n- Present the diff on the right for your review\n\nOne moment.',
  '明白，这个需求可以拆成两步：先调整状态结构，再更新组件绑定。\n\n我已经开始处理了，变更会实时同步到右侧「变更」面板。'
]

let idSeq = 0
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idSeq++}`
}

function findFileNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node.type === 'file' ? node : null
    if (node.children) {
      const found = findFileNode(node.children, path)
      if (found) return found
    }
  }
  return null
}

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>(mockSessions)
  const activeSessionId = ref<string | null>(sessions.value[0]?.id ?? null)
  const keyword = ref('')
  const generating = ref(false)

  const diffFiles = ref(mockDiffFiles)
  const fileTree = ref(mockFileTree)
  const selectedFilePath = ref<string | null>(null)

  const activeSession = computed<Session | null>(
    () => sessions.value.find(s => s.id === activeSessionId.value) ?? null
  )
  const hasMessage = computed(() => {
    const messages = activeSession.value?.messages ?? []
    return  messages.length > 0
  })


  const filteredSessions = computed(() => {
    const k = keyword.value.trim().toLowerCase()
    if (!k) return sessions.value
    return sessions.value.filter(s => s.title.toLowerCase().includes(k))
  })

  const selectedFile = computed(() =>
    selectedFilePath.value ? findFileNode(fileTree.value, selectedFilePath.value) : null
  )

  function select(id: string) {
    activeSessionId.value = id
  }

  function createSession() {
    const session: Session = {
      id: nextId('s'),
      title: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    }
    sessions.value.unshift(session)
    activeSessionId.value = session.id
  }

  function selectFile(path: string) {
    selectedFilePath.value = path
  }

  let timer: ReturnType<typeof setInterval> | undefined
  /** 正在生成的回复（绑定所属会话，防止切换会话后 stop 作用错对象） */
  let activeReply: { sessionId: string; messageId: string } | null = null

  function sendMessage(content: string) {
    const session = activeSession.value
    if (!session || generating.value) return

    session.messages.push({
      id: nextId('m'),
      role: 'user',
      content,
      createdAt: Date.now()
    })
    if (!session.title) {
      session.title = content.length > 24 ? `${content.slice(0, 24)}…` : content
    }

    // 模拟流式回复
    const reply: Message = {
      id: nextId('m'),
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: Date.now()
    }
    session.messages.push(reply)
    generating.value = true
    activeReply = { sessionId: session.id, messageId: reply.id }

    const fullText = mockReplies[Math.floor(Math.random() * mockReplies.length)]
    let cursor = 0
    timer = setInterval(() => {
      cursor = Math.min(cursor + 2 + Math.floor(Math.random() * 3), fullText.length)
      reply.content = fullText.slice(0, cursor)
      if (cursor >= fullText.length) {
        stopGenerating()
      }
    }, 24)
  }

  function stopGenerating() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    // 按生成时绑定的会话与消息定位，避免切换会话后清错对象
    if (activeReply) {
      const { sessionId, messageId } = activeReply
      const session = sessions.value.find(s => s.id === sessionId)
      const reply = session?.messages.find(m => m.id === messageId)
      if (session && reply?.streaming) {
        reply.streaming = false
        session.updatedAt = Date.now()
      }
      activeReply = null
    }
    generating.value = false
  }

  return {
    sessions,
    activeSessionId,
    keyword,
    generating,
    diffFiles,
    fileTree,
    selectedFilePath,
    activeSession,
    hasMessage,
    filteredSessions,
    selectedFile,
    select,
    createSession,
    selectFile,
    sendMessage,
    stopGenerating
  }
})
