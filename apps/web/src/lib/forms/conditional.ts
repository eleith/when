import type { FormField } from '@when/config';

/**
 * Compute which form fields are visible given the current values, shared by the
 * server (authoritative) and the client (show/hide). A field is visible only if
 * every `show_when` condition holds; a condition holds when its referenced field
 * is itself visible and either equals one of the accepted values, or — when
 * `equals` is omitted — has a non-empty value. Conditions may only reference
 * earlier fields (enforced by config validation), so one ordered pass suffices.
 */
export function evaluateVisibility(
	fields: readonly FormField[],
	valueOf: (name: string) => string
): Map<string, boolean> {
	const visible = new Map<string, boolean>();
	const effective = new Map<string, string>(); // trimmed value, or '' when hidden

	for (const field of fields) {
		const shown = (field.show_when ?? []).every((cond) => {
			const value = effective.get(cond.field) ?? '';
			if (value === '') return false;
			if (cond.equals === undefined) return true;
			const accepted = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
			return accepted.includes(value);
		});
		visible.set(field.name, shown);
		effective.set(field.name, shown ? valueOf(field.name).trim() : '');
	}

	return visible;
}
