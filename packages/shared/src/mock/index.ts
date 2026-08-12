import type { DiffFile, FileNode, Session } from '../types';

const now = Date.now();
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;

export const mockSessions: Session[] = [
  {
    id: 's1',
    title: '重构会话状态管理',
    createdAt: now - 2 * hour,
    updatedAt: now - 12 * min,
    messages: [
      {
        id: 's1-m1',
        role: 'user',
        content: '帮我把会话列表的状态管理从组件内聚到 Pinia store，保持现有行为不变。',
        createdAt: now - 2 * hour
      },
      {
        id: 's1-m2',
        role: 'assistant',
        content:
          '好的。我先梳理了现状：`SessionSidebar` 内部同时维护着会话列表、选中态和搜索关键词，这会让跨组件共享变得困难。\n\n我的方案：\n\n- 新建 `session` store，集中管理 `sessions` / `activeSessionId` / `keyword`\n- 组件只保留纯展示逻辑，通过 store 的 getters 读取过滤后的列表\n- 切换会话、新建会话改为 store actions，便于后续接入真实数据\n\n主要改动在 `stores/session.ts` 和 `SessionSidebar.vue`，你可以查看右侧的变更。',
        createdAt: now - 2 * hour + 3 * min
      }
    ]
  },
  {
    id: 's2',
    title: 'Add dark mode support',
    createdAt: now - day,
    updatedAt: now - 5 * hour,
    messages: [
      {
        id: 's2-m1',
        role: 'user',
        content: 'Add a dark mode toggle in the header, persisted across restarts.',
        createdAt: now - day
      },
      {
        id: 's2-m2',
        role: 'assistant',
        content:
          "Done. The toggle lives in `AppHeader` and drives Vuetify's `useTheme()`. The choice is persisted to `localStorage` and re-applied on launch, defaulting to the system preference when nothing is stored.",
        createdAt: now - day + 4 * min
      }
    ]
  },
  {
    id: 's3',
    title: '优化 diff 面板的可读性',
    createdAt: now - 2 * day,
    updatedAt: now - day,
    messages: [
      {
        id: 's3-m1',
        role: 'user',
        content: 'diff 行太挤了，行号和代码之间也没有分隔，帮忙优化一下排版。',
        createdAt: now - 2 * day
      },
      {
        id: 's3-m2',
        role: 'assistant',
        content:
          '已调整：行高从 18px 提到 22px，行号列加宽并右对齐，与代码之间用 1px 的 outline 色分隔；hunk 头（@@）单独一行、弱化显示。整体对比度保持不变，长时间阅读更舒服。',
        createdAt: now - 2 * day + 6 * min
      }
    ]
  },
  {
    id: 's4',
    title: 'Internationalize the sidebar',
    createdAt: now - 3 * day,
    updatedAt: now - 2 * day,
    messages: [
      {
        id: 's4-m1',
        role: 'user',
        content: 'Move all hard-coded strings in the sidebar into locale files.',
        createdAt: now - 3 * day
      },
      {
        id: 's4-m2',
        role: 'assistant',
        content:
          'All sidebar strings now go through `vue-i18n`. I added the keys to both `zh-CN.json` and `en-US.json`, and wired the language menu so Vuetify component locales switch along with it.',
        createdAt: now - 3 * day + 5 * min
      }
    ]
  }
];

export const mockDiffFiles: DiffFile[] = [
  {
    path: 'packages/ui/src/stores/session.ts',
    additions: 13,
    deletions: 5,
    lines: [
      { type: 'hunk', content: '@@ -1,6 +1,10 @@' },
      { type: 'context', content: "import { defineStore } from 'pinia'", oldLineNo: 1, newLineNo: 1 },
      { type: 'context', content: "import { computed, ref } from 'vue'", oldLineNo: 2, newLineNo: 2 },
      { type: 'del', content: "import { mockSessions } from '../mock'", oldLineNo: 3 },
      { type: 'add', content: "import { mockSessions } from '@dscode/shared'", newLineNo: 3 },
      { type: 'add', content: "import type { Session } from '@dscode/shared'", newLineNo: 4 },
      { type: 'context', content: '', oldLineNo: 4, newLineNo: 5 },
      {
        type: 'context',
        content: "export const useSessionStore = defineStore('session', () => {",
        oldLineNo: 5,
        newLineNo: 6
      },
      { type: 'del', content: '  const sessions = ref(mockSessions)', oldLineNo: 6 },
      { type: 'add', content: '  const sessions = ref<Session[]>(mockSessions)', newLineNo: 7 },
      { type: 'add', content: '  const activeSessionId = ref(sessions.value[0]?.id ?? null)', newLineNo: 8 },
      { type: 'hunk', content: '@@ -10,8 +14,22 @@' },
      { type: 'context', content: "  const keyword = ref('')", oldLineNo: 10, newLineNo: 14 },
      { type: 'context', content: '', oldLineNo: 11, newLineNo: 15 },
      { type: 'del', content: '  function select(id: string) {', oldLineNo: 12 },
      { type: 'del', content: '    activeSessionId.value = id', oldLineNo: 13 },
      { type: 'del', content: '  }', oldLineNo: 14 },
      { type: 'add', content: '  const filteredSessions = computed(() => {', newLineNo: 16 },
      { type: 'add', content: '    const k = keyword.value.trim().toLowerCase()', newLineNo: 17 },
      { type: 'add', content: '    if (!k) return sessions.value', newLineNo: 18 },
      {
        type: 'add',
        content: '    return sessions.value.filter(s => s.title.toLowerCase().includes(k))',
        newLineNo: 19
      },
      { type: 'add', content: '  })', newLineNo: 20 },
      { type: 'add', content: '', newLineNo: 21 },
      { type: 'add', content: '  function select(id: string) {', newLineNo: 22 },
      { type: 'add', content: '    activeSessionId.value = id', newLineNo: 23 },
      { type: 'add', content: '  }', newLineNo: 24 }
    ]
  },
  {
    path: 'packages/ui/src/components/SessionSidebar.vue',
    additions: 5,
    deletions: 5,
    lines: [
      { type: 'hunk', content: '@@ -2,14 +2,12 @@' },
      { type: 'context', content: '<script setup lang="ts">', oldLineNo: 2, newLineNo: 2 },
      { type: 'del', content: "import { computed, ref } from 'vue'", oldLineNo: 3 },
      { type: 'del', content: "import { mockSessions } from '../mock'", oldLineNo: 4 },
      { type: 'add', content: "import { storeToRefs } from 'pinia'", newLineNo: 3 },
      { type: 'add', content: "import { useSessionStore } from '../stores/session'", newLineNo: 4 },
      { type: 'context', content: '', oldLineNo: 5, newLineNo: 5 },
      { type: 'del', content: "const keyword = ref('')", oldLineNo: 6 },
      { type: 'del', content: 'const sessions = ref(mockSessions)', oldLineNo: 7 },
      { type: 'del', content: 'const filtered = computed(() => /* ... */ sessions.value)', oldLineNo: 8 },
      { type: 'add', content: 'const store = useSessionStore()', newLineNo: 6 },
      { type: 'add', content: 'const { filteredSessions, activeSessionId } = storeToRefs(store)', newLineNo: 7 },
      { type: 'add', content: 'const { select, createSession } = store', newLineNo: 8 },
      { type: 'context', content: '</script>', oldLineNo: 9, newLineNo: 9 }
    ]
  },
  {
    path: 'packages/ui/src/theme/tokens.ts',
    additions: 2,
    deletions: 1,
    lines: [
      { type: 'hunk', content: '@@ -20,8 +20,13 @@' },
      { type: 'context', content: "    background: '#0d0d0d',", oldLineNo: 20, newLineNo: 20 },
      { type: 'del', content: "    surface: '#191919',", oldLineNo: 21 },
      { type: 'add', content: "    surface: '#171717',", newLineNo: 21 },
      { type: 'add', content: "    'surface-variant': '#212121',", newLineNo: 22 },
      { type: 'context', content: "    primary: '#ececec',", oldLineNo: 22, newLineNo: 23 }
    ]
  }
];

export const mockFileTree: FileNode[] = [
  {
    name: 'packages',
    path: 'packages',
    type: 'dir',
    children: [
      {
        name: 'ui',
        path: 'packages/ui',
        type: 'dir',
        children: [
          {
            name: 'src',
            path: 'packages/ui/src',
            type: 'dir',
            children: [
              {
                name: 'stores',
                path: 'packages/ui/src/stores',
                type: 'dir',
                children: [
                  {
                    name: 'session.ts',
                    path: 'packages/ui/src/stores/session.ts',
                    type: 'file',
                    content:
                      "import { defineStore } from 'pinia'\nimport { computed, ref } from 'vue'\nimport { mockSessions } from '@dscode/shared'\nimport type { Session } from '@dscode/shared'\n\nexport const useSessionStore = defineStore('session', () => {\n  const sessions = ref<Session[]>(mockSessions)\n  const activeSessionId = ref(sessions.value[0]?.id ?? null)\n  const keyword = ref('')\n\n  const filteredSessions = computed(() => {\n    const k = keyword.value.trim().toLowerCase()\n    if (!k) return sessions.value\n    return sessions.value.filter(s => s.title.toLowerCase().includes(k))\n  })\n\n  function select(id: string) {\n    activeSessionId.value = id\n  }\n\n  return { sessions, activeSessionId, keyword, filteredSessions, select }\n})\n"
                  },
                  {
                    name: 'ui.ts',
                    path: 'packages/ui/src/stores/ui.ts',
                    type: 'file',
                    content:
                      "import { defineStore } from 'pinia'\nimport { ref } from 'vue'\n\nexport const useUiStore = defineStore('ui', () => {\n  const leftVisible = ref(true)\n  const rightVisible = ref(true)\n  const theme = ref<'light' | 'dark'>('dark')\n  const locale = ref<'zh-CN' | 'en-US'>('zh-CN')\n\n  function toggleLeft() { leftVisible.value = !leftVisible.value }\n  function toggleRight() { rightVisible.value = !rightVisible.value }\n\n  return { leftVisible, rightVisible, theme, locale, toggleLeft, toggleRight }\n})\n"
                  }
                ]
              },
              {
                name: 'components',
                path: 'packages/ui/src/components',
                type: 'dir',
                children: [
                  {
                    name: 'SessionSidebar.vue',
                    path: 'packages/ui/src/components/SessionSidebar.vue',
                    type: 'file',
                    content:
                      '<script setup lang="ts">\nimport { storeToRefs } from \'pinia\'\nimport { useSessionStore } from \'../stores/session\'\n\nconst store = useSessionStore()\nconst { filteredSessions, activeSessionId } = storeToRefs(store)\nconst { select, createSession } = store\n</script>\n\n<template>\n  <v-list>\n    <v-list-item\n      v-for="s in filteredSessions"\n      :key="s.id"\n      :active="s.id === activeSessionId"\n      :title="s.title"\n      @click="select(s.id)"\n    />\n  </v-list>\n</template>\n'
                  },
                  {
                    name: 'ChatView.vue',
                    path: 'packages/ui/src/components/ChatView.vue',
                    type: 'file',
                    content:
                      '<script setup lang="ts">\nimport { useSessionStore } from \'../stores/session\'\n\nconst store = useSessionStore()\n</script>\n\n<template>\n  <div class="chat-view">\n    <!-- message list -->\n  </div>\n</template>\n'
                  }
                ]
              },
              {
                name: 'theme',
                path: 'packages/ui/src/theme',
                type: 'dir',
                children: [
                  {
                    name: 'tokens.ts',
                    path: 'packages/ui/src/theme/tokens.ts',
                    type: 'file',
                    content:
                      "export const lightTheme = {\n  dark: false,\n  colors: {\n    background: '#ffffff',\n    surface: '#f7f7f8',\n    primary: '#171717'\n  }\n}\n\nexport const darkTheme = {\n  dark: true,\n  colors: {\n    background: '#0d0d0d',\n    surface: '#171717',\n    'surface-variant': '#212121',\n    primary: '#ececec'\n  }\n}\n"
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
];
