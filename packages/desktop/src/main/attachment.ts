import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { AttachmentReadResult } from '@dscode/shared';

/**
 * 附件/引用文件读取（主进程）：把用户经原生对话框选中的文件读回渲染端。
 * 图片生成 data URL 预览；文本/代码文件读 UTF-8 内容（@ 引用注入提示词用）。
 */

/** 图片预览上限（5MB，超出退化为文件名 chip，不生成 data URL，避免内存/JSONL 膨胀） */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 文本引用内容上限（512KB，对齐工作区单文件读取上限） */
const MAX_TEXT_BYTES = 512 * 1024;

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

/** 读取单个附件文件；区分图片预览与文本内容 */
export async function readAttachment(absPath: string): Promise<AttachmentReadResult> {
  try {
    const st = await stat(absPath);
    if (!st.isFile()) return { ok: false, error: '目标不是文件' };
    const name = basename(absPath);
    const mime = IMAGE_MIME[extname(name).toLowerCase()];
    if (mime) {
      if (st.size > MAX_IMAGE_BYTES) return { ok: false, error: '图片过大（>5MB）' };
      const buf = await readFile(absPath);
      return {
        ok: true,
        name,
        path: absPath,
        size: st.size,
        mime,
        kind: 'image',
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`
      };
    }
    if (st.size > MAX_TEXT_BYTES) return { ok: false, error: '文件过大（>512KB）' };
    const buf = await readFile(absPath);
    // 二进制探测：含 NUL 字节视为二进制，拒绝按文本读取，避免乱码注入提示词
    if (buf.includes(0)) return { ok: false, error: '二进制文件（不支持作为文本读取）' };
    return {
      ok: true,
      name,
      path: absPath,
      size: st.size,
      mime: 'text/plain',
      kind: 'text',
      text: buf.toString('utf8')
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
