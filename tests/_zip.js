/**
 * Minimal ZIP writer for CREATOR-12 tests.
 *
 * The application only READS .kpeffect packages (yauzl). To test that reader
 * honestly the tests need to produce genuine ZIP archives, so this builds real
 * ones: local file headers, a central directory and an end-of-central-directory
 * record, with correct CRC-32 and sizes.
 *
 * Test-only: nothing in server/ or web/ depends on this.
 */
import { deflateRawSync } from 'node:zlib';

/** CRC-32 (IEEE) table-driven, matching what ZIP central directories expect. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: Buffer|string, store?: boolean}>} files
 * @param {object} [opts]
 * @param {boolean} [opts.corruptCrc] write a deliberately wrong CRC (tests the reader)
 * @returns {Buffer}
 */
export function buildZip(files, opts = {}) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const store = file.store === true;
    const body = store ? raw : deflateRawSync(raw, { level: 9 });
    const crc = opts.corruptCrc ? 0 : crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034B50, 0);       // local file header signature
    localHeader.writeUInt16LE(20, 4);               // version needed
    localHeader.writeUInt16LE(0, 6);                // flags
    localHeader.writeUInt16LE(store ? 0 : 8, 8);    // method: 0 store, 8 deflate
    localHeader.writeUInt16LE(0, 10);               // mod time
    localHeader.writeUInt16LE(0x21, 12);            // mod date (valid, not zero)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.length, 18);      // compressed size
    localHeader.writeUInt32LE(raw.length, 22);       // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);                // extra length
    local.push(localHeader, nameBuf, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014B50, 0);      // central directory signature
    centralHeader.writeUInt16LE(20, 4);             // version made by
    centralHeader.writeUInt16LE(20, 6);             // version needed
    centralHeader.writeUInt16LE(0, 8);              // flags
    centralHeader.writeUInt16LE(store ? 0 : 8, 10); // method
    centralHeader.writeUInt16LE(0, 12);              // mod time
    centralHeader.writeUInt16LE(0x21, 14);           // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);              // extra
    centralHeader.writeUInt16LE(0, 32);              // comment
    centralHeader.writeUInt16LE(0, 34);              // disk number
    centralHeader.writeUInt16LE(0, 36);              // internal attrs
    centralHeader.writeUInt32LE(0, 38);              // external attrs
    centralHeader.writeUInt32LE(offset, 42);         // local header offset
    central.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);                 // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...local, centralBuf, end]);
}

/** A minimal valid manifest for a `.kpeffect`. */
export function goodManifest(overrides = {}) {
  return {
    format: 'komuniph-effect',
    formatVersion: 1,
    id: 'creator.snowfall',
    name: 'Snowfall',
    author: 'Test Creator',
    version: '1.0.0',
    type: 'background-effect',
    effect: 'effect/effect.json',
    ...overrides,
  };
}

/** A minimal valid effect definition for a `.kpeffect`. */
export function goodDefinition(overrides = {}) {
  return {
    engine: 'particles',
    particle: undefined,
    config: { count: 40, speed: 1.2, size: 12, opacity: 0.8, direction: 'down' },
    loop: true,
    ...overrides,
  };
}
