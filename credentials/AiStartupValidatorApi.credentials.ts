import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class AiStartupValidatorApi implements ICredentialType {
	name = 'aiStartupValidatorApi';
	displayName = 'AI Startup Validator API';
	properties: INodeProperties[] = [
		{
			displayName: 'OpenAI API Key',
			name: 'openAiApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];
}