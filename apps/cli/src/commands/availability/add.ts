import { define } from 'gunshi';
import { text, isCancel, multiselect, spinner } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import { getValidatedConfigPath, validateConfigExists } from '../../utils/config-path.ts';

interface ScheduleProfile {
	name: string;
	weekly: Record<string, string[]>;
}

async function promptScheduleName(existingNames: string[]): Promise<string | null> {
	const scheduleName = await text({
		message: 'What is the schedule name?',
		placeholder: 'standard',
		defaultValue: 'standard',
		validate(value) {
			const val = (value || '').trim() || 'standard';
			if (existingNames.includes(val)) {
				return `A schedule with name "${val}" already exists in config.yaml.`;
			}
		}
	});

	if (isCancel(scheduleName)) return null;
	return (scheduleName as string).trim() || 'standard';
}

async function promptWorkingDays(): Promise<string[] | null> {
	const days = await multiselect({
		message: 'What are the working days?',
		options: [
			{ value: 'monday', label: 'Monday' },
			{ value: 'tuesday', label: 'Tuesday' },
			{ value: 'wednesday', label: 'Wednesday' },
			{ value: 'thursday', label: 'Thursday' },
			{ value: 'friday', label: 'Friday' },
			{ value: 'saturday', label: 'Saturday' },
			{ value: 'sunday', label: 'Sunday' }
		],
		initialValues: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
	});

	if (isCancel(days)) return null;
	return days as string[];
}

async function promptWorkingHours(): Promise<string | null> {
	const hours = await text({
		message: 'What are the working hours?',
		placeholder: '09:00-17:00',
		defaultValue: '09:00-17:00',
		validate(value) {
			const val = (value || '').trim() || '09:00-17:00';
			if (!/^[0-2]\d:[0-5]\d-[0-2]\d:[0-5]\d$/.test(val)) {
				return 'Invalid format. Must be HH:MM-HH:MM (e.g. 09:00-17:00)';
			}
		}
	});

	if (isCancel(hours)) return null;
	return (hours as string).trim() || '09:00-17:00';
}

function writeScheduleConfig(
	configPath: string,
	schedule: ScheduleProfile,
	existingCount: number
): void {
	const editor = new ConfigEditor(configPath);
	editor.set(`schedules.${existingCount}`, schedule);
}

export const availabilityAddCommand = define({
	name: 'add',
	description: 'Wizard to add a schedule profile',
	args: {
		config: {
			type: 'string',
			short: 'c',
			description: 'Path to config.yaml file'
		}
	},
	async run(ctx) {
		const configPathArg = ctx.values.config;
		const configPath = getValidatedConfigPath(configPathArg);

		if (!validateConfigExists(configPath)) {
			return;
		}

		const editor = new ConfigEditor(configPath);
		const existingSchedules = (editor.get('schedules') as ScheduleProfile[]) ?? [];
		const existingNames = existingSchedules.map((a) => a.name);

		const name = await promptScheduleName(existingNames);
		if (!name) return;

		const selectedDays = await promptWorkingDays();
		if (!selectedDays || selectedDays.length === 0) {
			if (selectedDays) {
				console.log('No working days selected. Cancelled.');
			}
			return;
		}

		const selectedHours = await promptWorkingHours();
		if (!selectedHours) return;

		const s = spinner();
		s.start('Saving schedule profile...');

		try {
			const weekly: Record<string, string[]> = {};
			for (const day of selectedDays) {
				weekly[day] = [selectedHours];
			}

			const newProfile: ScheduleProfile = {
				name,
				weekly
			};

			writeScheduleConfig(configPath, newProfile, existingSchedules.length);
			s.stop(`Successfully added schedule "${name}" to config.yaml!`);
		} catch (err) {
			s.stop('Failed to save!');
			console.error(err);
			process.exitCode = 1;
		}
	}
});
