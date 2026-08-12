/** 最近打开的工作空间项目 */
export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: number;
}

export type ProjectsListResult = { projects: RecentProject[]; homeDir: string };
