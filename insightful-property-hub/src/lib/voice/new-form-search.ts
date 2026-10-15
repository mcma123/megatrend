// `?new=1` opens a page's create dialog; the voice assistant navigates there to open a form.
export type NewFormSearch = { new?: "1" };

export function validateNewFormSearch(search: Record<string, unknown>): NewFormSearch {
  return search.new === "1" || search.new === 1 || search.new === true ? { new: "1" } : {};
}
