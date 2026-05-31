/**
 * public-api-routes.ts — External REST API authenticated via API key (X-Api-Key header).
 * Provides read/write access to contacts, conversations, appointments, and message sending.
 * All routes prefixed /api/public/ — no JWT required, orgId injected from API key lookup.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { assertSafeOutboundUrl, SsrfBlockedError } from '../../shared/utils/ssrf-guard.js';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const IMAGE_SEND_MAX = 100 * 1024 * 1024; // 100MB
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ── API key auth middleware ────────────────────────────────────────────────────

async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'] as string;
  if (!apiKey) return reply.status(401).send({ error: 'API key required' });

  const setting = await prisma.appSetting.findFirst({
    where: { settingKey: 'public_api_key', valuePlain: apiKey },
  });
  if (!setting) return reply.status(401).send({ error: 'Invalid API key' });

  (request as any).orgId = setting.orgId;
}

// ── Route registration ────────────────────────────────────────────────────────

export async function publicApiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', apiKeyAuth);

  // ── Contacts ─────────────────────────────────────────────────────────────

  app.get('/api/public/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { search = '', status = '', limit = '20' } = request.query as Record<string, string>;

      const where: any = { orgId };
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const contacts = await prisma.contact.findMany({
        where,
        select: {
          id: true, fullName: true, phone: true, email: true,
          source: true, status: true, notes: true, tags: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(parseInt(limit) || 20, 100),
      });

      return { contacts };
    } catch (err) {
      logger.error('[public-api] GET /contacts error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contacts' });
    }
  });

  app.get('/api/public/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { id } = request.params as { id: string };

      const contact = await prisma.contact.findFirst({
        where: { id, orgId },
        include: {
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 5 },
          _count: { select: { conversations: true } },
        },
      });

      if (!contact) return reply.status(404).send({ error: 'Contact not found' });
      return contact;
    } catch (err) {
      logger.error('[public-api] GET /contacts/:id error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact' });
    }
  });

  app.post('/api/public/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.fullName && !body?.phone) {
        return reply.status(400).send({ error: 'fullName or phone is required' });
      }

      const contact = await prisma.contact.create({
        data: {
          orgId,
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          source: body.source,
          status: body.status ?? 'new',
          notes: body.notes,
          tags: body.tags ?? [],
        },
      });

      return reply.status(201).send(contact);
    } catch (err) {
      logger.error('[public-api] POST /contacts error:', err);
      return reply.status(500).send({ error: 'Failed to create contact' });
    }
  });

  app.put('/api/public/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.contact.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updated = await prisma.contact.update({
        where: { id },
        data: {
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          source: body.source,
          status: body.status,
          notes: body.notes,
          tags: body.tags,
        },
      });

      return updated;
    } catch (err) {
      logger.error('[public-api] PUT /contacts/:id error:', err);
      return reply.status(500).send({ error: 'Failed to update contact' });
    }
  });

  // ── Conversations ─────────────────────────────────────────────────────────

  app.get('/api/public/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { limit = '20' } = request.query as Record<string, string>;

      const conversations = await prisma.conversation.findMany({
        where: { orgId },
        select: {
          id: true, threadType: true, externalThreadId: true,
          lastMessageAt: true, unreadCount: true, isReplied: true,
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: Math.min(parseInt(limit) || 20, 100),
      });

      return { conversations };
    } catch (err) {
      logger.error('[public-api] GET /conversations error:', err);
      return reply.status(500).send({ error: 'Failed to fetch conversations' });
    }
  });

  app.get('/api/public/conversations/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { id } = request.params as { id: string };
      const { limit = '50' } = request.query as Record<string, string>;

      const conv = await prisma.conversation.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      const messages = await prisma.message.findMany({
        where: { conversationId: id, isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: Math.min(parseInt(limit) || 50, 200),
        select: {
          id: true, senderType: true, senderName: true,
          content: true, contentType: true, sentAt: true, attachments: true,
        },
      });

      return { messages };
    } catch (err) {
      logger.error('[public-api] GET /conversations/:id/messages error:', err);
      return reply.status(500).send({ error: 'Failed to fetch messages' });
    }
  });

  // ── Appointments ──────────────────────────────────────────────────────────

  app.get('/api/public/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const { from, to } = request.query as Record<string, string>;

      const where: any = { orgId };
      if (from || to) {
        where.appointmentDate = {};
        if (from) where.appointmentDate.gte = new Date(from);
        if (to) where.appointmentDate.lte = new Date(to);
      }

      const appointments = await prisma.appointment.findMany({
        where,
        include: { contact: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { appointmentDate: 'asc' },
        take: 100,
      });

      return { appointments };
    } catch (err) {
      logger.error('[public-api] GET /appointments error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });

  app.post('/api/public/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.contactId || !body?.appointmentDate) {
        return reply.status(400).send({ error: 'contactId and appointmentDate are required' });
      }

      const contact = await prisma.contact.findFirst({ where: { id: body.contactId, orgId }, select: { id: true } });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const appointment = await prisma.appointment.create({
        data: {
          orgId,
          contactId: body.contactId,
          appointmentDate: new Date(body.appointmentDate),
          appointmentTime: body.appointmentTime,
          type: body.type,
          notes: body.notes,
        },
      });

      return reply.status(201).send(appointment);
    } catch (err) {
      logger.error('[public-api] POST /appointments error:', err);
      return reply.status(500).send({ error: 'Failed to create appointment' });
    }
  });

  // ── Messages send ─────────────────────────────────────────────────────────

  app.post('/api/public/messages/send', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).orgId as string;
      const body = request.body as Record<string, any>;

      if (!body?.zaloAccountId || !body?.threadId || !body?.content) {
        return reply.status(400).send({ error: 'zaloAccountId, threadId, and content are required' });
      }

      // Verify account belongs to org
      const account = await prisma.zaloAccount.findFirst({
        where: { id: body.zaloAccountId, orgId },
        select: { id: true, status: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });
      if (account.status !== 'connected') {
        return reply.status(422).send({ error: 'Zalo account is not connected' });
      }

      // Dynamically import zaloPool to avoid circular deps
      const { zaloPool } = await import('../zalo/zalo-pool.js');
      const api = zaloPool.getApi(body.zaloAccountId);
      if (!api) return reply.status(422).send({ error: 'Zalo account not active in pool' });

      const threadType = body.threadType === 'group' ? 1 : 0;
      await api.sendMessage(body.content, body.threadId, threadType);

      return { success: true };
    } catch (err) {
      logger.error('[public-api] POST /messages/send error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  // ── Image send ────────────────────────────────────────────────────────────
  // Gửi ảnh ra Zalo theo URL công khai (cho bot/n8n/Dify). Tải ảnh về tmp rồi
  // gửi qua zca-js (attachments là đường dẫn local). Có SSRF guard + giới hạn type/size.
  app.post('/api/public/messages/send-image', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request as any).orgId as string;
    const body = request.body as Record<string, any>;

    if (!body?.zaloAccountId || !body?.threadId || !(body?.imageUrl || body?.imageUrls)) {
      return reply.status(400).send({ error: 'zaloAccountId, threadId, and imageUrl (or imageUrls) are required' });
    }
    const urls: string[] = Array.isArray(body.imageUrls) ? body.imageUrls : [body.imageUrl];
    if (urls.length === 0 || urls.length > 9) {
      return reply.status(400).send({ error: 'Provide 1 to 9 image URLs' });
    }

    // Verify account belongs to org + connected
    const account = await prisma.zaloAccount.findFirst({
      where: { id: body.zaloAccountId, orgId },
      select: { id: true, status: true },
    });
    if (!account) return reply.status(404).send({ error: 'Zalo account not found' });
    if (account.status !== 'connected') {
      return reply.status(422).send({ error: 'Zalo account is not connected' });
    }

    const { zaloPool } = await import('../zalo/zalo-pool.js');
    const api = zaloPool.getApi(body.zaloAccountId);
    if (!api) return reply.status(422).send({ error: 'Zalo account not active in pool' });

    const tmpDir = path.join(os.tmpdir(), 'zalocrm-pub-img');
    await mkdir(tmpDir, { recursive: true });
    const tmpPaths: string[] = [];
    try {
      for (const rawUrl of urls) {
        // SSRF guard — chặn loopback/private/metadata host
        let safeUrl: URL;
        try {
          safeUrl = assertSafeOutboundUrl(String(rawUrl));
        } catch (err) {
          if (err instanceof SsrfBlockedError) {
            return reply.status(400).send({ error: `Blocked unsafe image URL: ${rawUrl}` });
          }
          throw err;
        }

        const res = await fetch(safeUrl.toString(), { signal: AbortSignal.timeout(20000) });
        if (!res.ok) {
          return reply.status(422).send({ error: `Failed to fetch image (HTTP ${res.status}): ${rawUrl}` });
        }
        const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (contentType && !ALLOWED_IMAGE_MIME.includes(contentType)) {
          return reply.status(415).send({ error: `Unsupported image type "${contentType}": ${rawUrl}` });
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > IMAGE_SEND_MAX) {
          return reply.status(413).send({ error: `Image too large (>100MB): ${rawUrl}` });
        }
        const ext = contentType === 'image/png' ? '.png'
          : contentType === 'image/webp' ? '.webp'
          : contentType === 'image/gif' ? '.gif' : '.jpg';
        const p = path.join(tmpDir, `${randomUUID()}${ext}`);
        await writeFile(p, buf);
        tmpPaths.push(p);
      }

      const threadType = body.threadType === 'group' ? 1 : 0;
      const caption = typeof body.caption === 'string' ? body.caption : '';
      // zca-js: gửi nhiều ảnh trong 1 lời gọi (attachments = mảng đường dẫn local)
      await api.sendMessage({ msg: caption, attachments: tmpPaths }, body.threadId, threadType);

      return { success: true, sent: tmpPaths.length };
    } catch (err) {
      logger.error('[public-api] POST /messages/send-image error:', err);
      return reply.status(500).send({ error: 'Failed to send image' });
    } finally {
      // Dọn file tạm
      await Promise.all(tmpPaths.map((p) => unlink(p).catch(() => {})));
    }
  });
}
