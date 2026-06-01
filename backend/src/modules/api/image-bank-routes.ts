/**
 * image-bank-routes.ts — Kho ảnh chatbot.
 * Nhân viên upload ảnh (kéo-thả) → nhận URL công khai (MinIO) để dán vào Q&A Dify.
 * Ảnh lưu dưới prefix "image-bank/" trong bucket, tách biệt với attachment chat.
 * Auth: JWT (mọi user đã đăng nhập trong org).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { uploadBuffer, listObjectsByPrefix, deleteObject } from '../../shared/storage/minio-client.js';

const PREFIX = 'image-bank';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

export async function imageBankRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Danh sách ảnh trong kho
  app.get('/api/v1/image-bank', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const images = await listObjectsByPrefix(`${PREFIX}/`);
      images.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      return { images };
    } catch (err) {
      logger.error('[image-bank] list error:', err);
      return reply.status(500).send({ error: 'Failed to list images' });
    }
  });

  // Upload 1 hoặc nhiều ảnh
  app.post('/api/v1/image-bank/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const uploaded: Array<{ url: string; key: string; size: number; filename?: string }> = [];
      for await (const part of request.parts()) {
        if (part.type !== 'file') continue;
        if (!ALLOWED_MIME.includes(part.mimetype)) {
          return reply.status(415).send({ error: `Định dạng không hỗ trợ: ${part.mimetype} (chỉ jpg/png/webp/gif)` });
        }
        const buf = await part.toBuffer();
        if (buf.length > MAX_SIZE) {
          return reply.status(413).send({ error: 'Ảnh vượt quá 20MB' });
        }
        const res = await uploadBuffer(buf, part.mimetype, part.filename, PREFIX);
        uploaded.push({ url: res.url, key: res.key, size: res.size, filename: part.filename });
      }
      if (uploaded.length === 0) return reply.status(400).send({ error: 'Chưa chọn ảnh nào' });
      return { uploaded };
    } catch (err) {
      logger.error('[image-bank] upload error:', err);
      return reply.status(500).send({ error: 'Upload thất bại' });
    }
  });

  // Xóa 1 ảnh khỏi kho
  app.post('/api/v1/image-bank/delete', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { key } = request.body as { key?: string };
      if (!key || !key.startsWith(`${PREFIX}/`)) {
        return reply.status(400).send({ error: 'Key không hợp lệ' });
      }
      await deleteObject(key);
      return { success: true };
    } catch (err) {
      logger.error('[image-bank] delete error:', err);
      return reply.status(500).send({ error: 'Xóa thất bại' });
    }
  });
}
