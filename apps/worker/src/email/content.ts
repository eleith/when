import type { Brand } from './format.js';

export interface DetailRow {
	label: string;
	value: string | null;
	href?: string;
}

export interface EmailAction {
	href: string;
	label: string;
}

export interface EmailContent {
	brand: Brand;
	subject: string;
	heading: string;
	paragraphs: string[];
	rows: DetailRow[];
	actions: EmailAction[];
	previewText?: string;
}
