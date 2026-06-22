import { readdir } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

const MEDIA_RE = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const folder = type === 'correct' ? 'CorrectAnswerMemes' : 'WrongAnswerMemes';
  const dir = path.join(process.cwd(), 'public', folder);

  try {
    const entries = await readdir(dir);
    const files = entries.filter((f) => MEDIA_RE.test(f));
    return NextResponse.json({ files, folder });
  } catch {
    return NextResponse.json({ files: [], folder });
  }
}
