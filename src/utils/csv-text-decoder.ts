const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

export async function decodeCsvFile(file: File): Promise<string> {
  const buffer = await readFileAsArrayBuffer(file);
  return decodeCsvText(buffer);
}

export function decodeCsvText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  if (hasBom(bytes, UTF8_BOM)) {
    return decodeBytes(bytes.subarray(UTF8_BOM.length), 'utf-8');
  }

  if (hasBom(bytes, UTF16LE_BOM)) {
    return decodeBytes(bytes.subarray(UTF16LE_BOM.length), 'utf-16le');
  }

  if (hasBom(bytes, UTF16BE_BOM)) {
    return decodeBytes(bytes.subarray(UTF16BE_BOM.length), 'utf-16be');
  }

  try {
    return decodeBytes(bytes, 'utf-8', true);
  } catch {
    return decodeBytes(bytes, 'windows-1252');
  }
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const { result } = reader;
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error(`Unexpected file read result for "${file.name}".`));
        return;
      }

      resolve(result);
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error(`Failed to read "${file.name}".`));
    };

    reader.readAsArrayBuffer(file);
  });
}

function decodeBytes(bytes: Uint8Array, encoding: string, fatal = false): string {
  return new TextDecoder(encoding, { fatal }).decode(bytes);
}

function hasBom(bytes: Uint8Array, bom: number[]): boolean {
  if (bytes.length < bom.length) {
    return false;
  }

  return bom.every((part, index) => bytes[index] === part);
}
