import { reactive } from 'vue';

/** 点赞/踩状态（按消息 id，模块级单例；仅内存不持久化，切换任务后保留） */
export const feedback = reactive(new Map<string, 'like' | 'dislike'>());
