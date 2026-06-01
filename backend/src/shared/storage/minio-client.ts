/**
 * minio-client.ts — MinIO/S3 storage client for chat attachments.
 * Uploads return a public URL suitable for zca-js sendImage/sendVideo.
 */
import { Client } from 'minio';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { config } from '../../config/index.js';

function parseEndpoint(url: string): { endPoint: string; port: number; useSSL: boolean } {
  const u = new URL(url);
  const useSSL = u.protocol === 'https:';
  const port = u.port ? parseInt(u.port) : (useSSL ? 443 : 80);
  return { endPoint: u.hostname, port, useSSL };
}

const { endPoint, port, useSSL } = parseEndpoint(config.s3Endpoint);

export const minioClient = new Client({
  endPoint,
  port,
  useSSL,
  accessKey: config.s3AccessKey,
  secretKey: config.s3SecretKey,
  region: config.s3Region,
});

const BUCKET = config.s3Bucket;

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  mimeType: string;
}

export async function uploadBuffer(buffer: Buffer, mimeType: string, originalName?: string, prefix?: string): Promise<UploadResult> {
  const ext = originalName ? extname(originalName) : mimeToExt(mimeType);
  const folder = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
  const key = `${folder}${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
  await minioClient.putObject(BUCKET, key, buffer, buffer.length, {
    'Content-Type': mimeType,
    'Cache-Control': 'public, max-age=31536000',
  });
  return {
    key,
    url: `${config.s3PublicUrl}/${BUCKET}/${key}`,
    size: buffer.length,
    mimeType,
  };
}

export interface StoredObject {
  key: string;
  url: string;
  size: number;
  lastModified: Date;
}

/** Liệt kê object trong bucket theo prefix (dùng cho Kho ảnh chatbot). */
export async function listObjectsByPrefix(prefix: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
  for await (const obj of stream as AsyncIterable<{ name?: string; size?: number; lastModified?: Date }>) {
    if (!obj.name) continue;
    out.push({
      key: obj.name,
      url: `${config.s3PublicUrl}/${BUCKET}/${obj.name}`,
      size: obj.size ?? 0,
      lastModified: obj.lastModified ?? new Date(0),
    });
  }
  return out;
}

/** Xóa 1 object khỏi bucket theo key. */
export async function deleteObject(key: string): Promise<void> {
  await minioClient.removeObject(BUCKET, key);
}

function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'video/quicktime') return '.mov';
  if (mime === 'video/webm') return '.webm';
  return '';
}

export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(BUCKET, config.s3Region);
  }
}
