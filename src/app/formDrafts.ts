type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Draft = Record<string, { value: string; checked?: boolean }>;

export class FormDrafts {
  private drafts: Record<string, Draft> = {};
  private readonly storageKey = "delivery-master-form-drafts-v1";

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) this.drafts = saved;
    } catch { /* Draft recovery must not prevent loading saved day records. */ }
  }

  capture(root: HTMLElement, key: string): void {
    if (!key) return;
    const draft: Draft = { ...this.drafts[key] };
    for (const field of root.querySelectorAll<Field>("input,select,textarea")) {
      const selector = this.selector(field);
      if (!selector || (field instanceof HTMLInputElement && field.type === "file")) continue;
      const initial = field instanceof HTMLSelectElement
        ? [...field.options].find((option) => option.defaultSelected)?.value ?? field.options[0]?.value ?? ""
        : field.defaultValue;
      const checked = field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)
        ? field.checked : undefined;
      if (field.value !== initial || (checked !== undefined && checked !== (field as HTMLInputElement).defaultChecked)) {
        draft[selector] = { value: field.value, checked };
      } else delete draft[selector];
    }
    delete this.drafts[key];
    if (Object.keys(draft).length) this.drafts[key] = draft;
    this.persist();
  }

  restore(root: HTMLElement, key: string): boolean {
    const draft = this.drafts[key];
    if (!draft || typeof draft !== "object") return false;
    let restored = false;
    for (const [selector, value] of Object.entries(draft)) {
      if (!value || typeof value.value !== "string") continue;
      try {
        const field = root.querySelector<Field>(selector);
        if (!field || field instanceof HTMLInputElement && field.type === "file") continue;
        restored = restored || field.value !== value.value || (field instanceof HTMLInputElement && typeof value.checked === "boolean" && field.checked !== value.checked);
        field.value = value.value;
        if (field instanceof HTMLInputElement && typeof value.checked === "boolean") field.checked = value.checked;
      } catch { /* Ignore an obsolete draft selector without touching records. */ }
    }
    return restored;
  }

  clear(key: string): void {
    delete this.drafts[key];
    this.persist();
  }

  clearFields(key: string, selectors: string[]): void {
    const draft = this.drafts[key];
    if (!draft) return;
    for (const selector of selectors) delete draft[selector];
    this.persist();
  }

  clearDate(date: string): void {
    for (const key of Object.keys(this.drafts)) if (key.startsWith(date + ":")) delete this.drafts[key];
    this.persist();
  }

  private selector(field: Field): string | undefined {
    if (field.id) return `#${CSS.escape(field.id)}`;
    const attribute = [...field.attributes].find((item) => item.name.startsWith("data-helper-"));
    return attribute ? `[${attribute.name}="${CSS.escape(attribute.value)}"]` : undefined;
  }

  private persist(): void {
    this.drafts = Object.fromEntries(Object.entries(this.drafts).slice(-32));
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.drafts)); } catch { /* Saved DayRecord storage is independent. */ }
  }
}
