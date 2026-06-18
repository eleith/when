import { expect, test } from 'vitest';
import { describeAppointment } from './description.js';

const base = {
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_answers: null
};

test('includes name, email, and the cancel link', () => {
	expect(describeAppointment(base, 'https://when.test/cancel')).toBe(
		'Name: Booker\nEmail: booker@example.com\n\nReschedule or cancel: https://when.test/cancel'
	);
});

test('omits the email line when there is no email', () => {
	expect(describeAppointment({ ...base, attendee_email: null }, 'https://when.test/cancel')).toBe(
		'Name: Booker\n\nReschedule or cancel: https://when.test/cancel'
	);
});

test('renders answers as label/value lines, skipping empty values', () => {
	const answers = JSON.stringify([
		{ id: 'phone', label: 'Phone', type: 'text', value: '+15550199' },
		{ id: 'co', label: 'Company', type: 'text', value: '' }
	]);
	expect(
		describeAppointment({ ...base, attendee_answers: answers }, 'https://when.test/cancel')
	).toBe(
		'Name: Booker\nEmail: booker@example.com\nPhone: +15550199\n\nReschedule or cancel: https://when.test/cancel'
	);
});
