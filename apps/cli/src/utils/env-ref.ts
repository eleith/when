export function envRef(name: string): string {
	return `\${${name}}`;
}

// Extract the variable name from a `${VAR}` or `${VAR:-default}` reference.
export function envVarName(ref: string): string {
	return ref.replace(/^\$\{|\}$/g, '').split(':-')[0];
}
