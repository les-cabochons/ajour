import { z } from "zod";

export const repositoryFolderSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  lastUsedAt: z.number().optional(),
});
export type RepositoryFolder = z.infer<typeof repositoryFolderSchema>;
export const repositoryFoldersSchema = z.array(repositoryFolderSchema);
