import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

/**
 * Async-iterate a Readable one line at a time, yielding unparsed strings.
 * Empty lines (including trailing newlines) are skipped so consumers don't
 * have to guard for them.
 */
export async function* readLines(stream: Readable): AsyncGenerator<string, void, void> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    yield line;
  }
}

/**
 * Write an async iterable of records as NDJSON to a writable stream.
 */
export async function writeNdjson<T>(
  stream: NodeJS.WritableStream,
  records: AsyncIterable<T> | Iterable<T>,
): Promise<void> {
  for await (const r of records as AsyncIterable<T>) {
    stream.write(JSON.stringify(r) + '\n');
  }
}
