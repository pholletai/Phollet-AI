import { z } from "zod";

const safeFilePath = z
  .string()
  .min(2)
  .max(180)
  .regex(/^\/[a-zA-Z0-9_./-]+$/)
  .refine((path) => !path.split("/").some((part) => part === "." || part === ".."))
  .refine((path) => !/(^|\/)(node_modules|\.next|\.git|\.env)(\/|$)/i.test(path))
  .refine((path) => !/^\/(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(path))
  .refine((path) => /\.(tsx?|jsx?|css|json|md)$/i.test(path));

const dependencyName = z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i);
const dependencyVersion = z.string().regex(/^[~^]?\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i);

export const ProjectResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("proposal"),
    message: z.string().min(1).max(6000),
  }),
  z.object({
    status: z.literal("files"),
    message: z.string().min(1).max(6000),
    files: z
      .array(
        z.object({
          path: safeFilePath,
          content: z.string().max(50000),
        }),
      )
      .min(1)
      .max(30),
    dependencies: z.record(dependencyName, dependencyVersion).optional().default({}),
  }),
]);

export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

export function parseModelJson(text: string): ProjectResponse {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(candidate);
  const result = ProjectResponseSchema.parse(parsed);

  if (result.status === "files") {
    const paths = new Set(result.files.map((file) => file.path));
    if (paths.size !== result.files.length) {
      throw new Error("The model returned duplicate file paths.");
    }

    const totalBytes = result.files.reduce(
      (total, file) => total + Buffer.byteLength(file.content, "utf8"),
      0,
    );
    if (totalBytes > 150_000) {
      throw new Error("The generated project is larger than the allowed 150 KB.");
    }

    if (Object.keys(result.dependencies).length > 12) {
      throw new Error("The generated project has too many dependencies.");
    }

    if (!paths.has("/App.tsx") || !paths.has("/styles.css")) {
      throw new Error("The project must include /App.tsx and /styles.css.");
    }
  }

  return result;
}
