/**
 * @dscode/core 全局常量：跨工具 / 工作区 / diff 共用的上限，口径统一。
 * 之前 MAX_FILE_BYTES 在 read-file / write-file / workspace / diff 各自重复定义，
 * 收敛到此处作为唯一事实源，避免各处改漏。
 */

/** 单文件读写 / 扫描 / 快照的内容大小上限（字节） */
export const MAX_FILE_BYTES = 512 * 1024;

/** read_file 单文件大小上限（仅 OOM 防护，输出由 offset/limit 分页控制） */
export const READ_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** 单次工具 / 搜索结果输出的字符上限 */
export const MAX_OUTPUT_CHARS = 24 * 1024;
