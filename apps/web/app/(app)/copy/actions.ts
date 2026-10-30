"use server";

import { copySets } from "@fahd/db/schema";
import { COPY_LIMITS, CTA_TYPES } from "@fahd/shared/meta-options";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/server/action-result";
import { requireRole } from "@/lib/server/auth";
import { asUser } from "@/lib/server/db";

const EDITORS = ["owner", "admin", "buyer"] as const;
const texts = (label: string) =>
  z
    .array(z.string().trim())
    .transform((list) => list.filter(Boolean))
    .pipe(z.array(z.string()).max(COPY_LIMITS.perType, `At most ${COPY_LIMITS.perType} ${label}.`));

const copyInput = z.object({
  id: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  name: z.string().trim().min(1, "Name the copy set.").max(80),
  brandId: z.uuid("Pick a brand."),
  language: z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z]{2})?$/, "Language is a code like en or fr."),
  primaryTexts: texts("primary texts").pipe(z.array(z.string()).min(1, "Add at least one primary text.")),
  headlines: texts("headlines"),
  descriptions: texts("descriptions"),
  ctaType: z.enum(CTA_TYPES),
});

export async function saveCopySet(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const input = copyInput.parse({
      ...Object.fromEntries(formData),
      primaryTexts: formData.getAll("primaryTexts"),
      headlines: formData.getAll("headlines"),
      descriptions: formData.getAll("descriptions"),
    });
    const { id, ...values } = input;
    await asUser(session.userId, (tx) => (id ? tx.update(copySets).set(values).where(eq(copySets.id, id)) : tx.insert(copySets).values(values)));
    revalidatePath("/copy");
    return { ok: true, message: `Saved "${input.name}".` };
  });
}

export async function duplicateCopySet(id: string, language: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    const input = z.object({ id: z.uuid(), language: z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z]{2})?$/, "Language is a code like en or fr.") }).parse({ id, language });
    await asUser(session.userId, async (tx) => {
      const [src] = await tx.select().from(copySets).where(eq(copySets.id, input.id));
      if (!src) throw new Error("Copy set not found");
      await tx.insert(copySets).values({
        brandId: src.brandId,
        language: input.language,
        name: `${src.name} (${input.language})`,
        primaryTexts: src.primaryTexts,
        headlines: src.headlines,
        descriptions: src.descriptions,
        ctaType: src.ctaType,
      });
    });
    revalidatePath("/copy");
    return { ok: true, message: `Duplicated to ${input.language}. Translate the texts before launching.` };
  });
}

export async function deleteCopySet(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole(...EDITORS);
    await asUser(session.userId, (tx) => tx.delete(copySets).where(eq(copySets.id, z.uuid().parse(id))));
    revalidatePath("/copy");
    return { ok: true, message: "Copy set deleted." };
  });
}
