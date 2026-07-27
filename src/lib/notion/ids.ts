export function normalizeNotionId(value: string) {
  const trimmed = value.trim();
  const collectionId = trimmed.replace(/^collection:\/\//, "");
  const dashedId = collectionId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  if (dashedId) {
    return dashedId[0];
  }

  const compactId = collectionId.match(/[0-9a-f]{32}/i);

  if (compactId) {
    return compactId[0];
  }

  return collectionId;
}
