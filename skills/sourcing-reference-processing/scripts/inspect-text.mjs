import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, mkdir, access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export async function main(file, env = process.env) {
  if (!file || !env.PAPERCLIP_RUN_SCRATCH_DIR) throw Error('image_file_and_run_scratch_required');
  const image = await realpath(file);
  if ((await stat(image)).size > 16 * 1024 * 1024) throw Error('image_file_too_large');
  const scratch = await realpath(env.PAPERCLIP_RUN_SCRATCH_DIR);
  const source = new URL('./inspect-text.swift', import.meta.url);
  const hash = createHash('sha256').update(await readFile(source)).digest('hex').slice(0, 12);
  const binary = join(scratch, 'inspect-all-text-' + hash);
  const run = promisify(execFile);
  try { await access(binary); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const cache = join(scratch, 'swift-module-cache');
    await mkdir(cache, { recursive: true });
    await run('/usr/bin/xcrun', ['swiftc', '-module-cache-path', cache, '-O', source.pathname, '-o', binary],
      { timeout: 120000, maxBuffer: 1024 * 1024 });
  }
  const { stdout } = await run(binary, [image], { timeout: 35000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || !Array.isArray(result.regions))
    throw Error('invalid_text_inspection');
  return { ...result, pixelReviewRequired: true, sourceFile: image };
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(await main(process.argv[2]), null, 2) + '\n'); }
  catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
