export interface ProjectIdentity {
  id: string;
  updatedAt: number;
}

export function projectTitle(fileName?: string): string {
  if (!fileName) return "Untitled Tone Match";
  const withoutExtension = fileName.replace(/\.[^.]+$/, "").trim();
  return withoutExtension || "Untitled Tone Match";
}

export function upsertProject<T extends ProjectIdentity>(projects: T[], project: T): T[] {
  return [project, ...projects.filter((candidate) => candidate.id !== project.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
