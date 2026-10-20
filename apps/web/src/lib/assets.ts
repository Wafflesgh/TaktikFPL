import "server-only";

// Template URL dari env (BLUEPRINT 6.3): pola CDN berubah antar musim, jadi tidak di-hardcode.
function fill(template: string | undefined, values: Record<string, string | number>): string | null {
  if (!template) return null;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ""));
}

export function playerPhotoUrls(code: number | null, resolved: string | null): string[] {
  if (resolved) return [resolved];
  if (code == null) return [];
  return [
    fill(process.env.PLAYER_PHOTO_URL_TEMPLATE, { code }),
    fill(process.env.PLAYER_PHOTO_FALLBACK_TEMPLATE, { code }),
  ].filter((u): u is string => Boolean(u));
}

export function teamBadgeUrl(teamCode: number | null): string | null {
  return teamCode == null ? null : fill(process.env.TEAM_BADGE_URL_TEMPLATE, { team_code: teamCode });
}
