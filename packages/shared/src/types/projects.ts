/** 最近打开的工作空间项目 */
export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: number;
}

export type ProjectsListResult = {
  projects: RecentProject[];
  /** 被「移除项目」移出侧边栏的工作空间（任务仍保留，重新打开后恢复展示） */
  removed: RecentProject[];
  homeDir: string;
};
