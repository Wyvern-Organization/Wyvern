import { sha1Bytes } from './security';

export type GitObjectType = 'commit' | 'tree' | 'blob' | 'tag';
export interface GitRawObject { sha: string; type: GitObjectType; content: Uint8Array; offset?: number; }

const typeNames: Record<number, GitObjectType | null> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag', 6: null, 7: null };

class BitReader {
  position: number;
  bit = 0;
  constructor(private readonly bytes: Uint8Array, start: number) { this.position = start; }
  read(count: number): number {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      if (this.position >= this.bytes.length) throw new Error('Truncated deflate stream');
      value |= ((this.bytes[this.position] >> this.bit) & 1) << index;
      this.bit += 1;
      if (this.bit === 8) { this.bit = 0; this.position += 1; }
    }
    return value;
  }
  align(): void { if (this.bit) { this.bit = 0; this.position += 1; } }
}

type HuffmanTable = Map<string, number>;

function reverseBits(value: number, length: number): number {
  let reversed = 0;
  for (let index = 0; index < length; index += 1) reversed = (reversed << 1) | ((value >> index) & 1);
  return reversed;
}

function huffman(lengths: number[]): HuffmanTable {
  const counts = new Array(16).fill(0);
  for (const length of lengths) if (length) counts[length] += 1;
  const next = new Array(16).fill(0);
  let code = 0;
  for (let bits = 1; bits <= 15; bits += 1) { code = (code + counts[bits - 1]) << 1; next[bits] = code; }
  const table = new Map<string, number>();
  lengths.forEach((length, symbol) => {
    if (!length) return;
    table.set(`${length}:${reverseBits(next[length]++, length)}`, symbol);
  });
  return table;
}

function readSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0;
  for (let length = 1; length <= 15; length += 1) {
    code |= reader.read(1) << (length - 1);
    const symbol = table.get(`${length}:${code}`);
    if (symbol !== undefined) return symbol;
  }
  throw new Error('Invalid deflate Huffman code');
}

const lengthBases = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const distanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function fixedTables(): { literal: HuffmanTable; distance: HuffmanTable } {
  const literalLengths = new Array(288).fill(0);
  for (let index = 0; index <= 143; index += 1) literalLengths[index] = 8;
  for (let index = 144; index <= 255; index += 1) literalLengths[index] = 9;
  for (let index = 256; index <= 279; index += 1) literalLengths[index] = 7;
  for (let index = 280; index <= 287; index += 1) literalLengths[index] = 8;
  return { literal: huffman(literalLengths), distance: huffman(new Array(32).fill(5)) };
}

function dynamicTables(reader: BitReader): { literal: HuffmanTable; distance: HuffmanTable } {
  const hlit = reader.read(5) + 257;
  const hdist = reader.read(5) + 1;
  const hclen = reader.read(4) + 4;
  const codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const codeLengths = new Array(19).fill(0);
  for (let index = 0; index < hclen; index += 1) codeLengths[codeLengthOrder[index]] = reader.read(3);
  const codeTable = huffman(codeLengths);
  const lengths: number[] = [];
  while (lengths.length < hlit + hdist) {
    const symbol = readSymbol(reader, codeTable);
    if (symbol < 16) lengths.push(symbol);
    else if (symbol === 16) {
      if (!lengths.length) throw new Error('Invalid deflate repeat');
      const count = reader.read(2) + 3;
      lengths.push(...new Array(count).fill(lengths[lengths.length - 1]));
    } else if (symbol === 17) lengths.push(...new Array(reader.read(3) + 3).fill(0));
    else if (symbol === 18) lengths.push(...new Array(reader.read(7) + 11).fill(0));
    else throw new Error('Invalid deflate code-length symbol');
  }
  if (lengths.length !== hlit + hdist) throw new Error('Invalid deflate code-length table');
  return { literal: huffman(lengths.slice(0, hlit)), distance: huffman(lengths.slice(hlit, hlit + hdist)) };
}

function skipCompressedBlock(reader: BitReader, literal: HuffmanTable, distance: HuffmanTable): void {
  while (true) {
    const symbol = readSymbol(reader, literal);
    if (symbol < 256) continue;
    if (symbol === 256) return;
    if (symbol < 257 || symbol > 285) throw new Error('Invalid deflate length symbol');
    const lengthIndex = symbol - 257;
    reader.read(lengthExtra[lengthIndex]);
    const distanceSymbol = readSymbol(reader, distance);
    if (distanceSymbol > 29) throw new Error('Invalid deflate distance symbol');
    reader.read(distanceExtra[distanceSymbol]);
  }
}

/** Returns the byte just after one zlib stream without trusting a delimiter. */
function zlibEnd(bytes: Uint8Array, start: number): number {
  if (start + 6 > bytes.length || (bytes[start] & 0x0f) !== 8 || (((bytes[start] << 8) | bytes[start + 1]) % 31) !== 0) throw new Error('Invalid zlib stream');
  const reader = new BitReader(bytes, start + 2);
  let final = 0;
  while (!final) {
    final = reader.read(1);
    const blockType = reader.read(2);
    if (blockType === 0) {
      reader.align();
      const length = reader.read(16);
      const inverse = reader.read(16);
      if ((length ^ 0xffff) !== inverse) throw new Error('Invalid deflate stored block');
      reader.align();
      reader.position += length;
      if (reader.position > bytes.length) throw new Error('Truncated deflate stored block');
    } else if (blockType === 1) {
      const tables = fixedTables();
      skipCompressedBlock(reader, tables.literal, tables.distance);
    } else if (blockType === 2) {
      const tables = dynamicTables(reader);
      skipCompressedBlock(reader, tables.literal, tables.distance);
    } else throw new Error('Invalid deflate block type');
  }
  reader.align();
  const end = reader.position + 4;
  if (end > bytes.length) throw new Error('Truncated zlib checksum');
  return end;
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readVariable(bytes: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let next = offset;
  while (true) {
    if (next >= bytes.length) throw new Error('Truncated delta header');
    const byte = bytes[next++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return { value, offset: next };
    shift += 7;
    if (shift > 28) throw new Error('Delta header is too large');
  }
}

function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let cursor = readVariable(delta, 0);
  if (cursor.value !== base.length) throw new Error('Delta base size does not match');
  cursor = readVariable(delta, cursor.offset);
  const output = new Uint8Array(cursor.value);
  let write = 0;
  let index = cursor.offset;
  while (index < delta.length) {
    const instruction = delta[index++];
    if (!instruction) throw new Error('Invalid zero delta instruction');
    if (instruction & 0x80) {
      let offset = 0;
      let size = 0;
      if (instruction & 0x01) offset |= delta[index++];
      if (instruction & 0x02) offset |= delta[index++] << 8;
      if (instruction & 0x04) offset |= delta[index++] << 16;
      if (instruction & 0x08) offset |= delta[index++] << 24;
      if (instruction & 0x10) size |= delta[index++];
      if (instruction & 0x20) size |= delta[index++] << 8;
      if (instruction & 0x40) size |= delta[index++] << 16;
      if (!size) size = 0x10000;
      if (offset < 0 || size < 0 || offset + size > base.length || write + size > output.length) throw new Error('Invalid delta copy range');
      output.set(base.subarray(offset, offset + size), write);
      write += size;
    } else {
      if (index + instruction > delta.length || write + instruction > output.length) throw new Error('Invalid delta insert range');
      output.set(delta.subarray(index, index + instruction), write);
      index += instruction;
      write += instruction;
    }
  }
  if (write !== output.length) throw new Error('Delta output size does not match');
  return output;
}

function objectHeader(bytes: Uint8Array, offset: number): { type: number; size: number; offset: number } {
  let byte = bytes[offset++];
  const type = (byte >> 4) & 7;
  let size = byte & 0x0f;
  let shift = 4;
  while (byte & 0x80) {
    byte = bytes[offset++];
    size |= (byte & 0x7f) << shift;
    shift += 7;
    if (shift > 35) throw new Error('Pack object is too large');
  }
  return { type, size, offset };
}

function offsetDeltaBase(bytes: Uint8Array, offset: number, objectOffset: number): { baseOffset: number; offset: number } {
  let byte = bytes[offset++];
  let distance = byte & 0x7f;
  while (byte & 0x80) {
    byte = bytes[offset++];
    distance = ((distance + 1) << 7) | (byte & 0x7f);
  }
  const baseOffset = objectOffset - distance;
  if (baseOffset < 12) throw new Error('Invalid ofs-delta base');
  return { baseOffset, offset };
}

export async function parseGitPack(
  pack: Uint8Array,
  existing = new Map<string, GitRawObject>(),
  maxObjectSize = 512 * 1024,
  maxTotalSize = 1024 * 1024,
): Promise<GitRawObject[]> {
  if (pack.length < 32 || new TextDecoder().decode(pack.subarray(0, 4)) !== 'PACK') throw new Error('Expected a Git packfile');
  const version = new DataView(pack.buffer, pack.byteOffset, pack.byteLength).getUint32(4);
  if (version !== 2 && version !== 3) throw new Error(`Unsupported Git pack version ${version}`);
  const count = new DataView(pack.buffer, pack.byteOffset, pack.byteLength).getUint32(8);
  if (count > 1_024) throw new Error('Pack contains too many objects');
  const trailerStart = pack.length - 20;
  const expectedTrailer = Array.from(pack.subarray(trailerStart)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (await sha1Bytes(pack.subarray(0, trailerStart)) !== expectedTrailer) throw new Error('Git pack checksum did not match');

  const byOffset = new Map<number, GitRawObject>();
  const bySha = new Map(existing);
  const objects: GitRawObject[] = [];
  let offset = 12;
  let declaredBytes = 0;
  let resolvedBytes = 0;
  for (let index = 0; index < count; index += 1) {
    const objectOffset = offset;
    const header = objectHeader(pack, offset);
    offset = header.offset;
    let base: GitRawObject | undefined;
    if (header.type === 6) {
      const baseInfo = offsetDeltaBase(pack, offset, objectOffset);
      offset = baseInfo.offset;
      base = byOffset.get(baseInfo.baseOffset);
    } else if (header.type === 7) {
      const baseSha = Array.from(pack.subarray(offset, offset + 20)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      offset += 20;
      base = bySha.get(baseSha);
    }
    const compressedEnd = zlibEnd(pack, offset);
    if (header.size > maxObjectSize) throw new Error('Git object exceeds allowed size');
    declaredBytes += header.size;
    if (declaredBytes > maxTotalSize) throw new Error('Git pack exceeds allowed unpacked size');
    const unpacked = await inflateZlib(pack.subarray(offset, compressedEnd));
    offset = compressedEnd;
    if (unpacked.length !== header.size) throw new Error('Git pack object size did not match');
    let type: GitObjectType;
    let content: Uint8Array;
    if (header.type === 6 || header.type === 7) {
      if (!base) throw new Error('Pack delta base is unavailable');
      type = base.type;
      content = applyDelta(base.content, unpacked);
    } else {
      const named = typeNames[header.type];
      if (!named) throw new Error('Unsupported Git object type');
      type = named;
      content = unpacked;
    }
    if (content.length > maxObjectSize) throw new Error('Git object exceeds allowed size');
    resolvedBytes += content.length;
    if (resolvedBytes > maxTotalSize) throw new Error('Git pack exceeds allowed unpacked size');
    const sha = await sha1Bytes(new Uint8Array([...new TextEncoder().encode(`${type} ${content.length}\0`), ...content]));
    const object = { sha, type, content, offset: objectOffset };
    byOffset.set(objectOffset, object);
    bySha.set(sha, object);
    objects.push(object);
  }
  if (offset !== trailerStart) throw new Error('Pack contained unexpected trailing data');
  return objects;
}

export function parseGitCommit(content: Uint8Array): { tree: string; parents: string[]; author: string; message: string } {
  const text = new TextDecoder().decode(content);
  const [headers = '', message = 'Update workspace'] = text.split('\n\n', 2);
  const tree = headers.match(/^tree ([a-f0-9]{40})$/m)?.[1];
  if (!tree) throw new Error('Git commit does not have a tree');
  return { tree, parents: Array.from(headers.matchAll(/^parent ([a-f0-9]{40})$/gm)).map((match) => match[1]), author: headers.match(/^author (.+)$/m)?.[1] || 'Git user', message: message.trim() || 'Update workspace' };
}

export function treeEntries(content: Uint8Array): Array<{ name: string; mode: string; sha: string }> {
  const entries: Array<{ name: string; mode: string; sha: string }> = [];
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    const nul = content.indexOf(0, space + 1);
    if (space < 0 || nul < 0 || nul + 21 > content.length) throw new Error('Malformed Git tree');
    const mode = new TextDecoder().decode(content.subarray(offset, space));
    const name = new TextDecoder().decode(content.subarray(space + 1, nul));
    const sha = Array.from(content.subarray(nul + 1, nul + 21)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    entries.push({ mode, name, sha });
    offset = nul + 21;
  }
  return entries;
}
