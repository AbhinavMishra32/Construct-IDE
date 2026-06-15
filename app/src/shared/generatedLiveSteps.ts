export function normalizeGeneratedMarkdown(value: string): string {
  const segments = value.replace(/\r\n/g, "\n").split(/(```[\s\S]*?```)/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) {
        return segment;
      }
      return segment
        .replace(/[ \t]{2,}/g, "\n\n")
        .replace(/\n{3,}/g, "\n\n");
    })
    .join("")
    .trim();
}
