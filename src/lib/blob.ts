import 'server-only';
import { put, del } from '@vercel/blob';

export async function uploadReceipt(file: File): Promise<string> {
  const blob = await put(`receipts/${file.name}`, file, {
    access: 'public',
    addRandomSuffix: true,
  });
  return blob.url;
}

export async function deleteReceipt(url: string): Promise<void> {
  await del(url);
}
