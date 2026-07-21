export function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

export async function uniqueSlug(model, base, excludeId = null) {
  let slug = slugify(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await model.findUnique({ where: { slug } });
    if (!found || (excludeId && found.id === excludeId)) return slug;
    i += 1;
    slug = `${slugify(base)}-${i}`;
  }
}
