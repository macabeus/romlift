// The scaffold's templates as the package ships them (architecture §6.3, D74 d): templates/MANIFEST.json, decoded
// by core/scaffold/vars.ts decodeScaffoldManifest, the text of every template it names, and templates/agbcc.json,
// the pinned agbcc. Mechanical: it reads the files through shell/fs.ts and hands them to the pure decoders;
// rendering is core/scaffold/render.ts's. A file that cannot be read, is not UTF-8 or does not decode is E_IO_READ.
import { join } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { decodeAgbccPin, decodeScaffoldManifest } from '../../core/scaffold/vars.ts';
import type { AgbccPin, Decoded, ScaffoldTemplates } from '../../core/scaffold/vars.ts';
import { ShellCodes } from '../codes.ts';
import { readBytes } from '../fs.ts';
import type { IoResult } from '../fs.ts';

/** The package directory holding the templates. */
export const TEMPLATES_DIR = 'templates';
/** The manifest, under TEMPLATES_DIR. */
export const TEMPLATES_MANIFEST = 'MANIFEST.json';
/** The pinned agbcc, under TEMPLATES_DIR. */
export const AGBCC_PIN_FILE = 'agbcc.json';

function readError(file: string, message: string): IoResult<never> {
  return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_IO_READ', message, { path: file }) };
}

/** `relative` (a '/'-separated path under templates/) as a file under `packageRoot`. */
function templateFile(packageRoot: string, relative: string): string {
  return join(packageRoot, TEMPLATES_DIR, ...relative.split('/'));
}

/** The UTF-8 text of `file`, with CRLF line ends read as LF (templates are LF; a checkout may convert them). */
async function readText(file: string): Promise<IoResult<string>> {
  const bytes = await readBytes(file);
  if (!bytes.ok) return bytes;
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes.value).replace(/\r\n/g, '\n') };
  } catch {
    return readError(file, `cannot read ${file}: not UTF-8 text`);
  }
}

async function readDecoded<T>(file: string, decode: (text: string) => Decoded<T>): Promise<IoResult<T>> {
  const text = await readText(file);
  if (!text.ok) return text;
  const decoded = decode(text.value);
  return decoded.ok ? { ok: true, value: decoded.value } : readError(file, `cannot read ${file}: ${decoded.message}`);
}

/**
 * The manifest and the text of every template it names, from `<packageRoot>/templates/`. The texts are read in
 * source order (code units) and keyed by the manifest's `source`.
 */
export async function readTemplates(packageRoot: string): Promise<IoResult<ScaffoldTemplates>> {
  const manifest = await readDecoded(templateFile(packageRoot, TEMPLATES_MANIFEST), decodeScaffoldManifest);
  if (!manifest.ok) return manifest;
  const sources = [...new Set(manifest.value.files.flatMap((file) => (file.source === null ? [] : [file.source])))].sort(compareCodeUnits);
  const texts = new Map<string, string>();
  for (const source of sources) {
    const text = await readText(templateFile(packageRoot, source));
    if (!text.ok) return text;
    texts.set(source, text.value);
  }
  return { ok: true, value: { manifest: manifest.value, texts } };
}

/** The agbcc a project pins, from `<packageRoot>/templates/agbcc.json`. */
export async function readAgbccPin(packageRoot: string): Promise<IoResult<AgbccPin>> {
  return readDecoded(templateFile(packageRoot, AGBCC_PIN_FILE), decodeAgbccPin);
}
