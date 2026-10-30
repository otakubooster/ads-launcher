import { expect, test, type Page } from "@playwright/test";
import { ensureConnected, makeImage, signIn } from "./helpers";

/** A short WebM from MediaRecorder. */
async function makeVideo(page: Page) {
  const dataUrl = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(15);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = `hsl(${i * 18}, 60%, 50%)`;
      ctx.fillRect(0, 0, 1080, 1920);
      await new Promise((r) => setTimeout(r, 70));
    }
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const blob = new Blob(chunks, { type: "video/webm" });
    return await new Promise<string>((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result));
      fr.readAsDataURL(blob);
    });
  });
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

test("uploads pair by file name, dedupe, and go to a Meta account (week 3 checks)", async ({ page }) => {
  await signIn(page, "Fahd");
  await ensureConnected(page);
  await page.goto("/creatives");
  const story = await makeImage(page, 1080, 1920, "story");
  const feed = await makeImage(page, 1080, 1350, "feed");
  const video = await makeVideo(page);

  await page.getByRole("button", { name: "Upload creatives" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Choose files").setInputFiles([
    { name: "summer_9x16.png", mimeType: "image/png", buffer: story },
    { name: "summer_4x5.png", mimeType: "image/png", buffer: feed },
    { name: "teaser_9x16.webm", mimeType: "video/webm", buffer: video },
  ]);
  const progress = dialog.getByRole("list", { name: "Upload progress" });
  await expect(progress.getByText("Ready")).toHaveCount(3, { timeout: 30_000 });
  await expect(dialog.getByText("summer: 9:16 + 4:5 · paired for Stories/Reels and Feed")).toBeVisible();
  await expect(dialog.getByText(/teaser: 9:16 · unpaired/)).toBeVisible();

  // The same bytes again are recognised, not stored twice.
  await dialog.getByLabel("Choose files").setInputFiles([{ name: "summer_copy_9x16.png", mimeType: "image/png", buffer: story }]);
  await expect(progress.getByText("Already in library")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  const grid = page.getByRole("list", { name: "Creatives" });
  const summer = grid.getByRole("listitem").filter({ hasText: "summer" });
  await expect(summer.getByText("9:16", { exact: true })).toBeVisible();
  await expect(summer.getByText("4:5", { exact: true })).toBeVisible();
  await expect(grid.getByRole("listitem")).toHaveCount(2);

  await grid.getByRole("listitem").filter({ hasText: "teaser" }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "teaser" })).toBeVisible();
  await page.getByLabel("Upload to ad account").selectOption({ label: "Lumen US" });
  await page.getByRole("button", { name: "Upload to Meta" }).click();
  await expect(page.getByText("Uploaded to Meta: 1 ready.")).toBeVisible({ timeout: 30_000 });
  const lumen = page.getByRole("listitem").filter({ hasText: "Lumen US" });
  await expect(lumen.getByText("Ready")).toBeVisible();
});
