// Topaz's upscaler on Replicate, in its mode for digital art. 4x takes the
// image model's art to roughly 250 dpi at full size; about $0.20 a pair.
const UPSCALER = "topazlabs/image-upscale";
export const FACTOR = 4;
const REPLICATE = "https://api.replicate.com/v1";

export type Check = { done: boolean; output?: string; error?: string };

function replicate(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${REPLICATE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

// The parts of Replicate's replies used here.
type Upload = { id: string; urls: { get: string } };
type Prediction = {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
};

async function ok<T>(response: Response) {
  if (!response.ok) {
    throw new Error(`Replicate ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export async function startUpscale(
  bucket: R2Bucket,
  token: string,
  key: string,
) {
  const object = await bucket.get(key);
  if (!object) throw new Error(`Missing ${key}`);
  const form = new FormData();
  form.append(
    "content",
    new Blob([await object.arrayBuffer()], { type: "image/jpeg" }),
    "art.jpg",
  );
  const file = await ok<Upload>(
    await replicate(token, "/files", { body: form, method: "POST" }),
  );
  const prediction = await ok<Prediction>(
    await replicate(token, `/models/${UPSCALER}/predictions`, {
      body: JSON.stringify({
        input: {
          enhance_model: "CGI",
          image: file.urls.get,
          output_format: "jpg",
          upscale_factor: `${FACTOR}x`,
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  return { file: file.id, id: prediction.id };
}

export async function checkUpscale(token: string, prediction: { id: string }) {
  const result = await ok<Prediction>(
    await replicate(token, `/predictions/${prediction.id}`),
  );
  if (result.status === "succeeded") {
    const output = Array.isArray(result.output)
      ? result.output[0]
      : result.output;
    return { done: true, output: String(output) };
  }
  if (result.status === "failed" || result.status === "canceled") {
    return { done: true, error: String(result.error ?? result.status) };
  }
  return { done: false };
}

export async function save(
  bucket: R2Bucket,
  token: string,
  url: string,
  key: string,
) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  const length = Number(response.headers.get("content-length"));
  if (!response.ok || !response.body) {
    throw new Error(`Couldn't fetch the upscaled art: ${response.status}`);
  }
  const body = length
    ? response.body.pipeThrough(new FixedLengthStream(length))
    : await response.arrayBuffer();
  await bucket.put(key, body, { httpMetadata: { contentType: "image/jpeg" } });
}

// Not worth failing the order over.
export async function forget(token: string, file: string) {
  await replicate(token, `/files/${file}`, { method: "DELETE" }).catch(
    (cause) => console.error("couldn't delete upscaler upload", cause),
  );
}
