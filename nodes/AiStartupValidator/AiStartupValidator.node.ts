import {
	ApplicationError,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

async function callOpenAi(
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> {
	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			temperature: 0.7,
		}),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new ApplicationError(`OpenAI API error (${response.status}): ${errorBody}`);
	}

	const data = await response.json();
	return data.choices[0].message.content as string;
}

interface CompetitorEntry {
	name: string;
	whatTheyDo: string;
	strengths: string;
	weaknesses: string;
	pricing: string;
}

function parseCompetitorsJson(raw: string): CompetitorEntry[] {
	const cleaned = raw.replace(/```json|```/gi, '').trim();
	try {
		const parsed = JSON.parse(cleaned);
		if (Array.isArray(parsed.competitors)) {
			return parsed.competitors as CompetitorEntry[];
		}
		return [];
	} catch {
		return [];
	}
}

function buildCompetitorTable(competitors: CompetitorEntry[]): string {
	if (competitors.length === 0) {
		return '_No competitor data was returned._';
	}

	const header = '| Competitor | What They Do | Strengths | Weaknesses | Pricing |';
	const divider = '|---|---|---|---|---|';
	const rows = competitors.map(
		(c) => `| ${c.name} | ${c.whatTheyDo} | ${c.strengths} | ${c.weaknesses} | ${c.pricing} |`,
	);

	return [header, divider, ...rows].join('\n');
}

interface SynthesisScores {
	executiveSummary: string;
	overallScore: number;
	feasibilityScore: number;
	marketOpportunityScore: number;
}

interface RecommendationResult {
	recommendation: 'Go' | 'Pivot' | 'Stop';
	reasoning: string;
}

function parseJsonSafe<T>(raw: string, fallback: T): T {
	const cleaned = raw.replace(/```json|```/gi, '').trim();
	try {
		return JSON.parse(cleaned) as T;
	} catch {
		return fallback;
	}
}

function buildScorecardBlock(scores: SynthesisScores): string {
	return [
		'## Executive Summary',
		'',
		scores.executiveSummary,
		'',
		'### Scorecard',
		'',
		'| Metric | Score |',
		'|---|---|',
		`| Overall | ${scores.overallScore}/100 |`,
		`| Feasibility | ${scores.feasibilityScore}/100 |`,
		`| Market Opportunity | ${scores.marketOpportunityScore}/100 |`,
	].join('\n');
}

function buildRecommendationBlock(rec: RecommendationResult): string {
	const validRecommendations = ['Go', 'Pivot', 'Stop'];
	const label = validRecommendations.includes(rec.recommendation) ? rec.recommendation : 'Pivot';

	return ['## Final Recommendation', '', `### ${label}`, '', rec.reasoning].join('\n');
}

// Converts Markdown pipe-tables into HTML <table> markup.
// Must run BEFORE the generic regex chain below, since that chain's
// \n\n -> <br><br> rule would otherwise mangle table row line breaks.
function convertMarkdownTablesToHtml(markdown: string): string {
	const tableRegex = /^\|(.+)\|\r?\n\|([-:| ]+)\|\r?\n((?:\|.*\|\r?\n?)*)/gm;

	return markdown.replace(
		tableRegex,
		(_match, headerLine: string, _divider: string, bodyLines: string) => {
			const headers = headerLine.split('|').map((h) => h.trim());
			const rowLines = bodyLines.trim().split('\n');

			const headerHtml = headers.map((h) => `<th>${h}</th>`).join('');
			const rowsHtml = rowLines
				.map((line) => {
					const cells = line
						.split('|')
						.slice(1, -1)
						.map((c) => `<td>${c.trim()}</td>`)
						.join('');
					return `<tr>${cells}</tr>`;
				})
				.join('');

			return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
		},
	);
}

const SECTION_PROMPTS: Record<string, string> = {
	businessModel:
		'You are a business model consultant. Propose a viable business model (revenue streams, cost structure, key resources) for the given startup idea.',
	competitors:
		'You are a startup analyst. List and briefly describe the top 5 competitors for the given startup idea, including what each one does well and where they fall short.',
	investorPitch:
		'You are a pitch consultant. Write a concise investor pitch summary (problem, solution, market, traction potential, ask) for the given startup idea.',
	landingPageCopy:
		'You are a copywriter. Write landing page copy (headline, subheadline, 3 key benefits, call to action) for the given startup idea.',
	marketSize:
		'You are a market research analyst. Estimate the TAM, SAM, and SOM for the given startup idea, with brief reasoning for each figure.',
	marketingStrategy:
		'You are a marketing strategist. Propose a go-to-market and marketing strategy for the given startup idea, including target channels and messaging angles.',
	pricingComparison:
		'You are a pricing strategist. Compare pricing models of similar products in this space and recommend a pricing strategy for the given startup idea.',
	redditDiscussions:
		'You are a research analyst. Summarize what discussions on Reddit likely reveal about user sentiment, pain points, and demand for the given startup idea.',
	reviews:
		'You are a product analyst. Summarize what customer reviews of similar existing products likely reveal — common complaints and praise relevant to the given startup idea.',
	swot: 'You are a business strategist. Write a SWOT analysis (Strengths, Weaknesses, Opportunities, Threats) for the given startup idea.',
	competitorsTable: `You are a startup analyst. Return ONLY valid JSON (no Markdown code fences, no commentary) describing the top 5 competitors for the given startup idea. Use exactly this shape:
{"competitors": [{"name": string, "whatTheyDo": string, "strengths": string, "weaknesses": string, "pricing": string}]}`,
};

const SYNTHESIS_SCORES_PROMPT = `You are a senior startup analyst. You will be given a startup idea and a set of research findings about it. Return ONLY valid JSON (no Markdown code fences, no commentary) with exactly this shape:
{"executiveSummary": string, "overallScore": number, "feasibilityScore": number, "marketOpportunityScore": number}
executiveSummary should be a concise one-page overview (4-6 sentences) synthesizing the research. All three scores must be integers from 0 to 100, where 100 is the strongest possible outcome.`;

const RECOMMENDATION_PROMPT = `You are a startup investment advisor. You will be given a startup idea, research findings, and scores. Return ONLY valid JSON (no Markdown code fences, no commentary) with exactly this shape:
{"recommendation": "Go" | "Pivot" | "Stop", "reasoning": string}
recommendation must be exactly one of the three literal strings "Go", "Pivot", or "Stop". reasoning should be 2-4 sentences justifying the call based on the research and scores provided.`;

const SECTION_TITLES: Record<string, string> = {
	competitors: 'Competitors',
	marketSize: 'Market Size',
	redditDiscussions: 'Reddit Discussions',
	reviews: 'Reviews',
	pricingComparison: 'Pricing Comparison',
	swot: 'SWOT Analysis',
	businessModel: 'Business Model',
	marketingStrategy: 'Marketing Strategy',
	landingPageCopy: 'Landing Page Copy',
	investorPitch: 'Investor Pitch',
};

function buildCoverPage(startupIdea: string, generationDate: string): string {
	return [
		'# 🚀 AI Startup Validator',
		'',
		'### Startup Validation Report',
		'',
		`**Generated:** ${generationDate}`,
		'',
		'**Startup Idea:**',
		'',
		`> ${startupIdea.replace(/\n/g, '\n> ')}`,
		'',
		'---',
	].join('\n');
}

export class AiStartupValidator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AI Startup Validator',
		name: 'aiStartupValidator',
		icon: 'file:aiStartupValidator.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["sections"].length}} section(s)',
		usableAsTool: true,
		description: 'Validates a startup idea with a full research report',
		defaults: {
			name: 'AI Startup Validator',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'aiStartupValidatorApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Startup Idea',
				name: 'startupIdea',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				placeholder: 'e.g. A subscription box for artisanal hot sauces',
				description: 'Describe the startup idea you want validated',
				required: true,
			},
			{
				displayName: 'Sections to Include',
				name: 'sections',
				type: 'multiOptions',
				options: [
					{ name: 'Business Model', value: 'businessModel' },
					{ name: 'Competitors', value: 'competitors' },
					{ name: 'Investor Pitch', value: 'investorPitch' },
					{ name: 'Landing Page Copy', value: 'landingPageCopy' },
					{ name: 'Market Size', value: 'marketSize' },
					{ name: 'Marketing Strategy', value: 'marketingStrategy' },
					{ name: 'Pricing Comparison', value: 'pricingComparison' },
					{ name: 'Reddit Discussions', value: 'redditDiscussions' },
					{ name: 'Reviews', value: 'reviews' },
					{ name: 'SWOT', value: 'swot' },
				],
				default: ['competitors', 'marketSize', 'swot'],
				description: 'Which sections to generate in the validation report',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
					{ name: 'GPT-4o', value: 'gpt-4o' },
					{ name: 'GPT-4o Mini', value: 'gpt-4o-mini' },
				],
				default: 'gpt-4o-mini',
				description: 'The OpenAI model to use for generating each section',
			},
			{
				displayName: 'Use Live Web Search',
				name: 'useLiveWebSearch',
				type: 'boolean',
				default: false,
				description:
					'Whether to ground the Competitors, Reddit Discussions, and Reviews sections with real search results via SerpApi (requires a SerpApi key in credentials)',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{ name: 'HTML', value: 'html' },
					{ name: 'Markdown', value: 'markdown' },
				],
				default: 'markdown',
				description: 'The format of the combined validation report in the output data',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				// Read this item's parameters
				const startupIdea = this.getNodeParameter('startupIdea', i) as string;
				const sections = this.getNodeParameter('sections', i) as string[];
				const model = this.getNodeParameter('model', i) as string;
				const useLiveWebSearch = this.getNodeParameter('useLiveWebSearch', i) as boolean;
				const outputFormat = this.getNodeParameter('outputFormat', i) as string;
				const generationDate = new Date().toLocaleString('en-US', {
					dateStyle: 'long',
					timeStyle: 'short',
				});

				const credentials = await this.getCredentials('aiStartupValidatorApi', i);
				const openAiApiKey = credentials.openAiApiKey as string;
				const serpApiKey = credentials.serpApiKey as string | undefined;

				if (useLiveWebSearch && !serpApiKey) {
					throw new NodeOperationError(
						this.getNode(),
						'Use Live Web Search is enabled, but no SerpApi key was provided in the credentials.',
						{ itemIndex: i },
					);
				}

				// --- Generate each selected section (loop does ONLY this, nothing else) ---
				const sectionResults: { title: string; content: string }[] = [];

				for (const sectionKey of sections) {
					const title = SECTION_TITLES[sectionKey];

					if (sectionKey === 'competitors') {
						const userPrompt = `Startup idea: ${startupIdea}`;
						const rawJson = await callOpenAi(
							openAiApiKey,
							model,
							SECTION_PROMPTS.competitorsTable,
							userPrompt,
						);
						const competitors = parseCompetitorsJson(rawJson);
						const tableMarkdown = buildCompetitorTable(competitors);
						sectionResults.push({ title, content: tableMarkdown });
						continue;
					}

					const systemPrompt = SECTION_PROMPTS[sectionKey];

					if (!systemPrompt) {
						continue;
					}

					const userPrompt = `Startup idea: ${startupIdea}`;
					const content = await callOpenAi(openAiApiKey, model, systemPrompt, userPrompt);
					sectionResults.push({ title, content });
				}

				// --- Synthesis pass: runs ONCE, after all sections above are done ---
				const combinedContext = sectionResults
					.map((s) => `### ${s.title}\n${s.content}`)
					.join('\n\n');

				const synthesisUserPrompt = `Startup idea: ${startupIdea}\n\nHere is the research generated so far:\n\n${combinedContext}`;

				const synthesisRaw = await callOpenAi(
					openAiApiKey,
					model,
					SYNTHESIS_SCORES_PROMPT,
					synthesisUserPrompt,
				);

				const synthesis = parseJsonSafe<SynthesisScores>(synthesisRaw, {
					executiveSummary: '_Executive summary unavailable._',
					overallScore: 0,
					feasibilityScore: 0,
					marketOpportunityScore: 0,
				});

				const recommendationUserPrompt = `Startup idea: ${startupIdea}\n\nResearch and scoring:\n\n${combinedContext}\n\nScores — Overall: ${synthesis.overallScore}, Feasibility: ${synthesis.feasibilityScore}, Market Opportunity: ${synthesis.marketOpportunityScore}`;

				const recommendationRaw = await callOpenAi(
					openAiApiKey,
					model,
					RECOMMENDATION_PROMPT,
					recommendationUserPrompt,
				);

				const recommendation = parseJsonSafe<RecommendationResult>(recommendationRaw, {
					recommendation: 'Pivot',
					reasoning: '_Recommendation unavailable._',
				});

				// --- Assemble the combined report as an array of blocks ---
				const reportBlocks: string[] = [];
				reportBlocks.push(buildCoverPage(startupIdea, generationDate));
				reportBlocks.push(buildScorecardBlock(synthesis));

				for (const section of sectionResults) {
					reportBlocks.push(`## ${section.title}\n\n${section.content}`);
				}

				reportBlocks.push(buildRecommendationBlock(recommendation));

				const markdownReport = reportBlocks.join('\n\n');
				let finalReport = markdownReport;

				if (outputFormat === 'html') {
					finalReport = convertMarkdownTablesToHtml(markdownReport)
					.replace(/^#### (.*$)/gim, '<h4>$1</h4>')
					.replace(/^### (.*$)/gim, '<h3>$1</h3>')
					.replace(/^## (.*$)/gim, '<h2>$1</h2>')
					.replace(/^# (.*$)/gim, '<h1>$1</h1>')
					.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
					.replace(/^---$/gim, '<hr>')
					.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
					.replace(/\n\n/gim, '<br><br>')
					.replace(/\n/gim, '<br>');
				}

				returnData.push({
					json: {
						startupIdea,
						outputFormat,
						report: finalReport,
					},
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}