import { expect, test } from 'vitest';
import { describeAppointment } from './description.js';

const base = {
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	note: null,
	conference: null
};

test('includes name, email, and the cancel link', () => {
	expect(describeAppointment(base, 'https://when.test/cancel')).toBe(
		'Name: Booker\nEmail: booker@example.com\n\nReschedule or cancel: https://when.test/cancel'
	);
});

test('omits the email line when there is no email', () => {
	expect(describeAppointment({ ...base, guest_email: null }, 'https://when.test/cancel')).toBe(
		'Name: Booker\n\nReschedule or cancel: https://when.test/cancel'
	);
});

test('renders answers as label/value lines, skipping empty values', () => {
	const answers = JSON.stringify([
		{ id: 'phone', label: 'Phone', type: 'text', value: '+15550199' },
		{ id: 'co', label: 'Company', type: 'text', value: '' }
	]);
	expect(describeAppointment({ ...base, guest_answers: answers }, 'https://when.test/cancel')).toBe(
		'Name: Booker\nEmail: booker@example.com\nPhone: +15550199\n\nReschedule or cancel: https://when.test/cancel'
	);
});

test('appends note to description when present', () => {
	expect(
		describeAppointment(
			{ ...base, note: 'Please prepare the homework document' },
			'https://when.test/cancel'
		)
	).toBe(
		'Name: Booker\nEmail: booker@example.com\nNote: Please prepare the homework document\n\nReschedule or cancel: https://when.test/cancel'
	);
});

test('appends conference link to description when present', () => {
	expect(
		describeAppointment(
			{ ...base, conference: 'https://zoom.us/j/12345' },
			'https://when.test/cancel'
		)
	).toBe(
		'Name: Booker\nEmail: booker@example.com\nVideo Link: https://zoom.us/j/12345\n\nReschedule or cancel: https://when.test/cancel'
	);
});
