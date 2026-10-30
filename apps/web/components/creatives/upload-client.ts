"use client";

import { createSHA256 } from "hash-wasm";

export type FileMeta = { kind: "image" | "video"; width: number; height: number; durationS: number | null; poster: Blob | null };

/** Dimensions, duration and a poster frame, read in the browser before upload. */
export async function readMeta(file: File): Promise<FileMeta> {
  if (file.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(file);
    const meta = { kind: "image" as const, width: bitmap.width, height: bitmap.height, durationS: null, poster: null };
    bitmap.close();
    return meta;
  }
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("This video can't be read in the browser."));
    });
    const durationS = Number.isFinite(video.duration) ? video.duration : null;
    let poster: Blob | null = null;
    try {
      video.currentTime = Math.min(1, (durationS ?? 2) / 2);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(resolve, 3000);
      });
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 540 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    } catch {
      poster = null;
    }
    return { kind: "video", width: video.videoWidth, height: video.videoHeight, durationS, poster };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** sha256 in 8 MB slices, so a 500 MB video never sits in memory at once. */
export async function sha256File(file: File, onProgress?: (fraction: number) => void) {
  const hasher = await createSHA256();
  const step = 8 * 1024 * 1024;
  for (let at = 0; at < file.size; at += step) {
    hasher.update(new Uint8Array(await file.slice(at, at + step).arrayBuffer()));
    onProgress?.(Math.min(1, (at + step) / file.size));
  }
  return hasher.digest("hex");
}

/** PUT straight to storage with progress (fetch can't report upload progress). */
export function putWithProgress(url: string, body: Blob, headers: Record<string, string>, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.send(body);
  });
}
