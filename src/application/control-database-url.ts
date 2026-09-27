export type ControlDatabaseUrlSource =
  | "asc_explicit"
  | "standard_database_url";

export interface ResolvedControlDatabaseUrl {
  readonly value: string;
  readonly source: ControlDatabaseUrlSource;
}

export function resolveControlDatabaseUrl(input: {
  readonly explicitAscDatabaseUrl?: string;
  readonly standardDatabaseUrl?: string;
}): ResolvedControlDatabaseUrl | undefined {
  const explicit = input.explicitAscDatabaseUrl?.trim();
  if (explicit) {
    return Object.freeze({
      value: explicit,
      source: "asc_explicit"
    });
  }

  const standard = input.standardDatabaseUrl?.trim();
  if (standard) {
    return Object.freeze({
      value: standard,
      source: "standard_database_url"
    });
  }

  return undefined;
}
