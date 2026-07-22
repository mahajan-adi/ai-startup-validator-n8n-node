const markdownReport = [
	'# 🚀 AI Startup Validator',
	'',
	'### Startup Validation Report',
	'',
	'**Generated:** July 22, 2026 at 3:45 PM',
	'',
	'**Startup Idea:**',
	'',
	'> A subscription box for artisanal hot sauces',
	'',
	'---',
	'',
	'## Competitors',
	'',
	'Some competitor analysis text here.',
].join('\n');

const finalReport = markdownReport
	.replace(/^### (.*$)/gim, '<h3>$1</h3>')
	.replace(/^## (.*$)/gim, '<h2>$1</h2>')
	.replace(/^# (.*$)/gim, '<h1>$1</h1>')
	.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
	.replace(/^---$/gim, '<hr>')
	.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
	.replace(/\n\n/gim, '<br><br>');

console.log(finalReport);