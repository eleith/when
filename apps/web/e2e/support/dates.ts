// Far enough ahead to satisfy notice periods, inside every fixture booking window.
export function futureWeekday(): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + 7);
	while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
		date.setUTCDate(date.getUTCDate() + 1);
	}
	return date.toISOString().slice(0, 10);
}
