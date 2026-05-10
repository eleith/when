export interface CalendarLinkInput {
	/** ISO instant — `YYYY-MM-DDTHH:MM:SSZ` */
	start: string;
	/** ISO instant — `YYYY-MM-DDTHH:MM:SSZ` */
	end: string;
	title: string;
	description?: string;
	location?: string;
}

export type BuildLink = (input: CalendarLinkInput) => string;
