export function parseWorkItemReference(sourceId?: string) {
  if (!sourceId) {
    return undefined;
  }

  try {
    const pathnameSegments = new URL(sourceId).pathname
      .split("/")
      .filter(Boolean);
    const reference = pathnameSegments.at(-1);
    return reference && /^\d+$/.test(reference) ? reference : undefined;
  } catch {
    const reference = sourceId.split("/").filter(Boolean).at(-1);
    return reference && /^\d+$/.test(reference) ? reference : undefined;
  }
}

export function buildWorkItemTimerComment(title: string, sourceId?: string) {
  const reference = parseWorkItemReference(sourceId);
  return [reference ? `#${reference}` : undefined, title.trim()]
    .filter(Boolean)
    .join(" ");
}
