import type { Brand } from './format.js';

export interface DetailRow {
	label: string;
	value: string | null;
}

export type ActionVariant = 'primary' | 'secondary' | 'danger';

export interface EmailAction {
	href: string;
	label: string;
	variant: ActionVariant;
}

export interface EmailContent {
	brand: Brand;
	subject: string;
	heading: string;
	paragraphs: string[];
	rows: DetailRow[];
	actions: EmailAction[];
}
