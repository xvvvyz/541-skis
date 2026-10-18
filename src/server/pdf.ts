// Just enough PDF to print a topsheet: one page of vector drawing with one
// JPEG image. The JPEG goes in as is (PDF reads JPEG natively) and streams
// straight from R2 into the file, so even a huge image never sits in memory.

const encoder = new TextEncoder();

interface Jpeg {
  width: number;
  height: number;
  components: number;
}

export function jpegInfo(bytes: Uint8Array): Jpeg | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Start of frame: any SOFn but DHT (C4), JPG (C8) and DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        components: bytes[i + 9],
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

// A JPEG's info and size in R2, reading only as much of its start as it
// takes: metadata such as the upscaler's content credentials can come first.
export async function readJpeg(bucket: R2Bucket, key: string) {
  const size = (await bucket.head(key))?.size;
  if (!size) throw new Error(`Missing ${key}`);
  for (let length = 128 * 1024; ; length *= 4) {
    const start = await bucket.get(key, {
      range: { length: Math.min(length, size), offset: 0 },
    });
    const jpeg = start && jpegInfo(new Uint8Array(await start.arrayBuffer()));
    if (jpeg) return { jpeg, size };
    if (length >= size) throw new Error(`${key} isn't a JPEG`);
  }
}

const num = (value: number) => String(Math.round(value * 1000) / 1000);

// An SVG path as PDF path operators. Handles the commands the logo uses
// (M, L, H, V, C, S, Z, absolute and relative).
export function pathOps(d: string) {
  const tokens = d.match(
    /[MmLlHhVvCcSsZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g,
  )!;
  const ops: string[] = [];
  let i = 0;
  let command = "";
  let [x, y, startX, startY, controlX, controlY] = [0, 0, 0, 0, 0, 0];
  const next = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const dx = relative ? x : 0;
    const dy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M":
        x = next() + dx;
        y = next() + dy;
        [startX, startY] = [x, y];
        ops.push(`${num(x)} ${num(y)} m`);
        // Further pairs after a move are lines.
        command = relative ? "l" : "L";
        break;
      case "L":
        x = next() + dx;
        y = next() + dy;
        ops.push(`${num(x)} ${num(y)} l`);
        break;
      case "H":
        x = next() + dx;
        ops.push(`${num(x)} ${num(y)} l`);
        break;
      case "V":
        y = next() + dy;
        ops.push(`${num(x)} ${num(y)} l`);
        break;
      case "C":
      case "S": {
        const [x1, y1] =
          command.toUpperCase() === "C"
            ? [next() + dx, next() + dy]
            : [2 * x - controlX, 2 * y - controlY];
        const [x2, y2] = [next() + dx, next() + dy];
        x = next() + dx;
        y = next() + dy;
        [controlX, controlY] = [x2, y2];
        ops.push(`${[x1, y1, x2, y2, x, y].map(num).join(" ")} c`);
        break;
      }
      case "Z":
        [x, y] = [startX, startY];
        ops.push("h");
        break;
      default:
        throw new Error(`Unsupported path command ${command}`);
    }
    if (!"CcSs".includes(command)) [controlX, controlY] = [x, y];
  }
  return ops.join("\n");
}

export const matrix = (m: number[]) => `${m.map(num).join(" ")} cm`;

// Writes a one-page PDF to R2: the page's drawing, which shows the image as
// /Art, and the image itself, read from R2.
export async function writePdf(
  bucket: R2Bucket,
  key: string,
  page: { width: number; height: number; content: string; title: string },
  image: { key: string; jpeg: Jpeg; size: number },
) {
  const colorSpace =
    { 1: "/DeviceGray", 3: "/DeviceRGB", 4: "/DeviceCMYK" }[
      image.jpeg.components
    ] ?? "/DeviceRGB";
  const content = encoder.encode(page.content);
  const date = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const title = page.title.replace(/[()\\]/g, "");

  const before = [
    "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /XObject << /Art 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n`,
    content,
    "\nendstream\nendobj\n",
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.jpeg.width} /Height ${image.jpeg.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.size} >>\nstream\n`,
  ];
  const after = [
    "\nendstream\nendobj\n",
    `6 0 obj\n<< /Title (${title}) /Producer (541.ski) /CreationDate (D:${date}Z) >>\nendobj\n`,
  ];

  const bytes = (parts: (string | Uint8Array)[]) =>
    parts.map((part) =>
      typeof part === "string"
        ? Uint8Array.from(part, (c) => c.charCodeAt(0))
        : part,
    );
  const head = bytes(before);
  const tail = bytes(after);
  // Byte offsets of each object, for the cross-reference table: objects 1
  // to 5 start at these parts of the head, and 6 after the image.
  const offsets: number[] = [];
  let at = 0;
  head.forEach((part, i) => {
    if ([1, 2, 3, 4, 7].includes(i)) offsets.push(at);
    at += part.length;
  });
  at += image.size + tail[0].length;
  offsets.push(at);
  at += tail[1].length;
  const xref = [
    "xref\n0 7\n0000000000 65535 f \n",
    ...offsets.map(
      (offset) => `${String(offset).padStart(10, "0")} 00000 n \n`,
    ),
    `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${at}\n%%EOF\n`,
  ].join("");
  tail.push(encoder.encode(xref));

  const total =
    head.reduce((sum, part) => sum + part.length, 0) +
    image.size +
    tail.reduce((sum, part) => sum + part.length, 0);
  const object = await bucket.get(image.key);
  if (!object) throw new Error(`Missing ${image.key}`);

  const { readable, writable } = new FixedLengthStream(total);
  const saving = bucket.put(key, readable, {
    httpMetadata: { contentType: "application/pdf" },
  });
  const writer = writable.getWriter();
  for (const part of head) await writer.write(part);
  const reader = object.body.getReader();
  for (
    let chunk = await reader.read();
    !chunk.done;
    chunk = await reader.read()
  ) {
    await writer.write(chunk.value);
  }
  for (const part of tail) await writer.write(part);
  await writer.close();
  await saving;
  return total;
}
